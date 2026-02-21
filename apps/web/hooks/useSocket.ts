'use client';

import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../stores/auth';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

let globalSocket: Socket | null = null;

export function getSocket(): Socket | null {
  return globalSocket;
}

export function useSocket(): Socket | null {
  const { accessToken } = useAuthStore();
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!accessToken) return;

    if (globalSocket?.connected) {
      socketRef.current = globalSocket;
      return;
    }

    const socket = io(API_BASE, {
      path: '/ws',
      auth: { token: accessToken },
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 2000,
    });

    globalSocket = socket;
    socketRef.current = socket;

    return () => {
      // Keep alive for session — don't disconnect on unmount
    };
  }, [accessToken]);

  return socketRef.current;
}
