'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../../stores/auth';
import Sidebar from '../../components/Sidebar';
import FloatingChat from '../../components/FloatingChat';

// 토큰 갱신 인터벌 (3시간)
const REFRESH_INTERVAL = 3 * 60 * 60 * 1000;

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, accessToken, initializeAuth, refreshToken } = useAuthStore();
  const [initialized, setInitialized] = useState(false);
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // 앱 초기화 - 저장된 토큰 복원
  useEffect(() => {
    const init = async () => {
      await initializeAuth();
      setInitialized(true);
    };
    init();
  }, [initializeAuth]);

  // 주기적 토큰 갱신
  useEffect(() => {
    if (accessToken && initialized) {
      // 3시간마다 토큰 갱신
      refreshIntervalRef.current = setInterval(() => {
        refreshToken();
      }, REFRESH_INTERVAL);

      return () => {
        if (refreshIntervalRef.current) {
          clearInterval(refreshIntervalRef.current);
        }
      };
    }
  }, [accessToken, initialized, refreshToken]);

  // 로그인 상태 확인
  useEffect(() => {
    if (initialized && !user && !accessToken) {
      router.replace('/login');
    }
  }, [user, accessToken, initialized, router]);

  if (!initialized) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-slate-400">인증 확인 중...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-slate-400">로딩 중...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-6">{children}</div>
      </main>
      <FloatingChat />
    </div>
  );
}
