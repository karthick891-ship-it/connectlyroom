import { create } from "zustand";
import * as api from "../lib/api";
import { maxConfirmedId, newClientId, sortConversations, upsertMessage } from "../lib/messages";
import { SocketClient } from "../lib/socket";
import type { Attachment, Conversation, Message, MessageKind, ServerEvent } from "../lib/types";
import { useAuth } from "./auth";

const PAGE = 50;
const SEND_TIMEOUT_MS = 10_000;
const TYPING_THROTTLE_MS = 2_500;

let tempId = 0;
let lastTypingSent = 0;
const loadingOlder = new Set<number>();

export interface Draft {
  kind: Exclude<MessageKind, "system">;
  content: string | null;
  attachment?: Attachment;
}

interface ChatState {
  conversations: Conversation[];
  activeId: number | null;
  messages: Record<number, Message[]>;
  hasMore: Record<number, boolean>;
  typing: Record<number, Record<number, number>>; // conversation -> user -> last seen (ms)
  online: Record<number, true>;
  connected: boolean;
  notice: string | null;

  loadConversations: () => Promise<void>;
  openConversation: (id: number | null) => Promise<void>;
  loadOlder: (id: number) => Promise<void>;
  send: (cid: number, draft: Draft) => void;
  retry: (cid: number, clientId: string) => void;
  markRead: (cid: number) => void;
  notifyTyping: (cid: number) => void;
  startDirect: (userId: number) => Promise<number>;
  startGroup: (name: string, memberIds: number[]) => Promise<number>;
  handleEvent: (e: ServerEvent) => void;
  setConnected: (open: boolean, reconnected: boolean) => void;
  setNotice: (text: string | null) => void;
  reset: () => void;
}

const initial = {
  conversations: [] as Conversation[],
  activeId: null as number | null,
  messages: {} as Record<number, Message[]>,
  hasMore: {} as Record<number, boolean>,
  typing: {} as Record<number, Record<number, number>>,
  online: {} as Record<number, true>,
  connected: false,
  notice: null as string | null,
};

const meId = () => useAuth.getState().user?.id ?? 0;

