'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { SocketEvents } from '@jehydro/shared-types';

interface ParticipantInfo {
  uuid: string;
  displayName: string;
  micEnabled: boolean;
  cameraEnabled: boolean;
  isHost: boolean;
  isSharingScreen: boolean;
  isSpeaking: boolean;
}

interface ParticipantsPanelProps {
  participants: ParticipantInfo[];
  isOpen: boolean;
  onClose: () => void;
  isHost: boolean;
  socket: Socket | null;
}

function ParticipantRow({ p, isCurrentHost, socket }: { p: ParticipantInfo; isCurrentHost: boolean; socket: Socket | null }) {
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const handleMute = useCallback(() => {
    if (!socket) return;
    socket.emit(SocketEvents.HOST_MUTE, { targetUuid: p.uuid });
  }, [socket, p.uuid]);

  const handleRemove = useCallback(() => {
    if (!socket) return;
    if (!confirmingRemove) {
      setConfirmingRemove(true);
      setTimeout(() => setConfirmingRemove(false), 3000);
      return;
    }
    socket.emit(SocketEvents.HOST_REMOVE, { targetUuid: p.uuid });
    setConfirmingRemove(false);
  }, [socket, p.uuid, confirmingRemove]);

  // Reset confirmation when participant changes
  useEffect(() => {
    setConfirmingRemove(false);
  }, [p.uuid]);

  return (
    <div className="group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-slate-700/50">
      {/* Avatar */}
      <div
        className={`relative flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${
          p.isSpeaking
            ? 'ring-2 ring-emerald-400 ring-offset-2 ring-offset-slate-800'
            : ''
        }`}
        style={{
          background: `linear-gradient(135deg, hsl(${hashCode(p.uuid) % 360}, 65%, 55%), hsl(${(hashCode(p.uuid) + 40) % 360}, 65%, 45%))`,
        }}
      >
        {p.displayName.charAt(0).toUpperCase()}
      </div>

      {/* Name + badges */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-white">{p.displayName}</span>
          {p.isHost && (
            <span className="flex-shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">
              HOST
            </span>
          )}
          {p.isSpeaking && (
            <span className="flex-shrink-0 text-xs text-emerald-400">Speaking</span>
          )}
        </div>
      </div>

      {/* Status icons */}
      <div className="flex flex-shrink-0 items-center gap-2">
        {/* Screen sharing indicator */}
        {p.isSharingScreen && (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="h-4 w-4 text-emerald-400"
          >
            <path d="M4.5 4.5a3 3 0 00-3 3v9a3 3 0 003 3h8.25a3 3 0 003-3v-9a3 3 0 00-3-3H4.5zM19.94 18.75l-2.69-2.69V7.94l2.69-2.69c.944-.945 2.56-.276 2.56 1.06v11.38c0 1.336-1.616 2.005-2.56 1.06z" />
          </svg>
        )}

        {/* Mic */}
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-700/50">
          {p.micEnabled ? (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5 text-slate-300">
              <path d="M8.25 4.5a3.75 3.75 0 117.5 0v8.25a3.75 3.75 0 11-7.5 0V4.5z" />
              <path d="M6 10.5a.75.75 0 01.75.75v1.5a5.25 5.25 0 1010.5 0v-1.5a.75.75 0 011.5 0v1.5a6.751 6.751 0 01-6 6.709v2.291h3a.75.75 0 010 1.5h-8.5a.75.75 0 010-1.5h3v-2.291a6.751 6.751 0 01-6-6.709v-1.5A.75.75 0 016 10.5z" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#ef4444" className="h-3.5 w-3.5">
              <path d="M13.5 4.5a3.75 3.75 0 117.5 0v8.25a3.75 3.75 0 11-7.5 0V4.5z" />
              <path d="M12 16.5a6.75 6.75 0 006.75-6.75v-1.5a.75.75 0 011.5 0v1.5a8.251 8.251 0 01-7.5 8.209v2.291h3a.75.75 0 010 1.5h-8.5a.75.75 0 010-1.5h3v-2.291a8.251 8.251 0 01-7.5-8.209v-1.5a.75.75 0 011.5 0v1.5A6.75 6.75 0 0012 16.5z" />
              <line x1="3" y1="3" x2="21" y2="21" stroke="#ef4444" strokeWidth="2" />
            </svg>
          )}
        </div>

        {/* Camera */}
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-700/50">
          {p.cameraEnabled ? (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5 text-slate-300">
              <path d="M4.5 4.5a3 3 0 00-3 3v9a3 3 0 003 3h8.25a3 3 0 003-3v-9a3 3 0 00-3-3H4.5zM19.94 18.75l-2.69-2.69V7.94l2.69-2.69c.944-.945 2.56-.276 2.56 1.06v11.38c0 1.336-1.616 2.005-2.56 1.06z" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#ef4444" className="h-3.5 w-3.5">
              <path d="M4.5 4.5a3 3 0 00-3 3v9a3 3 0 003 3h8.25a3 3 0 003-3v-9a3 3 0 00-3-3H4.5z" />
              <line x1="3" y1="3" x2="21" y2="21" stroke="#ef4444" strokeWidth="2" />
            </svg>
          )}
        </div>

        {/* Host action buttons (only for non-host participants, only visible to host) */}
        {isCurrentHost && !p.isHost && (
          <div className="flex gap-1">
            {/* Mute */}
            <button
              onClick={handleMute}
              className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-700/50 text-slate-400 opacity-0 transition-all hover:bg-red-800/50 hover:text-red-400 group-hover:opacity-100"
              title="Mute participant"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
                <path d="M13.5 4.5a3.75 3.75 0 117.5 0v8.25a3.75 3.75 0 11-7.5 0V4.5z" />
                <path d="M12 16.5a6.75 6.75 0 006.75-6.75v-1.5a.75.75 0 011.5 0v1.5a8.251 8.251 0 01-7.5 8.209v2.291h3a.75.75 0 010 1.5h-8.5a.75.75 0 010-1.5h3v-2.291a8.251 8.251 0 01-7.5-8.209v-1.5a.75.75 0 011.5 0v1.5A6.75 6.75 0 0012 16.5z" />
                <line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" strokeWidth="2" />
              </svg>
            </button>
            {/* Remove */}
            <button
              onClick={handleRemove}
              className={`flex h-7 w-7 items-center justify-center rounded-md text-slate-400 opacity-0 transition-all group-hover:opacity-100 ${
                confirmingRemove
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : 'bg-slate-700/50 hover:bg-red-800/50 hover:text-red-400'
              }`}
              title={confirmingRemove ? 'Click again to confirm' : 'Remove participant'}
            >
              {confirmingRemove ? (
                <span className="text-[9px] font-bold">?</span>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
                  <path fillRule="evenodd" d="M16.5 4.478v.227a48.816 48.816 0 013.878.512.75.75 0 11-.256 1.478l-.209-.035-1.005 13.07a3 3 0 01-2.991 2.77H8.084a3 3 0 01-2.991-2.77L4.087 6.66l-.209.035a.75.75 0 01-.256-1.478A48.567 48.567 0 017.5 4.705v-.227c0-1.564 1.213-2.9 2.816-2.951a52.662 52.662 0 013.369 0c1.603.051 2.815 1.387 2.815 2.951zm-6.136-1.452a51.196 51.196 0 013.273 0C14.39 3.05 15 3.684 15 4.478v.113a49.488 49.488 0 00-6 0v-.113c0-.794.609-1.428 1.364-1.452zm-.355 5.945a.75.75 0 10-1.5.058l.347 9a.75.75 0 101.499-.058l-.346-9zm5.48.058a.75.75 0 10-1.498-.058l-.347 9a.75.75 0 001.5.058l.345-9z" clipRule="evenodd" />
                </svg>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

interface WaitingParticipant {
  uuid: string;
  displayName: string;
  joinedAt: number;
}

export function ParticipantsPanel({ participants, isOpen, onClose, isHost, socket }: ParticipantsPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [waitingList, setWaitingList] = useState<WaitingParticipant[]>([]);

  // Listen for waiting participants list updates (host only)
  useEffect(() => {
    if (!socket || !isHost) return;

    const handleWaitingList = (payload: { participants: WaitingParticipant[] }) => {
      setWaitingList(payload.participants);
    };

    socket.on(SocketEvents.WAITING_PARTICIPANTS_LIST, handleWaitingList);
    return () => {
      socket.off(SocketEvents.WAITING_PARTICIPANTS_LIST, handleWaitingList);
    };
  }, [socket, isHost]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const timer = setTimeout(() => {
      window.addEventListener('mousedown', handleClick);
    }, 100);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('mousedown', handleClick);
    };
  }, [isOpen, onClose]);

  const handleAdmit = useCallback(
    (targetUuid: string) => {
      if (!socket) return;
      socket.emit(SocketEvents.WAITING_ADMIT, { targetUuid });
    },
    [socket]
  );

  const handleDeny = useCallback(
    (targetUuid: string) => {
      if (!socket) return;
      socket.emit(SocketEvents.WAITING_DENY, { targetUuid });
    },
    [socket]
  );

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" />
      )}

      {/* Panel */}
      <div
        ref={panelRef}
        className={`fixed right-0 top-0 z-50 flex h-full w-80 flex-col bg-slate-800 shadow-2xl transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700 px-4 py-4">
          <h2 className="text-base font-semibold text-white">
            Participants{' '}
            <span className="ml-1.5 rounded bg-slate-700 px-2 py-0.5 text-xs font-medium text-slate-300">
              {participants.length}
            </span>
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-700 hover:text-white"
            title="Close panel"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
              <path fillRule="evenodd" d="M5.47 5.47a.75.75 0 011.06 0L12 10.94l5.47-5.47a.75.75 0 111.06 1.06L13.06 12l5.47 5.47a.75.75 0 11-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 01-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 010-1.06z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {/* Waiting list (host only) */}
        {isHost && waitingList.length > 0 && (
          <div className="border-b border-amber-900/30 bg-amber-900/10 px-3 py-3">
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-400">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" />
              </svg>
              Waiting ({waitingList.length})
            </h3>
            <div className="space-y-1">
              {waitingList.map((w) => (
                <div key={w.uuid} className="flex items-center gap-2 rounded-lg bg-slate-800/50 px-3 py-2">
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-slate-700 text-xs font-bold text-slate-300">
                    {w.displayName.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white">{w.displayName}</p>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleAdmit(w.uuid)}
                      className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-700 text-white transition-colors hover:bg-emerald-600"
                      title="Admit"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                        <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDeny(w.uuid)}
                      className="flex h-7 w-7 items-center justify-center rounded-md bg-red-700 text-white transition-colors hover:bg-red-600"
                      title="Deny"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                        <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Participants list */}
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {participants.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">No participants</p>
          ) : (
            <div className="space-y-1">
              {participants.map((p) => (
                <ParticipantRow
                  key={p.uuid}
                  p={p}
                  isCurrentHost={isHost}
                  socket={socket}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// Simple hash function for generating avatar colors
function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash);
}
