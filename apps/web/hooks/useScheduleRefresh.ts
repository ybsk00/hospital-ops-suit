'use client';

import { useEffect } from 'react';
import { useSocket } from './useSocket';

export function useScheduleRefresh(refreshFn: () => void) {
  const socket = useSocket();

  useEffect(() => {
    if (!socket) return;

    const handle = () => refreshFn();

    socket.on('booking:created', handle);
    socket.on('booking:modified', handle);
    socket.on('booking:cancelled', handle);

    return () => {
      socket.off('booking:created', handle);
      socket.off('booking:modified', handle);
      socket.off('booking:cancelled', handle);
    };
  }, [socket, refreshFn]);
}
