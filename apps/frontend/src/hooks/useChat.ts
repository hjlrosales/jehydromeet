'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { SocketEvents } from '@jehydro/shared-types';
import type { ChatMessage, ChatMessagePayload } from '@jehydro/shared-types';

export interface ChatMessageWithId extends ChatMessage {
  isOwn: boolean;
}

interface UseChatResult {
  messages: ChatMessageWithId[];
  unreadCount: number;
  chatEnabled: boolean;
  sendMessage: (text: string) => void;
  clearUnread: () => void;
  setMyUuid: (uuid: string) => void;
  setPanelOpen: (open: boolean) => void;
  setSocket: (s: Socket | null) => void;
}

/**
 * Hook for in-meeting ephemeral chat.
 * Messages are not persisted — only stored in memory for the current session.
 */
export function useChat(): UseChatResult {
  const [messages, setMessages] = useState<ChatMessageWithId[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [chatEnabled, setChatEnabled] = useState(true);
  const [socketReady, setSocketReady] = useState(false);
  const myUuidRef = useRef<string>('');
  const socketRef = useRef<Socket | null>(null);
  const isPanelOpenRef = useRef(false);
  const messageIdCounter = useRef(0);

  const setSocket = useCallback((s: Socket | null) => {
    socketRef.current = s;
    setSocketReady(s !== null);
  }, []);

  const setMyUuid = useCallback((uuid: string) => {
    myUuidRef.current = uuid;
  }, []);

  const setPanelOpen = useCallback((open: boolean) => {
    isPanelOpenRef.current = open;
    if (open) setUnreadCount(0);
  }, []);

  const clearUnread = useCallback(() => {
    setUnreadCount(0);
  }, []);

  const sendMessage = useCallback((text: string) => {
    const socket = socketRef.current;
    if (!socket || !text.trim()) return;
    const trimmed = text.trim();
    if (trimmed.length > 2000) return;

    const id = `msg-${++messageIdCounter.current}-${Date.now()}`;
    const message: ChatMessageWithId = {
      id,
      senderUuid: myUuidRef.current,
      senderName: '',
      text: trimmed,
      timestamp: Date.now(),
      isOwn: true,
    };

    setMessages((prev) => [...prev, message]);

    socket.emit(SocketEvents.CHAT_MESSAGE, {
      message: {
        id,
        senderUuid: myUuidRef.current,
        senderName: '',
        text: trimmed,
        timestamp: Date.now(),
      },
    } satisfies ChatMessagePayload);
  }, []);

  // Attach/reattach socket listeners when socketRef changes
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    const onMessage = (payload: ChatMessagePayload) => {
      const msg: ChatMessageWithId = {
        ...payload.message,
        isOwn: payload.message.senderUuid === myUuidRef.current,
      };

      setMessages((prev) => [...prev, msg]);

      if (!isPanelOpenRef.current) {
        setUnreadCount((prev) => prev + 1);
      }
    };

    const onChatDisabled = () => {
      setChatEnabled(false);
    };

    const onChatEnabled = () => {
      setChatEnabled(true);
    };

    socket.on(SocketEvents.CHAT_MESSAGE, onMessage);
    socket.on(SocketEvents.CHAT_DISABLED, onChatDisabled);
    socket.on(SocketEvents.CHAT_ENABLED, onChatEnabled);

    return () => {
      socket.off(SocketEvents.CHAT_MESSAGE, onMessage);
      socket.off(SocketEvents.CHAT_DISABLED, onChatDisabled);
      socket.off(SocketEvents.CHAT_ENABLED, onChatEnabled);
    };
  }, [socketReady]);

  return {
    messages,
    unreadCount,
    chatEnabled,
    sendMessage,
    clearUnread,
    setMyUuid,
    setPanelOpen,
    setSocket,
  };
}
