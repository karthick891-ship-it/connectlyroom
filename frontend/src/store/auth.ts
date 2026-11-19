import { create } from "zustand";
import * as api from "../lib/api";
import type { User } from "../lib/types";

interface AuthState {
  user: User | null;
  ready: boolean;
  init: () => Promise<void>;
  login: (identifier: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  ready: false,
  async init() {
    set({ user: await api.restoreSession(), ready: true });
  },
  async login(identifier, password) {
    set({ user: await api.login(identifier, password) });
  },
  async register(username, email, password) {
    set({ user: await api.register(username, email, password) });
  },
  async logout() {
    await api.logout();
    set({ user: null });
  },
}));
