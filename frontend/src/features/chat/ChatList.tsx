import { Avatar } from "../../components/Avatar";
import { conversationTitle, formatListTime, otherMember, previewText } from "../../lib/messages";
import { useAuth } from "../../store/auth";
import { useChat } from "../../store/chat";

export function ChatList() {
  const me = useAuth((s) => s.user)!;
  const conversations = useChat((s) => s.conversations);
  const activeId = useChat((s) => s.activeId);
  const online = useChat((s) => s.online);
  const open = useChat((s) => s.openConversation);

  if (conversations.length === 0) {
    return <p className="list-empty">No chats yet. Choose “New chat” to message someone.</p>;
  }

  return (
    <ul className="chat-list">
      {conversations.map((c) => {
        const title = conversationTitle(c, me.id);
        const other = otherMember(c, me.id);
        return (
          <li key={c.id}>
            <button className={`chat-item ${c.id === activeId ? "active" : ""}`} onClick={() => void open(c.id)}>
              <Avatar name={title} online={c.type === "direct" && other ? !!online[other.id] : undefined} />
              <span className="chat-text">
                <span className="chat-top">
                  <span className="chat-title">{title}</span>
                  <time>{formatListTime(c.last_activity)}</time>
                </span>
                <span className="chat-bottom">
                  <span className="chat-preview">{previewText(c, me.id)}</span>
                  {c.unread > 0 && <span className="badge" aria-label={`${c.unread} unread`}>{c.unread >= 100 ? "99+" : c.unread}</span>}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
