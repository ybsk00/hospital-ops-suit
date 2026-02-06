'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api, ApiError } from '../lib/api';

interface Department {
  departmentId: string;
  departmentName: string;
  role: string;
  isPrimary: boolean;
}

interface User {
  id: string;
  loginId: string;
  name: string;
  isSuperAdmin: boolean;
  departments: Department[];
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isLoading: boolean;
  error: string | null;
  lastRefresh: number | null;

  login: (loginId: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<void>;
  fetchMe: () => Promise<void>;
  clearError: () => void;
  initializeAuth: () => Promise<void>;
}

// 토큰 갱신 인터벌 (3시간마다 - Access Token 4시간 만료 전에)
const REFRESH_INTERVAL = 3 * 60 * 60 * 1000;

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      isLoading: false,
      error: null,
      lastRefresh: null,

      login: async (loginId: string, password: string) => {
        set({ isLoading: true, error: null });
        try {
          const res = await api<{ accessToken: string; user: User }>('/api/auth/login', {
            method: 'POST',
            body: { loginId, password },
          });
          set({
            user: res.data!.user,
            accessToken: res.data!.accessToken,
            isLoading: false,
            lastRefresh: Date.now(),
          });
        } catch (err) {
          const message = err instanceof ApiError ? err.message : '로그인에 실패했습니다.';
          set({ isLoading: false, error: message });
          throw err;
        }
      },

      logout: async () => {
        try {
          await api('/api/auth/logout', { method: 'POST', token: get().accessToken || undefined });
        } catch {
          // ignore
        }
        set({ user: null, accessToken: null, lastRefresh: null });
      },

      refreshToken: async () => {
        try {
          const res = await api<{ accessToken: string }>('/api/auth/refresh', { method: 'POST' });
          set({ accessToken: res.data!.accessToken, lastRefresh: Date.now() });
        } catch {
          set({ user: null, accessToken: null, lastRefresh: null });
        }
      },

      fetchMe: async () => {
        const token = get().accessToken;
        if (!token) return;
        try {
          const res = await api<User>('/api/auth/me', { token });
          set({ user: res.data! });
        } catch {
          // token might be expired, try refresh
          await get().refreshToken();
          // retry fetchMe after refresh
          const newToken = get().accessToken;
          if (newToken) {
            try {
              const res = await api<User>('/api/auth/me', { token: newToken });
              set({ user: res.data! });
            } catch {
              set({ user: null, accessToken: null, lastRefresh: null });
            }
          }
        }
      },

      clearError: () => set({ error: null }),

      // 앱 초기화 시 호출 - 저장된 토큰 복원 + 필요시 갱신
      initializeAuth: async () => {
        const { accessToken, lastRefresh } = get();

        if (!accessToken) return;

        const now = Date.now();
        const needsRefresh = !lastRefresh || (now - lastRefresh) > REFRESH_INTERVAL;

        if (needsRefresh) {
          // 토큰 갱신 시도
          await get().refreshToken();
        }

        // 사용자 정보 로드
        await get().fetchMe();
      },
    }),
    {
      name: 'seoul-oncare-auth', // localStorage 키
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        lastRefresh: state.lastRefresh,
      }),
    }
  )
);
