import { create } from "zustand";
import { api } from "../api/client.js";

interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  init: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, name: string, password: string) => Promise<void>;
  logout: () => void;
}

const TOKEN_KEY = "vyom_token";
const USER_KEY = "vyom_user";

export const useAuth = create<AuthState>((set) => ({
  user: JSON.parse(localStorage.getItem(USER_KEY) ?? "null"),
  token: localStorage.getItem(TOKEN_KEY),
  loading: true,

  init: async () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      set({ loading: false });
      return;
    }
    try {
      const { user } = await api.auth.me();
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      set({ user, token, loading: false });
    } catch {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      set({ user: null, token: null, loading: false });
    }
  },

  login: async (email, password) => {
    const { token, user } = await api.auth.login(email, password);
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    set({ token, user });
  },

  register: async (email, name, password) => {
    await api.auth.register(email, name, password);
    await useAuth.getState().login(email, password);
  },

  logout: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    set({ user: null, token: null });
  },
}));
