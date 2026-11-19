export interface User {
  id: number;
  username: string;
  email?: string;
  avatar_url?: string | null;
}

export interface Member extends User {
  last_read_message_id: number;
}

export interface Attachment {
  id?: number;
  url: string;
  mime_type: string;
  size_bytes: number;
  filename?: string | null;
}

export type MessageKind = "text" | "image" | "file" | "system";

export interface Message {
  id: number; // negative while a message is still pending
  conversation_id: number;
  sender_id: number;
  client_id: string;
  type: MessageKind;
  content: string | null;
  created_at: string;
  edited_at: string | null;
  deleted: boolean;
  attachments: Attachment[];
  status?: "sending" | "sent" | "failed";
}

export interface Conversation {
  id: number;
  type: "direct" | "group";
  name: string | null;
  members: Member[];
  last_message: Message | null;
  last_activity: string;
  unread: number;
}

export interface Session {
  access_token: string;
  refresh_token: string;
  user: User;
}

// Events pushed by the server over the WebSocket.
export type ServerEvent =
  | { type: "message.new"; message: Message }
  | { type: "message.ack"; client_id: string; message: Message }
  | { type: "message.updated"; message: Message }
  | { type: "message.read"; conversation_id: number; user_id: number; message_id: number }
  | { type: "typing"; conversation_id: number; user_id: number }
  | { type: "presence.update"; user_id: number; status: "online" | "offline" }
  | { type: "conversation.new"; conversation: Conversation }
  | { type: "error"; code: string; message: string; client_id?: string | null }
  | { type: "pong" };
