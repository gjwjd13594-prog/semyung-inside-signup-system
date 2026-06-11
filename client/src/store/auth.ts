import { create } from "zustand";
import { api, User } from "../api/client";

type AuthStore = {
  initialized: boolean;
  loading: boolean;
  user: User | null;
  setUser: (user: User | null) => void;
  loadMe: () => Promise<void>;
  logout: () => Promise<void>;
};

export const useAuthStore = create<AuthStore>((set) => ({
  initialized: false,
  loading: false,
  user: null,
  setUser: (user) => set({ user }),
  loadMe: async () => {
    set({ loading: true });
    try {
      const { data } = await api.get("/api/auth/me");
      set({ initialized: true, loading: false, user: data.user });
    } catch {
      set({ initialized: true, loading: false, user: null });
    }
  },
  logout: async () => {
    await api.post("/api/auth/logout");
    localStorage.removeItem("accessToken");
    set({ user: null });
  },
}));
