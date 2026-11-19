import { FormEvent, useState } from "react";
import { useAuth } from "../../store/auth";

export function AuthPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [identifier, setIdentifier] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "login") await login(identifier, password);
      else await register(username, email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const register_ = mode === "register";
  return (
    <div className="auth">
      <section className="auth-brand">
        <h1>Connectly</h1>
        <p>Talk to your people in real time. Direct messages, group chats and shared files in one place.</p>
      </section>
      <section className="auth-panel">
        <form onSubmit={submit} className="auth-form">
          <h2>{register_ ? "Create your account" : "Sign in"}</h2>
          {register_ ? (
            <>
              <label>
                Username
                <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required minLength={3} maxLength={30} pattern="[A-Za-z0-9_.\-]{3,30}" title="3–30 letters, numbers, dots, dashes or underscores" />
              </label>
              <label>
                Email
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
              </label>
            </>
          ) : (
            <label>
              Email or username
              <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" required />
            </label>
          )}
          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={register_ ? "new-password" : "current-password"} required minLength={register_ ? 8 : 1} />
            {register_ && <small>At least 8 characters.</small>}
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="btn primary" disabled={busy}>{busy ? "Please wait…" : register_ ? "Create account" : "Sign in"}</button>
          <button type="button" className="btn link" onClick={() => { setMode(register_ ? "login" : "register"); setError(null); }}>
            {register_ ? "I already have an account" : "Create a new account"}
          </button>
        </form>
      </section>
    </div>
  );
}
