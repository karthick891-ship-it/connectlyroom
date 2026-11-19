const TONES = ["#1B7F79", "#C2571A", "#5B4B9A", "#9A3B5B", "#2F6DB5", "#6B7F1E"];

function tone(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length];
}

interface Props {
  name: string;
  size?: number;
  online?: boolean;
}

export function Avatar({ name, size = 40, online }: Props) {
  const initials = name.trim().slice(0, 2).toUpperCase() || "?";
  return (
    <span className="avatar" style={{ width: size, height: size, background: tone(name), fontSize: size * 0.38 }} aria-hidden="true">
      {initials}
      {online !== undefined && <span className={`presence ${online ? "on" : ""}`} />}
    </span>
  );
}
