import { useEffect, useState } from "react";
import { Avatar } from "../../components/Avatar";
import { conversationTitle, otherMember } from "../../lib/messages";
import { useAuth } from "../../store/auth";
import { useChat } from "../../store/chat";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";

const TYPING_VISIBLE_MS = 3500;

function useTick(ms: number) {
  const [, setN] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setN((n) => n + 1), ms);
    return () => window.clearInterval(t);
  }, [ms]);
}

export function ConversationView({ id }: { id: number }) {
  const me = useAuth((s) => s.user)!;
  const conv = useChat((s) => s.conversations.find((c) => c.id === id));
  const typing = useChat((s) => s.typing[id]);
  const online = useChat((s) => s.online);
  const close = useChat((s) => s.openConversation);
  useTick(1000);

  if (!conv) return <div className="messages empty"><p>This chat is no longer available.</p></div>;

  const title = conversationTitle(conv, me.id);
  const other = otherMember(conv, me.id);
  const typers = Object.entries(typing ?? {})
    .filter(([uid, at]) => Number(uid) !== me.id && Date.now() - at < TYPING_VISIBLE_MS)
    .map(([uid]) => conv.members.find((m) => m.id === Number(uid))?.username ?? "Someone");

  let subtitle: string;
  if (typers.length) subtitle = conv.type === "group" ? `${typers.join(", ")} ${typers.length > 1 ? "are" : "is"} typing…` : "typing…";
  else if (conv.type === "group") subtitle = `${conv.members.length} members`;
  else subtitle = other && online[other.id] ? "Online" : "Offline";

  return (
    <>
      <header className="conv-header">
        <button className="icon-btn back" onClick={() => void close(null)} aria-label="Back to chats">‹</button>
        <Avatar name={title} online={conv.type === "direct" && other ? !!online[other.id] : undefined} />
        <div>
          <h2>{title}</h2>
          <p className={typers.length ? "typing" : ""}>{subtitle}</p>
        </div>
      </header>
      <MessageList cid={id} />
      <Composer cid={id} />
    </>
  );
}
