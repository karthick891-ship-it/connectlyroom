import { FormEvent, useEffect, useState } from "react";
import { Avatar } from "../../components/Avatar";
import * as api from "../../lib/api";
import type { User } from "../../lib/types";
import { useChat } from "../../store/chat";

export function NewChatDialog({ onClose }: { onClose: () => void }) {
  const { startDirect, startGroup, openConversation } = useChat();
  const [tab, setTab] = useState<"direct" | "group">("direct");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<User[]>([]);
  const [picked, setPicked] = useState<User[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!query.trim()) return setResults([]);
    const t = window.setTimeout(() => {
      api.searchUsers(query.trim()).then(setResults).catch(() => setResults([]));
    }, 250);
    return () => window.clearTimeout(t);
  }, [query]);

  async function finish(run: () => Promise<number>) {
    setError(null);
    setBusy(true);
    try {
      await openConversation(await run());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t start the chat.");
      setBusy(false);
    }
  }

  const togglePick = (u: User) =>
    setPicked((p) => (p.some((x) => x.id === u.id) ? p.filter((x) => x.id !== u.id) : [...p, u]));

  function createGroup(e: FormEvent) {
    e.preventDefault();
    void finish(() => startGroup(name.trim(), picked.map((u) => u.id)));
  }

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="New chat">
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === "direct"} className={tab === "direct" ? "on" : ""} onClick={() => setTab("direct")}>Direct message</button>
          <button role="tab" aria-selected={tab === "group"} className={tab === "group" ? "on" : ""} onClick={() => setTab("group")}>Group</button>
        </div>

        <form onSubmit={createGroup} className="dialog-body">
          {tab === "group" && (
            <label>
              Group name
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required placeholder="Weekend trip" />
            </label>
          )}
          <label>
            Find people by username
            <input value={query} onChange={(e) => setQuery(e.target.value)} autoFocus placeholder="Start typing…" />
          </label>

          {tab === "group" && picked.length > 0 && (
            <div className="chips">
              {picked.map((u) => (
                <button type="button" key={u.id} className="chip" onClick={() => togglePick(u)} aria-label={`Remove ${u.username}`}>
                  {u.username} ×
                </button>
              ))}
            </div>
          )}

          <ul className="results">
            {results.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  className="result"
                  disabled={busy}
                  onClick={() => (tab === "direct" ? void finish(() => startDirect(u.id)) : togglePick(u))}
                >
                  <Avatar name={u.username} size={32} />
                  <span>{u.username}</span>
                  {tab === "group" && picked.some((x) => x.id === u.id) && <span className="picked">Added</span>}
                </button>
              </li>
            ))}
            {query.trim() && results.length === 0 && <li className="muted">No one found with that username.</li>}
          </ul>

          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            {tab === "group" && (
              <button className="btn primary" disabled={busy || !name.trim() || picked.length === 0}>Create group</button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
