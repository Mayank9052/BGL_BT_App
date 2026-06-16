import { create } from "zustand";
import type { UserProfile } from "../types/user";

interface AuthState {
  user: UserProfile | null;
  loading: boolean;
  setUser: (user: UserProfile) => void;
  setLoading: (v: boolean) => void;
  clearUser: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: false,
  setUser: (user) => set({ user }),
  setLoading: (loading) => set({ loading }),
  clearUser: () => set({ user: null }),
}));