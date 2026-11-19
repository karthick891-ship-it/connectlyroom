import { useLayoutEffect, useRef } from "react";
import { formatClock, formatDayLabel, formatSize } from "../../lib/messages";
import type { Message } from "../../lib/types";
import { useAuth } from "../../store/auth";
import { useChat } from "../../store/chat";

const EMPTY: Message[] = [];

export function MessageList({ cid }: { cid: number }) {
  const me = useAuth((s) => s.user)!;
  const messages = useChat((s) => s.messages[cid]) ?? EMPTY;
  const hasMore = useChat((s) => !!s.hasMore[cid]);
  const conv = useChat((s) => s.conversations.find((c) => c.id === cid));
  const loadOlder = useChat((s) => s.loadOlder);
  const retry = useChat((s) => s.retry);

  const box = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  useLayoutEffect(() => {
    const el = box.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function onScroll() {
    const el = box.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 60 && hasMore) {
      const before = el.scrollHeight;
      void loadOlder(cid).then(() =>
        requestAnimationFrame(() => {
          el.scrollTop += el.scrollHeight - before; // keep the reading position after prepending
        }),
      );
    }
  }

  const onMediaLoad = () => {
    const el = box.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  };

  const lastOwn = [...messages].reverse().find((m) => m.sender_id === me.id && m.id > 0 && !m.deleted);
  const seenBy = lastOwn && conv ? conv.members.filter((m) => m.id !== me.id && m.last_read_message_id >= lastOwn.id).length : 0;
  const nameOf = (id: number) => conv?.members.find((m) => m.id === id)?.username ?? "Someone";

  if (messages.length === 0) {
    return (
      <div className="messages empty" ref={box}>
        <p>No messages yet. Say hello.</p>
      </div>
    );
  }

  return (
    <div className="messages" ref={box} onScroll={onScroll}>
      {hasMore && <p className="older">Loading earlier messages…</p>}
      {messages.map((m, i) => {
        const prev = messages[i - 1];
        const mine = m.sender_id === me.id;
        const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();
        const showName = conv?.type === "group" && !mine && (!prev || prev.sender_id !== m.sender_id || newDay);
        return (
          <div key={m.client_id || m.id}>
            {newDay && <div className="day">{formatDayLabel(m.created_at)}</div>}
            <div className={`row ${mine ? "mine" : "theirs"}`}>
              <div className={`bubble ${m.deleted ? "deleted" : ""} ${m.status === "failed" ? "failed" : ""}`}>
                {showName && <span className="sender">{nameOf(m.sender_id)}</span>}
                {m.deleted ? (
                  <span>This message was deleted</span>
                ) : (
                  <>
                    {m.attachments.map((a) =>
                      a.mime_type.startsWith("image/") ? (
                        <a key={a.url} href={a.url} target="_blank" rel="noreferrer noopener">
                          <img className="photo" src={a.url} alt={a.filename ?? "Shared image"} onLoad={onMediaLoad} />
                        </a>
                      ) : (
                        <a key={a.url} className="file" href={a.url} target="_blank" rel="noreferrer noopener" download={a.filename ?? undefined}>
                          <strong>{a.filename ?? "File"}</strong>
                          <span>{formatSize(a.size_bytes)}</span>
                        </a>
                      ),
                    )}
                    {m.content && <p className="text">{m.content}</p>}
                  </>
                )}
                <span className="meta">
                  {m.edited_at && !m.deleted && "Edited · "}
                  {formatClock(m.created_at)}
                </span>
              </div>
            </div>
            {mine && m.status === "sending" && <div className="receipt">Sending…</div>}
            {mine && m.status === "failed" && (
              <div className="receipt error">
                Not sent. <button className="btn link" onClick={() => retry(cid, m.client_id)}>Try again</button>
              </div>
            )}
            {lastOwn?.id === m.id && seenBy > 0 && (
              <div className="receipt">{conv?.type === "group" ? `Seen by ${seenBy}` : "Seen"}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
