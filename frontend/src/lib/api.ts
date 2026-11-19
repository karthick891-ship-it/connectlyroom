import type { Conversation, Message, Session, User } from "./types";

const REFRESH_KEY = "connectly.refresh";
let accessToken: string | null = null;
let onAuthLost: (() => void) | null = null;

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function setAuthLostHandler(fn: () => void) {
  onAuthLost = fn;
}

function storedRefresh(): string | null {
  try {
    return localStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}

function saveSession(s: Session) {
  accessToken = s.access_token;
  try {
    localStorage.setItem(REFRESH_KEY, s.refresh_token);
  } catch {
    /* storage unavailable: the session lasts until the tab closes */
  }
}

export function clearSession() {
  accessToken = null;
  try {
    localStorage.removeItem(REFRESH_KEY);
  } catch {
    /* ignore */
  }
}

let refreshing: Promise<boolean> | null = null;

/** Exchanges the refresh token for a new pair. Network errors throw; a rejected token returns false. */
export function refreshSession(): Promise<boolean> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const token = storedRefresh();
    if (!token) return false;
    const res = await fetch("/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: token }),
    });
    if (res.status === 401 || res.status === 403) {
      clearSession();
      onAuthLost?.();
      return false;
    }
    if (!res.ok) throw new ApiError(res.status, "Could not refresh the session");
    saveSession(await res.json());
    return true;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

function expiresSoon(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.exp * 1000 - Date.now() < 30_000;
  } catch {
    return true;
  }
}

/** A valid access token, refreshing first when the current one is about to expire. */
export async function ensureAccessToken(): Promise<string | null> {
  if (accessToken && !expiresSoon(accessToken)) return accessToken;
  return (await refreshSession()) ? accessToken : null;
}

async function request<T>(path: string, init: RequestInit = {}, opts = { auth: true, retry: true }): Promise<T> {
  const headers = new Headers(init.headers);
  if (opts.auth && accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`/api${path}`, { ...init, headers });
  if (res.status === 401 && opts.auth && opts.retry) {
    try {
      if (await refreshSession()) return request<T>(path, init, { auth: true, retry: false });
    } catch {
      /* fall through to the error below */
    }
  }
  if (!res.ok) {
    let detail = "Something went wrong. Try again.";
    try {
      const body = await res.json();
      if (typeof body.detail === "string") detail = body.detail;
      else if (Array.isArray(body.detail) && body.detail[0]?.msg) detail = String(body.detail[0].msg);
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, detail);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

const noAuth = { auth: false, retry: false };

export async function register(username: string, email: string, password: string): Promise<User> {
  const s = await request<Session>("/auth/register", { method: "POST", body: JSON.stringify({ username, email, password }) }, noAuth);
  saveSession(s);
  return s.user;
}

export async function login(identifier: string, password: string): Promise<User> {
  const s = await request<Session>("/auth/login", { method: "POST", body: JSON.stringify({ identifier, password }) }, noAuth);
  saveSession(s);
  return s.user;
}

/** Restores a session from the stored refresh token. Returns null when signed out. */
export async function restoreSession(): Promise<User | null> {
  try {
    if (!(await refreshSession())) return null;
    return await request<User>("/auth/me");
  } catch {
    return null;
  }
}

export async function logout(): Promise<void> {
  const token = storedRefresh();
  clearSession();
  if (token) {
    try {
      await request("/auth/logout", { method: "POST", body: JSON.stringify({ refresh_token: token }) }, noAuth);
    } catch {
      /* best effort */
    }
  }
}

export const listConversations = () => request<Conversation[]>("/conversations");

export const createDirect = (userId: number) =>
  request<Conversation>("/conversations", { method: "POST", body: JSON.stringify({ type: "direct", user_id: userId }) });

export const createGroup = (name: string, memberIds: number[]) =>
  request<Conversation>("/conversations", { method: "POST", body: JSON.stringify({ type: "group", name, member_ids: memberIds }) });

export function getMessages(id: number, p: { before_id?: number; after_id?: number; limit?: number } = {}) {
  const q = new URLSearchParams();
  if (p.before_id !== undefined) q.set("before_id", String(p.before_id));
  if (p.after_id !== undefined) q.set("after_id", String(p.after_id));
  if (p.limit !== undefined) q.set("limit", String(p.limit));
  return request<Message[]>(`/conversations/${id}/messages?${q}`);
}

export const searchUsers = (q: string) => request<User[]>(`/users?q=${encodeURIComponent(q)}`);

export const onlineUsers = (ids: number[]) => request<{ online: number[] }>(`/users/online?ids=${ids.join(",")}`);

export function uploadFile(file: File) {
  const form = new FormData();
  form.append("file", file);
  return request<{ url: string; mime_type: string; size_bytes: number; filename: string }>("/uploads", { method: "POST", body: form });
}
