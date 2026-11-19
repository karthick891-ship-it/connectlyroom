import { ChangeEvent, KeyboardEvent, useRef, useState } from "react";
import * as api from "../../lib/api";
import { useChat } from "../../store/chat";

export function Composer({ cid }: { cid: number }) {
  const send = useChat((s) => s.send);
  const notifyTyping = useChat((s) => s.notifyTyping);
  const setNotice = useChat((s) => s.setNotice);
  const [text, setText] = useState("");
  const [uploading, setUploading] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function resize() {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  function submit() {
    const content = text.trim();
    if (!content) return;
    send(cid, { kind: "text", content });
    setText("");
    requestAnimationFrame(resize);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  function onChange(e: ChangeEvent<HTMLTextAreaElement>) {
    setText(e.target.value);
    if (e.target.value) notifyTyping(cid);
    resize();
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const up = await api.uploadFile(file);
      const caption = text.trim() || null;
      send(cid, {
        kind: up.mime_type.startsWith("image/") ? "image" : "file",
        content: caption,
        attachment: { url: up.url, mime_type: up.mime_type, size_bytes: up.size_bytes, filename: up.filename },
      });
      if (caption) setText("");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Couldn’t upload that file.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="composer">
      <input ref={fileInput} type="file" hidden onChange={onFile} accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,application/zip" />
      <button className="icon-btn" onClick={() => fileInput.current?.click()} disabled={uploading} aria-label="Attach a file" title="Attach a file">
        {uploading ? "…" : "+"}
      </button>
      <textarea ref={area} rows={1} value={text} onChange={onChange} onKeyDown={onKeyDown} placeholder="Write a message" aria-label="Message" maxLength={4000} />
      <button className="btn primary send" onClick={submit} disabled={!text.trim()}>Send</button>
    </div>
  );
}
