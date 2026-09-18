import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { MinecraftAccount } from '@/types';

interface AuthStore {
  account: MinecraftAccount | null;
  isLoading: boolean;
  error: string | null;
  loginMicrosoft: () => Promise<MinecraftAccount | null>;
  loginOffline: (username: string) => Promise<void>;
  logout: () => Promise<void>;
  checkSession: () => Promise<void>;
}

export const useAuthStore = create<AuthStore>((set) => ({
  account: null,
  isLoading: false,
  error: null,

  loginMicrosoft: async () => {
    set({ isLoading: true, error: null });
    try {
      const account = await invoke<MinecraftAccount>('login_microsoft');
      set({ account, isLoading: false });
      return account;
    } catch (error) {
      set({ error: String(error), isLoading: false });
      throw error;
    }
  },

  loginOffline: async (username: string) => {
    set({ isLoading: true, error: null });
    try {
      const account = await invoke<MinecraftAccount>('login_offline', { username });
      set({ account, isLoading: false });
    } catch (error) {
      set({ error: String(error), isLoading: false });
      throw error;
    }
  },

  logout: async () => {
    try {
      await invoke('logout');
      set({ account: null });
    } catch (error) {
      set({ error: String(error) });
    }
  },

  checkSession: async () => {
    try {
      const account = await invoke<MinecraftAccount | null>('check_session');
      if (account) {
        set({ account });
      }
    } catch {
      set({ account: null });
    }
  },
}));
