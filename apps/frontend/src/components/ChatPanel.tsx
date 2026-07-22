'use client';

import { useEffect, useRef, useState } from 'react';
import type { ChatMessageWithId } from '@/hooks/useChat';

interface ChatPanelProps {
  messages: ChatMessageWithId[];
  chatEnabled: boolean;
  onSend: (text: string) => void;
  onClose: () => void;
  myDisplayName: string;
  participantNames: Map<string, string>;
}

function ChatMessage({ msg, myDisplayName, participantNames }: { msg: ChatMessageWithId; myDisplayName: string; participantNames: Map<string, string> }) {
  const senderName = msg.isOwn ? myDisplayName : (participantNames.get(msg.senderUuid) ?? msg.senderName ?? 'Unknown');
  const time = new Date(msg.timestamp);
  const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className={`flex flex-col ${msg.isOwn ? 'items-end' : 'items-start'}`}>
      <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
        msg.isOwn
          ? 'rounded-br-md bg-brand-600 text-white'
          : 'rounded-bl-md bg-slate-700 text-slate-100'
      }`}>
        {!msg.isOwn && (
          <p className="mb-0.5 text-[11px] font-semibold text-brand-300">{senderName}</p>
        )}
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{msg.text}</p>
      </div>
      <span className="mt-0.5 px-1 text-[10px] text-slate-500">{timeStr}</span>
    </div>
  );
}

export function ChatPanel({ messages, chatEnabled, onSend, onClose, myDisplayName, participantNames }: ChatPanelProps) {
  const [inputText, setInputText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSend = () => {
    const trimmed = inputText.trim();
    if (!trimmed || !chatEnabled) return;
    if (trimmed.length > 2000) return;
    onSend(trimmed);
    setInputText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const charsLeft = 2000 - inputText.length;

  return (
    <div className="fixed bottom-0 right-0 z-40 flex h-[40vh] w-full flex-col border-t border-slate-700 bg-slate-800 shadow-2xl sm:bottom-auto sm:right-4 sm:top-4 sm:h-[calc(100vh-2rem)] sm:w-96 sm:rounded-2xl sm:border">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
        <div className="flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5 text-brand-400">
            <path d="M4.913 2.658c2.075-.27 4.19-.408 6.337-.408 2.147 0 4.262.139 6.337.408 1.922.25 3.291 1.861 3.405 3.727a4.403 4.403 0 00-1.032-.211 50.89 50.89 0 00-8.42 0c-2.358.196-4.04 2.19-4.04 4.434v4.286a4.47 4.47 0 002.433 3.984L7.28 21.53A.75.75 0 016 21v-4.03a48.527 48.527 0 01-1.087-.128C2.905 16.58 1.5 14.833 1.5 12.862V6.638c0-1.97 1.405-3.718 3.413-3.979z" />
            <path d="M15.75 7.5c-1.376 0-2.739.057-4.086.169C10.124 7.797 9 9.103 9 10.609v4.285c0 1.507 1.128 2.814 2.67 2.94 1.243.102 2.5.157 3.768.165l2.782 2.782a.75.75 0 001.28-.53v-2.39l.33-.026c1.542-.125 2.67-1.433 2.67-2.94v-4.286c0-1.505-1.125-2.811-2.664-2.94A49.392 49.392 0 0015.75 7.5z" />
          </svg>
          <h2 className="text-base font-semibold text-white">Chat</h2>
          {!chatEnabled && (
            <span className="rounded bg-red-900/30 px-1.5 py-0.5 text-[10px] font-medium text-red-400">
              Disabled
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-700 hover:text-white"
          title="Close chat"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
            <path fillRule="evenodd" d="M5.47 5.47a.75.75 0 011.06 0L12 10.94l5.47-5.47a.75.75 0 111.06 1.06L13.06 12l5.47 5.47a.75.75 0 11-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 01-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 010-1.06z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      {/* Messages list */}
      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="mb-3 h-10 w-10 text-slate-600">
              <path d="M4.913 2.658c2.075-.27 4.19-.408 6.337-.408 2.147 0 4.262.139 6.337.408 1.922.25 3.291 1.861 3.405 3.727a4.403 4.403 0 00-1.032-.211 50.89 50.89 0 00-8.42 0c-2.358.196-4.04 2.19-4.04 4.434v4.286a4.47 4.47 0 002.433 3.984L7.28 21.53A.75.75 0 016 21v-4.03a48.527 48.527 0 01-1.087-.128C2.905 16.58 1.5 14.833 1.5 12.862V6.638c0-1.97 1.405-3.718 3.413-3.979z" />
            </svg>
            <p className="text-sm text-slate-500">No messages yet</p>
            <p className="text-xs text-slate-600">Send a message to start chatting</p>
          </div>
        )}
        {messages.map((msg) => (
          <ChatMessage
            key={msg.id}
            msg={msg}
            myDisplayName={myDisplayName}
            participantNames={participantNames}
          />
        ))}
      </div>

      {/* Input area */}
      <div className="border-t border-slate-700 px-4 py-3">
        {!chatEnabled ? (
          <div className="rounded-xl bg-slate-700/50 px-4 py-3 text-center text-sm text-slate-400">
            Chat is disabled by the host
          </div>
        ) : (
          <>
            <div className="flex items-end gap-2">
              <input
                ref={inputRef}
                type="text"
                value={inputText}
                onChange={(e) => {
                  if (e.target.value.length <= 2000) setInputText(e.target.value);
                }}
                onKeyDown={handleKeyDown}
                placeholder="Type a message..."
                className="flex-1 rounded-xl border border-slate-600 bg-slate-700 px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                maxLength={2000}
              />
              <button
                onClick={handleSend}
                disabled={!inputText.trim()}
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white transition-all hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
                title="Send message"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
                  <path d="M3.478 2.404a.75.75 0 00-.926.941l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.404z" />
                </svg>
              </button>
            </div>
            <p className="mt-1 text-right text-[10px] text-slate-500">{charsLeft}</p>
          </>
        )}
      </div>
    </div>
  );
}