export const useChat = create<ChatState>((set, get) => {
  const mergeInto = (cid: number, incoming: Message[]) =>
    set((s) => ({ messages: { ...s.messages, [cid]: incoming.reduce((acc, m) => upsertMessage(acc, m), s.messages[cid] ?? []) } }));

  const setStatus = (cid: number, clientId: string, status: Message["status"]) =>
    set((s) => {
      const list = s.messages[cid];
      if (!list) return s;
      return { messages: { ...s.messages, [cid]: list.map((m) => (m.client_id === clientId && m.id <= 0 ? { ...m, status } : m)) } };
    });

  const transmit = (m: Message) => {
    const ok = socket.send({
      type: "message.send",
      conversation_id: m.conversation_id,
      client_id: m.client_id,
      kind: m.type,
      content: m.content,
      attachment: m.attachments[0],
    });
    if (!ok) return setStatus(m.conversation_id, m.client_id, "failed");
    window.setTimeout(() => {
      const cur = get().messages[m.conversation_id]?.find((x) => x.client_id === m.client_id);
      if (cur && cur.id <= 0 && cur.status === "sending") setStatus(m.conversation_id, m.client_id, "failed");
    }, SEND_TIMEOUT_MS);
  };

  const applyMessage = (m: Message, kind: "new" | "updated") => {
    const me = meId();
    const s0 = get();
    const viewing = s0.activeId === m.conversation_id && !document.hidden;
    const known = s0.conversations.some((c) => c.id === m.conversation_id);

    set((s) => {
      const loaded = s.messages[m.conversation_id];
      const messages = loaded ? { ...s.messages, [m.conversation_id]: upsertMessage(loaded, m) } : s.messages;
      const typing = s.typing[m.conversation_id]?.[m.sender_id]
        ? { ...s.typing, [m.conversation_id]: { ...s.typing[m.conversation_id], [m.sender_id]: 0 } }
        : s.typing;
      const conversations = s.conversations.map((c) => {
        if (c.id !== m.conversation_id) return c;
        const isLatest = !c.last_message || m.id >= c.last_message.id;
        const bump = kind === "new" && m.sender_id !== me && !viewing;
        return {
          ...c,
          last_message: isLatest ? m : c.last_message,
          last_activity: isLatest && kind === "new" ? m.created_at : c.last_activity,
          unread: bump ? Math.min(c.unread + 1, 100) : c.unread,
        };
      });
      return { messages, typing, conversations: sortConversations(conversations) };
    });

    if (!known) void get().loadConversations();
    if (kind === "new" && viewing && m.sender_id !== me) get().markRead(m.conversation_id);
  };

  return {
    ...initial,

    async loadConversations() {
      try {
        const list = await api.listConversations();
        set({ conversations: sortConversations(list) });
        const ids = [...new Set(list.flatMap((c) => c.members.map((m) => m.id)))];
        if (ids.length) {
          const { online } = await api.onlineUsers(ids);
          set({ online: Object.fromEntries(online.map((id) => [id, true as const])) });
        }
      } catch {
        set({ notice: "Couldn’t load your chats. Check your connection." });
      }
    },

    async openConversation(id) {
      set({ activeId: id });
      if (id === null) return;
      if (!get().messages[id]) {
        try {
          const msgs = await api.getMessages(id, { limit: PAGE });
          mergeInto(id, msgs);
          set((s) => ({ hasMore: { ...s.hasMore, [id]: msgs.length === PAGE } }));
        } catch {
          set({ notice: "Couldn’t load messages for this chat." });
        }
      }
      get().markRead(id);
    },

    async loadOlder(id) {
      const first = get().messages[id]?.find((m) => m.id > 0);
      if (!first || !get().hasMore[id] || loadingOlder.has(id)) return;
      loadingOlder.add(id);
      try {
        const older = await api.getMessages(id, { before_id: first.id, limit: PAGE });
        mergeInto(id, older);
        set((s) => ({ hasMore: { ...s.hasMore, [id]: older.length === PAGE } }));
      } catch {
        set({ notice: "Couldn’t load earlier messages." });
      } finally {
        loadingOlder.delete(id);
      }
    },

    send(cid, draft) {
      const msg: Message = {
        id: -(++tempId),
        conversation_id: cid,
        sender_id: meId(),
        client_id: newClientId(),
        type: draft.kind,
        content: draft.content,
        created_at: new Date().toISOString(),
        edited_at: null,
        deleted: false,
        attachments: draft.attachment ? [draft.attachment] : [],
        status: "sending",
      };
      mergeInto(cid, [msg]);
      transmit(msg);
    },

    retry(cid, clientId) {
      const msg = get().messages[cid]?.find((m) => m.client_id === clientId);
      if (!msg) return;
      setStatus(cid, clientId, "sending");
      transmit({ ...msg, status: "sending" }); // same client_id, so the server dedupes
    },

    markRead(cid) {
      const s = get();
      const conv = s.conversations.find((c) => c.id === cid);
      if (!conv) return;
      const lastId = maxConfirmedId(s.messages[cid] ?? []) || conv.last_message?.id || 0;
      if (!lastId) return;
      const me = meId();
      const mine = conv.members.find((m) => m.id === me);
      if (conv.unread === 0 && (mine?.last_read_message_id ?? 0) >= lastId) return;
      set((st) => ({
        conversations: st.conversations.map((c) =>
          c.id !== cid ? c : {
            ...c,
            unread: 0,
            members: c.members.map((m) => (m.id === me ? { ...m, last_read_message_id: Math.max(m.last_read_message_id, lastId) } : m)),
          },
        ),
      }));
      socket.send({ type: "message.read", conversation_id: cid, message_id: lastId });
    },

    notifyTyping(cid) {
      const now = Date.now();
      if (now - lastTypingSent < TYPING_THROTTLE_MS) return;
      lastTypingSent = now;
      socket.send({ type: "typing.start", conversation_id: cid });
    },

    async startDirect(userId) {
      const conv = await api.createDirect(userId);
      set((s) => ({ conversations: s.conversations.some((c) => c.id === conv.id) ? s.conversations : sortConversations([conv, ...s.conversations]) }));
      return conv.id;
    },

    async startGroup(name, memberIds) {
      const conv = await api.createGroup(name, memberIds);
      set((s) => ({ conversations: s.conversations.some((c) => c.id === conv.id) ? s.conversations : sortConversations([conv, ...s.conversations]) }));
      return conv.id;
    },

    handleEvent(e) {
      switch (e.type) {
        case "message.new":
          return applyMessage(e.message, "new");
        case "message.ack":
          return applyMessage(e.message, "new");
        case "message.updated":
          return applyMessage(e.message, "updated");
        case "typing":
          return set((s) => ({
            typing: { ...s.typing, [e.conversation_id]: { ...s.typing[e.conversation_id], [e.user_id]: Date.now() } },
          }));
        case "message.read": {
          const me = meId();
          return set((s) => ({
            conversations: s.conversations.map((c) => {
              if (c.id !== e.conversation_id) return c;
              const clearsMine = e.user_id === me && c.last_message && e.message_id >= c.last_message.id;
              return {
                ...c,
                unread: clearsMine ? 0 : c.unread,
                members: c.members.map((m) =>
                  m.id === e.user_id ? { ...m, last_read_message_id: Math.max(m.last_read_message_id, e.message_id) } : m,
                ),
              };
            }),
          }));
        }
        case "presence.update":
          return set((s) => {
            const online = { ...s.online };
            if (e.status === "online") online[e.user_id] = true;
            else delete online[e.user_id];
            return { online };
          });
        case "conversation.new":
          return set((s) => ({
            conversations: s.conversations.some((c) => c.id === e.conversation.id)
              ? s.conversations
              : sortConversations([e.conversation, ...s.conversations]),
          }));
        case "error": {
          if (e.client_id) {
            for (const [cid, list] of Object.entries(get().messages)) {
              if (list.some((m) => m.client_id === e.client_id)) setStatus(Number(cid), e.client_id, "failed");
            }
          }
          return set({ notice: e.message });
        }
        default:
          return;
      }
    },

    setConnected(open, reconnected) {
      set({ connected: open });
      if (!(open && reconnected)) return;
      // Fill any gap from while the socket was down.
      void (async () => {
        await get().loadConversations();
        const { activeId, messages, hasMore } = get();
        const keep = activeId !== null && messages[activeId] ? activeId : null;
        set({
          messages: keep !== null ? { [keep]: messages[keep] } : {},
          hasMore: keep !== null ? { [keep]: hasMore[keep] } : {},
        });
        if (keep === null) return;
        try {
          mergeInto(keep, await api.getMessages(keep, { after_id: maxConfirmedId(get().messages[keep] ?? []), limit: 200 }));
          get().markRead(keep);
        } catch {
          /* the next reconnect will try again */
        }
      })();
    },

    setNotice: (text) => set({ notice: text }),
    reset: () => set({ ...initial }),
  };
});

export const socket = new SocketClient(
  (e) => useChat.getState().handleEvent(e),
  (open, reconnected) => useChat.getState().setConnected(open, reconnected),
);
