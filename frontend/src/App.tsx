import { useEffect } from "react";
import { AuthPage } from "./features/auth/AuthPage";
import { ChatLayout } from "./features/chat/ChatLayout";
import { useAuth } from "./store/auth";
import { socket, useChat } from "./store/chat";

export default function App() {
  const { user, ready, init } = useAuth();
  const userId = user?.id;

  useEffect(() => {
    void init();
  }, [init]);

  // Connect when signed in, tear everything down when signed out.
  useEffect(() => {
    if (!userId) {
      socket.stop();
      useChat.getState().reset();
      return;
    }
    socket.start();
    void useChat.getState().loadConversations();
    return () => socket.stop();
  }, [userId]);

  // Mark the open chat as read when the tab becomes visible again.
  useEffect(() => {
    const onVisible = () => {
      const id = useChat.getState().activeId;
      if (!document.hidden && id !== null) useChat.getState().markRead(id);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  if (!ready) return <div className="splash">Connectly</div>;
  return user ? <ChatLayout /> : <AuthPage />;
}
