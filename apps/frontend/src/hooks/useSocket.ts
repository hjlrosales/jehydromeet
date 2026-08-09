'use client';

import { useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000';

let globalSocket: Socket | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Hook that returns the singleton Socket.IO client instance.
 * Connects on mount and disconnects on unmount.
 * Uses dynamic import for socket.io-client to avoid Next.js SSR
 * bundling the Node.js 'ws' module (a transitive dependency).
 */
export function useSocket(): Socket | null {
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    if (globalSocket) {
      if (globalSocket.connected) {
        setSocket(globalSocket);
      }
      return;
    }

    if (initPromise) return;

    // Dynamically import socket.io-client to prevent SSR bundling of 'ws'
    initPromise = (async () => {
      try {
        const { io } = await import('socket.io-client');
        // Double-check: another call may have initialized while we were awaiting
        if (globalSocket) return;
        // Pass JWT token in auth for meeting history recording (Phase 15)
        const token = typeof window !== 'undefined' ? localStorage.getItem('jehydro-jwt') : null;
        globalSocket = io(BACKEND_URL, {
          transports: ['websocket', 'polling'],
          autoConnect: true,
          reconnection: true,
          reconnectionAttempts: 5,
          reconnectionDelay: 1000,
          auth: token ? { token } : undefined,
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
      } catch (err) {
        console.error('[socket] Dynamic import failed:', err);
        initPromise = null;
      }
    })();

    return () => {
      // Don't disconnect on unmount — keep socket alive for page navigation
    };
  }, []);

  return socket;
}
