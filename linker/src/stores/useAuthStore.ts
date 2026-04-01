import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

interface AuthState {
  isAuthenticated: boolean;
  loading: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  checkSession: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  loading: true,

  checkSession: async () => {
    const token = localStorage.getItem('linker_token');
    if (!token) {
      set({ isAuthenticated: false, loading: false });
      return;
    }
    try {
      const result = await invoke<{ valid: boolean }>('check_session', { token });
      set({ isAuthenticated: !!result?.valid, loading: false });
    } catch {
      set({ isAuthenticated: false, loading: false });
    }
  },

  login: async (username: string, password: string) => {
    try {
      const result = await invoke<{ success: boolean; token?: string; error?: string }>(
        'login',
        { username, password }
      );
      if (result.success && result.token) {
        localStorage.setItem('linker_token', result.token);
        set({ isAuthenticated: true });
        return { success: true };
      }
      return { success: false, error: result.error || 'Error al iniciar sesion' };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  },

  logout: () => {
    localStorage.removeItem('linker_token');
    set({ isAuthenticated: false });
  },
}));
