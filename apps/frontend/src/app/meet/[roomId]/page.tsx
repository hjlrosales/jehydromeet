'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { SocketEvents } from '@jehydro/shared-types';
import type { RoomJoinedPayload, RoomErrorPayload } from '@jehydro/shared-types';
import { useSocket } from '@/hooks/useSocket';
import { useMediaTransport } from '@/hooks/useMediaTransport';
import { consumePendingRoomState } from '@/lib/roomState';
import { ThemeToggle } from '@/components/ThemeToggle';

export default function MeetRoomPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const roomId = params.roomId as string;
  const socket = useSocket();
  const media = useMediaTransport(socket);

  const [displayName, setDisplayName] = useState(searchParams.get('name') ?? '');
  const [state, setState] = useState<'joining' | 'lobby' | 'in-meeting' | 'error'>('lobby');
  const [error, setError] = useState<string | null>(null);
  const [roomInfo, setRoomInfo] = useState<RoomJoinedPayload | null>(null);
  const joinAttempted = useRef(false);

  // Local video ref for rendering
  const localVideoRef = useRef<HTMLVideoElement>(null);

  // Render local video when stream changes
  useEffect(() => {
    if (localVideoRef.current && media.localStream) {
      localVideoRef.current.srcObject = media.localStream;
    }
  }, [media.localStream]);

  // On mount, check if we have pending room state from the create flow
  useEffect(() => {
    const pending = consumePendingRoomState();
    if (pending) {
      setRoomInfo(pending);
      setState('in-meeting');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If name was passed in URL (from JoinMeetingForm), auto-join once socket is ready
  useEffect(() => {
    if (socket && displayName && state === 'lobby' && !joinAttempted.current) {
      handleJoin();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket]);

  // When entering in-meeting state (from pending state or after joining), start media
  useEffect(() => {
    if (state === 'in-meeting' && roomInfo && !media.isReady && socket) {
      media.joinMeeting(roomInfo);
    }
  }, [state, roomInfo, media, socket]);

  const handleJoin = useCallback(() => {
    const trimmedName = displayName.trim();
    if (!trimmedName) {
      setError('Please enter your display name.');
      return;
    }
    if (trimmedName.length > 40) {
      setError('Display name cannot exceed 40 characters.');
      return;
    }
    if (!socket) {
      setError('Unable to connect to the server. Please try again.');
      return;
    }

    joinAttempted.current = true;
    setState('joining');
    setError(null);

    const storedHostToken = sessionStorage.getItem('jehydro-host-token');
    const storedHostId = sessionStorage.getItem('jehydro-host-id');

    socket.emit(SocketEvents.ROOM_JOIN, {
      roomId,
      displayName: trimmedName,
      micEnabled: true,
      cameraEnabled: true,
    });

    socket.on(SocketEvents.ROOM_JOINED, (payload: RoomJoinedPayload) => {
      socket.off(SocketEvents.ROOM_JOINED);
      socket.off(SocketEvents.ROOM_ERROR);
      socket.off(SocketEvents.ROOM_NOT_FOUND);
      setRoomInfo(payload);
      setState('in-meeting');

      if (payload.yourUuid === storedHostId && storedHostToken) {
        sessionStorage.setItem('jehydro-host-token', storedHostToken);
        sessionStorage.setItem('jehydro-host-id', payload.yourUuid);
      }
    });

    socket.on(SocketEvents.ROOM_ERROR, (payload: RoomErrorPayload) => {
      socket.off(SocketEvents.ROOM_JOINED);
      socket.off(SocketEvents.ROOM_ERROR);
      socket.off(SocketEvents.ROOM_NOT_FOUND);
      setState('lobby');
      setError(payload.message);
    });

    socket.on(SocketEvents.ROOM_NOT_FOUND, () => {
      socket.off(SocketEvents.ROOM_JOINED);
      socket.off(SocketEvents.ROOM_ERROR);
      socket.off(SocketEvents.ROOM_NOT_FOUND);
      setState('lobby');
      setError('Meeting not found. Please check the link and try again.');
    });
  }, [socket, roomId, displayName]);

  // ---------- Lobby: waiting for name input ----------
  if (state === 'lobby') {
    return (
      <div className="flex min-h-screen flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700 sm:px-6">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" className="h-5 w-5">
                <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <span className="text-lg font-semibold text-slate-900 dark:text-white">Jehydro Meet</span>
          </div>
          <ThemeToggle />
        </header>
        <main className="flex flex-1 items-center justify-center px-4 py-12">
          <div className="w-full max-w-md animate-fade-in">
            <div className="card">
              <h2 className="mb-2 text-xl font-semibold text-slate-900 dark:text-white">Join Meeting</h2>
              <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
                Room: <span className="font-mono font-medium text-slate-700 dark:text-slate-300">{roomId}</span>
              </p>
              <div className="mb-5">
                <label htmlFor="room-name" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Your name
                </label>
                <input
                  id="room-name"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Enter your display name"
                  className="input-field"
                  maxLength={40}
                  autoFocus
                  onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                />
                <p className="mt-1 text-xs text-slate-400">{displayName.length}/40</p>
              </div>
              {error && (
                <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">
                  {error}
                </div>
              )}
              <button onClick={handleJoin} className="btn-primary w-full py-3 text-base">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="mr-2 h-5 w-5">
                  <path fillRule="evenodd" d="M12.97 3.97a.75.75 0 011.06 0l7.5 7.5a.75.75 0 010 1.06l-7.5 7.5a.75.75 0 11-1.06-1.06l6.22-6.22H3a.75.75 0 010-1.5h16.19l-6.22-6.22a.75.75 0 010-1.06z" clipRule="evenodd" />
                </svg>
                Join
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ---------- Joining ----------
  if (state === 'joining') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <svg className="mx-auto mb-4 h-8 w-8 animate-spin text-brand-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <p className="text-sm text-slate-500 dark:text-slate-400">Joining meeting...</p>
        </div>
      </div>
    );
  }

  // ---------- Error ----------
  if (state === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="card max-w-md text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6 text-red-600 dark:text-red-400">
              <path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zm-1.72 6.97a.75.75 0 10-1.06 1.06L10.94 12l-1.72 1.72a.75.75 0 101.06 1.06L12 13.06l1.72 1.72a.75.75 0 101.06-1.06L13.06 12l1.72-1.72a.75.75 0 10-1.06-1.06L12 10.94l-1.72-1.72z" clipRule="evenodd" />
            </svg>
          </div>
          <h2 className="mb-2 text-lg font-semibold text-slate-900 dark:text-white">{error ?? 'Something went wrong'}</h2>
          <button onClick={() => setState('lobby')} className="btn-primary mt-4">Try Again</button>
        </div>
      </div>
    );
  }

  // ---------- In Meeting ----------
  return (
    <div className="flex min-h-screen flex-col bg-slate-900">
      {/* Video Grid */}
      <div className="flex flex-1 flex-wrap items-center justify-center gap-3 overflow-y-auto p-4">
        {/* Local video tile (mirrored) */}
        <div className="relative flex aspect-video w-full max-w-lg items-center justify-center overflow-hidden rounded-xl bg-slate-800 sm:w-[calc(50%-0.75rem)]">
          {media.localStream ? (
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="h-full w-full scale-x-[-1] object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-600">
                <span className="text-2xl font-bold text-white">
                  {roomInfo?.participants.find((p) => p.uuid === roomInfo?.yourUuid)?.displayName?.charAt(0)?.toUpperCase() ?? '?'}
                </span>
              </div>
            </div>
          )}
          {/* Overlay name + mic/camera status */}
          <div className="absolute bottom-0 left-0 right-0 flex items-center gap-2 bg-gradient-to-t from-black/60 to-transparent p-3 pt-8">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium text-white">
                {roomInfo?.participants.find((p) => p.uuid === roomInfo?.yourUuid)?.displayName ?? 'You'}
              </span>
              {roomInfo?.yourUuid === roomInfo?.hostId && (
                <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-xs text-amber-400">Host</span>
              )}
            </div>
            <div className="ml-auto flex gap-1">
              {/* Mic icon */}
              {media.micEnabled ? (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" className="h-4 w-4 opacity-70">
                  <path d="M8.25 4.5a3.75 3.75 0 117.5 0v8.25a3.75 3.75 0 11-7.5 0V4.5z" />
                  <path d="M6 10.5a.75.75 0 01.75.75v1.5a5.25 5.25 0 1010.5 0v-1.5a.75.75 0 011.5 0v1.5a6.751 6.751 0 01-6 6.709v2.291h3a.75.75 0 010 1.5h-8.5a.75.75 0 010-1.5h3v-2.291a6.751 6.751 0 01-6-6.709v-1.5A.75.75 0 016 10.5z" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#ef4444" className="h-4 w-4">
                  <path d="M13.5 4.5a3.75 3.75 0 117.5 0v8.25a3.75 3.75 0 11-7.5 0V4.5z" />
                  <path d="M12 16.5a6.75 6.75 0 006.75-6.75v-1.5a.75.75 0 011.5 0v1.5a8.251 8.251 0 01-7.5 8.209v2.291h3a.75.75 0 010 1.5h-8.5a.75.75 0 010-1.5h3v-2.291a8.251 8.251 0 01-7.5-8.209v-1.5a.75.75 0 011.5 0v1.5A6.75 6.75 0 0012 16.5z" />
                  <line x1="3" y1="3" x2="21" y2="21" stroke="#ef4444" strokeWidth="2" />
                </svg>
              )}
              {/* Camera icon */}
              {media.cameraEnabled ? (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" className="h-4 w-4 opacity-70">
                  <path d="M4.5 4.5a3 3 0 00-3 3v9a3 3 0 003 3h8.25a3 3 0 003-3v-9a3 3 0 00-3-3H4.5zM19.94 18.75l-2.69-2.69V7.94l2.69-2.69c.944-.945 2.56-.276 2.56 1.06v11.38c0 1.336-1.616 2.005-2.56 1.06z" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#ef4444" className="h-4 w-4">
                  <path d="M4.5 4.5a3 3 0 00-3 3v9a3 3 0 003 3h8.25a3 3 0 003-3v-9a3 3 0 00-3-3H4.5z" />
                  <line x1="3" y1="3" x2="21" y2="21" stroke="#ef4444" strokeWidth="2" />
                </svg>
              )}
            </div>
          </div>
        </div>

        {/* Remote video tiles */}
        {media.remoteStreams.map((remote) => (
          <div key={remote.uuid} className="relative flex aspect-video w-full max-w-lg items-center justify-center overflow-hidden rounded-xl bg-slate-800 sm:w-[calc(50%-0.75rem)]">
            {remote.stream && remote.cameraEnabled ? (
              <RemoteVideo stream={remote.stream} displayName={remote.displayName} />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-600">
                  <span className="text-2xl font-bold text-white">{remote.displayName.charAt(0).toUpperCase()}</span>
                </div>
              </div>
            )}
            {/* Overlay name + stat