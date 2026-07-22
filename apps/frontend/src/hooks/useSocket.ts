'use client';

import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000';

let globalSocket: Socket | null = null;

/**
 * Hook that returns the singleton Socket.IO client instance.
 * Connects on mount and disconnects on unmount.
 */
export function useSocket(): Socket | null {
  const [socket, setSocket] = useState<Socket | null>(globalSocket);

  useEffect(() => {
    if (!globalSocket) {
      globalSocket = io(BACKEND_URL, {
        transports: ['websocket', 'polling'],
        autoConnect: true,
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
      });

      globalSocket.on('connect', () => {
        console.log('[socket] Connected:', globalSocket?.id);
        setSocket(globalSocket);
      });

      globalSocket.on('disconnect', (reason) => {
        console.log('[socket] Disconnected:', reason);
      });

      globalSocket.on('connect_error', (err) => {
        console.error('[socket] Connection error:', err.message);
      });
    } else if (globalSocket.connected) {
      setSocket(globalSocket);
    }

    return () => {
      // Don't disconnect on unmount — keep socket alive for page navigation
    };
  }, []);

  return socket;
}
