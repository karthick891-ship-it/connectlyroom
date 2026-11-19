import type { Conversation, Message, User } from "./types";

/** Pending (optimistic) messages sort after confirmed ones; confirmed ones sort by id. */
function order(a: Message, b: Message): number {
  const pa = a.id <= 0;
  const pb = b.id <= 0;
  if (pa !== pb) return pa ? 1 : -1;
  if (!pa) return a.id - b.id;
  return Date.parse(a.created_at) - Date.parse(b.created_at);
}

/** Insert or replace a message, matching on server id or on the client-generated id. */
export function upsertMessage(list: Message[], msg: Message): Message[] {
  const next = list.slice();
  const i = next.findIndex((m) => m.id === msg.id || (!!m.client_id && m.client_id === msg.client_id));
  const stored: Message = msg.id > 0 ? { ...msg, status: "sent" } : msg;
  if (i >= 0) next[i] = stored;
  else next.push(stored);
  return next.sort(order);
}

export function maxConfirmedId(list: Message[]): number {
  return list.reduce((max, m) => (m.id > max ? m.id : max), 0);
}

export function sortConversations(list: Conversation[]): Conversation[] {
  return list.slice().sort((a, b) => Date.parse(b.last_activity) - Date.parse(a.last_activity));
}

export function newClientId(): string {
  const c = globalThis.crypto as Crypto;
  // randomUUID only exists in secure contexts (https or localhost), so keep a fallback.
  if (typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function conversationTitle(c: Conversation, meId: number): string {
  if (c.type === "group") return c.name ?? "Group";
  return c.members.find((m) => m.id !== meId)?.username ?? "Conversation";
}

export function otherMember(c: Conversation, meId: number): User | undefined {
  return c.members.find((m) => m.id !== meId);
}

export function previewText(c: Conversation, meId: number): string {
  const m = c.last_message;
  if (!m) return "No messages yet";
  let body: string;
  if (m.deleted) body = "Message deleted";
  else if (m.type === "image") body = m.content ? `Photo: ${m.content}` : "Photo";
  else if (m.type === "file") body = m.content ? `File: ${m.content}` : "File";
  else body = m.content ?? "";
  if (m.sender_id === meId) return `You: ${body}`;
  if (c.type === "group") {
    const who = c.members.find((x) => x.id === m.sender_id)?.username;
    return who ? `${who}: ${body}` : body;
  }
  return body;
}

export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatListTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (d.toDateString() === now.toDateString()) return formatClock(iso);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

export function formatDayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (d.toDateString() === now.toDateString()) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
