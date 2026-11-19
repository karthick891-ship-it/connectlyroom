import { useState } from "react";
import { Avatar } from "../../components/Avatar";
import { useAuth } from "../../store/auth";
import { useChat } from "../../store/chat";
import { ChatList } from "./ChatList";
import { ConversationView } from "./ConversationView";
import { NewChatDialog } from "./NewChatDialog";

export function ChatLayout() {
  const me = useAuth((s) => s.user)!;
  const logout = useAuth((s) => s.logout);
  const activeId = useChat((s) => s.activeId);
  const connected = useChat((s) => s.connected);
  const notice = useChat((s) => s.notice);
  const setNotice = useChat((s) => s.setNotice);
  const [dialog, setDialog] = useState(false);

  return (
    <div className={`app ${activeId !== null ? "has-active" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-head">
          <span className="brand">Connectly</span>
          <button className="btn accent" onClick={() => setDialog(true)}>New chat</button>
        </div>
        {!connected && <div className="conn" role="status">Reconnecting…</div>}
        <ChatList />
        <div className="me">
          <Avatar name={me.username} size={32} />
          <span>{me.username}</span>
          <button className="btn link light" onClick={() => void logout()}>Sign out</button>
        </div>
      </aside>

      <main className="main">
        {notice && (
          <div className="notice" role="alert">
            <span>{notice}</span>
            <button className="btn link" onClick={() => setNotice(null)}>Dismiss</button>
          </div>
        )}
        {activeId !== null ? (
          <ConversationView key={activeId} id={activeId} />
        ) : (
          <div className="messages empty"><p>Select a chat, or start a new one.</p></div>
        )}
      </main>

      {dialog && <NewChatDialog onClose={() => setDialog(false)} />}
    </div>
  );
}
