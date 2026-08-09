'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { SocketEvents } from '@jehydro/shared-types';
import type { RoomJoinedPayload, RoomErrorPayload } from '@jehydro/shared-types';
import { useSocket } from '@/hooks/useSocket';
import { useMediaTransport } from '@/hooks/useMediaTransport';
import { consumePendingRoomState } from '@/lib/roomState';
import { ThemeToggle } from '@/components/ThemeToggle';
import { JoinPreview } from '@/components/JoinPreview';
import { BackgroundEffectToggle } from '@/components/BackgroundEffectToggle';
import { Whiteboard } from '@/components/Whiteboard';
import { PollsPanel } from '@/components/PollsPanel';
import { BreakoutRoomsPanel } from '@/components/BreakoutRoomsPanel';
import { ParticipantsPanel } from '@/components/ParticipantsPanel';
import { ChatPanel } from '@/components/ChatPanel';
import { useToast } from '@/hooks/useToast';
import { ToastContainer } from '@/components/ToastContainer';
import { useChat } from '@/hooks/useChat';

export default function MeetRoomPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const roomId = params.roomId as string;
  const router = useRouter();
  const socket = useSocket();
  const media = useMediaTransport(socket);
  const chat = useChat();
  const { toasts, addToast, removeToast } = useToast();

  // Pre-fill display name from sessionStorage (rejoin after refresh).
  // Guard against SSR where sessionStorage is not defined.
  const [displayName, setDisplayName] = useState(
    searchParams.get('name') ??
      (typeof window !== 'undefined' ? sessionStorage.getItem('jehydro-display-name') : '') ??
      ''
  );
  const [state, setState] = useState<'joining' | 'lobby' | 'preview' | 'waiting' | 'in-meeting' | 'error'>('lobby');
  const [error, setError] = useState<string | null>(null);
  const [roomInfo, setRoomInfo] = useState<RoomJoinedPayload | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [chatPanelOpen, setChatPanelOpen] = useState(false);
  const [whiteboardOpen, setWhiteboardOpen] = useState(false);
  const [pollsOpen, setPollsOpen] = useState(false);
  const [breakoutOpen, setBreakoutOpen] = useState(false);
  const [meetingLocked, setMeetingLocked] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [completedRecordings, setCompletedRecordings] = useState<Array<{id: string; durationMs?: number}>>([]);
  const [meetingPassword, setMeetingPassword] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
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
      const myName = pending.participants.find((p) => p.uuid === pending.yourUuid)?.displayName ?? '';
      if (myName) setDisplayName(myName);
      setState('preview');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When entering in-meeting state, start media and init chat
  useEffect(() => {
    if (state === 'in-meeting' && roomInfo && !media.isReady && socket) {
      media.joinMeeting(roomInfo);
      chat.setSocket(socket);
      chat.setMyUuid(roomInfo.yourUuid);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, roomInfo, media, socket]);

  // Sync chat panel open state
  useEffect(() => {
    chat.setPanelOpen(chatPanelOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatPanelOpen]);

  // Build participant name map for chat display
  const participantNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of media.allParticipants) {
      map.set(p.uuid, p.displayName);
    }
    return map;
  }, [media.allParticipants]);

  // Maintain own name map so we can show names in left toasts
  // even after the hook removes them from participantsRef
  const nameMap = useRef<Map<string, string>>(new Map());

  // Reference to self for host actions
  // allParticipants[0] is always self (pushed first in useMediaTransport)
  const isHost = media.allParticipants[0]?.isHost ?? false;

  // Refs to avoid stale closures in event handlers
  const micEnabledRef = useRef(media.micEnabled);
  const toggleMicRef = useRef(media.toggleMic);
  micEnabledRef.current = media.micEnabled;
  toggleMicRef.current = media.toggleMic;

  // Toast notifications for participant and host events
  useEffect(() => {
    if (!socket || state !== 'in-meeting') return;

    const onJoined = (payload: { participant: { uuid: string; displayName: string } }) => {
      nameMap.current.set(payload.participant.uuid, payload.participant.displayName);
      addToast(`${payload.participant.displayName} joined`, 'info');
    };
    const onLeft = (payload: { uuid: string }) => {
      const name = nameMap.current.get(payload.uuid) ?? 'Someone';
      nameMap.current.delete(payload.uuid);
      addToast(`${name} left`, 'info');
    };

    const onShareStarted = (payload: { uuid: string }) => {
      const name = nameMap.current.get(payload.uuid) ?? 'Someone';
      addToast(`${name} started sharing`, 'info');
    };
    const onShareStopped = (payload: { uuid: string }) => {
      const name = nameMap.current.get(payload.uuid) ?? 'Someone';
      addToast(`${name} stopped sharing`, 'info');
    };
    const onShareBlocked = (payload: { reason: string }) => {
      addToast(payload.reason, 'warning');
    };

    // Waiting room events
    const onWaitingParticipantAdded = (payload: { participant: { displayName: string } }) => {
      addToast(`${payload.participant.displayName} is waiting to join`, 'info');
    };

    // Host action events
    const onRoomLocked = () => {
      setMeetingLocked(true);
      addToast('Meeting locked by host', 'warning');
    };
    const onRoomUnlocked = () => {
      setMeetingLocked(false);
      addToast('Meeting unlocked', 'info');
    };
    const onRoomEnded = () => {
      addToast('Meeting ended by host', 'error');
      setTimeout(() => router.push('/'), 2000);
    };
    const onParticipantRemoved = (payload: { reason: string }) => {
      addToast(payload.reason, 'error');
      setTimeout(() => router.push('/'), 2000);
    };
    // Recording events
    const onRecordingStarted = () => {
      setIsRecording(true);
      addToast('Recording started', 'info');
    };
    const onRecordingStopped = (payload: { roomId: string; recording: { id: string; durationMs?: number } }) => {
      setIsRecording(false);
      const recording = { id: payload.recording.id, durationMs: payload.recording.durationMs };
      setCompletedRecordings((prev) => [...prev, recording]);
      const durationStr = payload.recording.durationMs
        ? `${Math.round(payload.recording.durationMs / 1000 / 60)}m`
        : '';
      addToast(`Recording saved${durationStr ? ` (${durationStr})` : ''}`, 'success');
    };
    const onRecordingError = (payload: { error: string }) => {
      addToast(payload.error, 'error');
    };

    const onHostMute = () => {
      addToast('You were muted by the host', 'warning');
      // Force mute via ref (avoids stale closure on media.micEnabled)
      if (micEnabledRef.current) {
        toggleMicRef.current();
      }
    };

    socket.on(SocketEvents.PARTICIPANT_JOINED, onJoined);
    socket.on(SocketEvents.PARTICIPANT_LEFT, onLeft);
    socket.on(SocketEvents.SCREEN_SHARE_STARTED, onShareStarted);
    socket.on(SocketEvents.SCREEN_SHARE_STOPPED, onShareStopped);
    socket.on(SocketEvents.SCREEN_SHARE_BLOCKED, onShareBlocked);
    socket.on(SocketEvents.WAITING_PARTICIPANT_ADDED, onWaitingParticipantAdded);
    socket.on(SocketEvents.ROOM_LOCKED, onRoomLocked);
    socket.on(SocketEvents.ROOM_UNLOCKED, onRoomUnlocked);
    socket.on(SocketEvents.ROOM_ENDED, onRoomEnded);
    socket.on(SocketEvents.PARTICIPANT_REMOVED, onParticipantRemoved);
    socket.on(SocketEvents.HOST_MUTE, onHostMute);
    socket.on(SocketEvents.RECORDING_STARTED, onRecordingStarted);
    socket.on(SocketEvents.RECORDING_STOPPED, onRecordingStopped);
    socket.on(SocketEvents.RECORDING_ERROR, onRecordingError);

    return () => {
      socket.off(SocketEvents.PARTICIPANT_JOINED, onJoined);
      socket.off(SocketEvents.PARTICIPANT_LEFT, onLeft);
      socket.off(SocketEvents.SCREEN_SHARE_STARTED, onShareStarted);
      socket.off(SocketEvents.SCREEN_SHARE_STOPPED, onShareStopped);
      socket.off(SocketEvents.SCREEN_SHARE_BLOCKED, onShareBlocked);
      socket.off(SocketEvents.WAITING_PARTICIPANT_ADDED, onWaitingParticipantAdded);
      socket.off(SocketEvents.ROOM_LOCKED, onRoomLocked);
      socket.off(SocketEvents.ROOM_UNLOCKED, onRoomUnlocked);
      socket.off(SocketEvents.ROOM_ENDED, onRoomEnded);
      socket.off(SocketEvents.PARTICIPANT_REMOVED, onParticipantRemoved);
      socket.off(SocketEvents.HOST_MUTE, onHostMute);
      socket.off(SocketEvents.RECORDING_STARTED, onRecordingStarted);
      socket.off(SocketEvents.RECORDING_STOPPED, onRecordingStopped);
      socket.off(SocketEvents.RECORDING_ERROR, onRecordingError);
    };
  }, [socket, state, addToast]);

  // Handle going from name lobby to preview
  const goToPreview = useCallback(() => {
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
    setError(null);
    setState('preview');
  }, [displayName, socket]);

  const { setPendingMedia } = media;

  // Handle join from preview: emit room:join, then enter meeting
  const handlePreviewJoin = useCallback(
    (stream: MediaStream | null, initialMic: boolean, initialCamera: boolean) => {
      if (!socket) return;

      setPendingMedia(stream, initialMic, initialCamera);

      const trimmedName = displayName.trim();
      joinAttempted.current = true;
      setState('joining');
      setError(null);

      const storedHostToken = sessionStorage.getItem('jehydro-host-token');
      const storedHostId = sessionStorage.getItem('jehydro-host-id');

      // Emit join with optional password
      const joinPayload: Record<string, unknown> = {
        roomId,
        displayName: trimmedName,
        micEnabled: initialMic,
        cameraEnabled: initialCamera,
      };
      // If we have a meeting password from an earlier PASSWORD_REQUIRED prompt, include it
      const currentPassword = meetingPassword || '';
      if (currentPassword) {
        joinPayload.password = currentPassword;
      }

      socket.emit(SocketEvents.ROOM_JOIN, joinPayload);

      socket.on(SocketEvents.ROOM_JOINED, (payload: RoomJoinedPayload) => {
        socket.off(SocketEvents.ROOM_JOINED);
        socket.off(SocketEvents.ROOM_ERROR);
        socket.off(SocketEvents.ROOM_NOT_FOUND);
        socket.off(SocketEvents.PASSWORD_REQUIRED);
        socket.off(SocketEvents.PASSWORD_INCORRECT);
        socket.off(SocketEvents.WAITING_ADMITTED);
        socket.off(SocketEvents.WAITING_REJECTED);
        setRoomInfo(payload);
        setState('in-meeting');

        sessionStorage.setItem('jehydro-display-name', trimmedName);

        if (payload.yourUuid === storedHostId && storedHostToken) {
          sessionStorage.setItem('jehydro-host-token', storedHostToken);
          sessionStorage.setItem('jehydro-host-id', payload.yourUuid);
        }
      });

      socket.on(SocketEvents.ROOM_ERROR, (payload: RoomErrorPayload) => {
        socket.off(SocketEvents.ROOM_JOINED);
        socket.off(SocketEvents.ROOM_ERROR);
        socket.off(SocketEvents.ROOM_NOT_FOUND);
        socket.off(SocketEvents.PASSWORD_REQUIRED);
        socket.off(SocketEvents.PASSWORD_INCORRECT);
        socket.off(SocketEvents.WAITING_ADMITTED);
        socket.off(SocketEvents.WAITING_REJECTED);
        setState('preview');
        const errorMsg = payload.code === 'ROOM_LOCKED'
          ? `${payload.message} Ask the host to unlock the meeting.`
          : payload.code === 'RATE_LIMITED'
            ? `${payload.message} Please wait before joining another room.`
            : payload.message;
        setError(errorMsg);
      });

      socket.on(SocketEvents.PASSWORD_REQUIRED, () => {
        socket.off(SocketEvents.ROOM_JOINED);
        socket.off(SocketEvents.ROOM_ERROR);
        socket.off(SocketEvents.ROOM_NOT_FOUND);
        socket.off(SocketEvents.PASSWORD_REQUIRED);
        socket.off(SocketEvents.PASSWORD_INCORRECT);
        socket.off(SocketEvents.WAITING_ADMITTED);
        socket.off(SocketEvents.WAITING_REJECTED);
        setState('preview');
        setNeedsPassword(true);
        setPasswordError(null);
      });

      socket.on(SocketEvents.PASSWORD_INCORRECT, (payload: { locked?: boolean }) => {
        if (payload.locked) {
          setPasswordError('Too many incorrect attempts. Please wait a moment before trying again.');
        } else {
          setPasswordError('Incorrect password. Please try again.');
        }
        setState('preview');
        setNeedsPassword(true);
      });

      socket.on(SocketEvents.WAITING_ADMITTED, () => {
        socket.off(SocketEvents.ROOM_JOINED);
        socket.off(SocketEvents.ROOM_ERROR);
        socket.off(SocketEvents.ROOM_NOT_FOUND);
        socket.off(SocketEvents.PASSWORD_REQUIRED);
        socket.off(SocketEvents.PASSWORD_INCORRECT);
        socket.off(SocketEvents.WAITING_ADMITTED);
        socket.off(SocketEvents.WAITING_REJECTED);
        setState('waiting');
        sessionStorage.setItem('jehydro-display-name', trimmedName);
      });

      socket.on(SocketEvents.WAITING_REJECTED, (payload: { reason: string }) => {
        socket.off(SocketEvents.ROOM_JOINED);
        socket.off(SocketEvents.ROOM_ERROR);
        socket.off(SocketEvents.ROOM_NOT_FOUND);
        socket.off(SocketEvents.PASSWORD_REQUIRED);
        socket.off(SocketEvents.PASSWORD_INCORRECT);
        socket.off(SocketEvents.WAITING_ADMITTED);
        socket.off(SocketEvents.WAITING_REJECTED);
        setState('error');
        setError(payload.reason);
      });

      socket.on(SocketEvents.ROOM_NOT_FOUND, () => {
        socket.off(SocketEvents.ROOM_JOINED);
        socket.off(SocketEvents.ROOM_ERROR);
        socket.off(SocketEvents.ROOM_NOT_FOUND);
        socket.off(SocketEvents.PASSWORD_REQUIRED);
        socket.off(SocketEvents.PASSWORD_INCORRECT);
        socket.off(SocketEvents.WAITING_ADMITTED);
        socket.off(SocketEvents.WAITING_REJECTED);
        setState('preview');
        setError('Meeting not found. Please check the link and try again.');
      });
    },
    [socket, roomId, displayName, setPendingMedia, meetingPassword]
  );

  // ---------- Lobby: waiting for name input ----------
  if (state === 'lobby') {
    return (
      <div className="flex min-h-screen flex-col bg-white dark:bg-slate-900">
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
                  onKeyDown={(e) => e.key === 'Enter' && displayName.trim() && goToPreview()}
                />
                <p className="mt-1 text-xs text-slate-400">{displayName.length}/40</p>
              </div>
              {error && (
                <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">
                  {error}
                </div>
              )}
              <button onClick={goToPreview} disabled={!displayName.trim()} className="btn-primary w-full py-3 text-base">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="mr-2 inline h-5 w-5">
                  <path fillRule="evenodd" d="M12.97 3.97a.75.75 0 011.06 0l7.5 7.5a.75.75 0 010 1.06l-7.5 7.5a.75.75 0 11-1.06-1.06l6.22-6.22H3a.75.75 0 010-1.5h16.19l-6.22-6.22a.75.75 0 010-1.06z" clipRule="evenodd" />
                </svg>
                Next
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ---------- Preview: device selection + camera preview ----------
  if (state === 'preview') {
    return (
      <JoinPreview
        roomId={roomId}
        displayName={displayName}
        onJoin={handlePreviewJoin}
        onBack={() => setState('lobby')}
        needsPassword={needsPassword}
        meetingPassword={meetingPassword}
        onPasswordChange={setMeetingPassword}
        passwordError={passwordError}
      />
    );
  }

  // ---------- Waiting: waiting for host admission ----------
  if (state === 'waiting') {
    return (
      <div className="flex min-h-screen flex-col bg-slate-900">
        <main className="flex flex-1 items-center justify-center px-4">
          <div className="w-full max-w-md text-center">
            <div className="mb-6 mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/20">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-8 w-8 text-amber-400">
                <path d="M4.5 6.375a4.125 4.125 0 118.25 0 4.125 4.125 0 01-8.25 0zM14.25 8.625a3.375 3.375 0 116.75 0 3.375 3.375 0 01-6.75 0zM1.5 19.125a7.125 7.125 0 0114.25 0v.003l-.001.119a.75.75 0 01-.363.63 13.067 13.067 0 01-6.761 1.873c-2.472 0-4.786-.684-6.76-1.873a.75.75 0 01-.364-.63l-.001-.122zM17.25 19.128l-.001.144a2.25 2.25 0 01-.233.96 10.088 10.088 0 005.06-1.01.75.75 0 00.42-.643 4.875 4.875 0 00-6.957-4.611 8.586 8.586 0 011.71 5.157v.003z" />
              </svg>
            </div>
            <h2 className="mb-2 text-xl font-semibold text-white">Waiting for host</h2>
            <p className="mb-6 text-sm text-slate-400">
              The host will admit you to the meeting shortly. Please wait.
            </p>
            <div className="flex justify-center gap-1">
              <span className="h-2 w-2 animate-bounce rounded-full bg-amber-400" style={{ animationDelay: '0ms' }} />
              <span className="h-2 w-2 animate-bounce rounded-full bg-amber-400" style={{ animationDelay: '150ms' }} />
              <span className="h-2 w-2 animate-bounce rounded-full bg-amber-400" style={{ animationDelay: '300ms' }} />
            </div>
            <button
              onClick={() => {
                socket?.emit(SocketEvents.ROOM_LEAVE);
                setState('lobby');
                setError(null);
              }}
              className="btn-secondary mt-8"
            >
              Leave waiting room
            </button>
          </div>
        </main>
      </div>
    );
  }

  // ---------- Joining ----------
  if (state === 'joining') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900">
        <div className="text-center">
          <svg className="mx-auto mb-4 h-8 w-8 animate-spin text-brand-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <p className="text-sm text-slate-400">Joining meeting...</p>
        </div>
      </div>
    );
  }

  // ---------- Error ----------
  if (state === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 dark:bg-slate-900">
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

  // ---------------------------------------------------------
  // In Meeting — Full UI
  // ---------------------------------------------------------

  // Determine if recording is available (SFU mode)
  const recordingAvailable = roomInfo?.mediaMode === 'sfu';

  const totalParticipants = 1 + media.remoteStreams.length;

  // Compute grid columns based on participant count
  const gridCols =
    totalParticipants === 1
      ? 'grid-cols-1 max-w-4xl'
      : totalParticipants === 2
        ? 'grid-cols-1 sm:grid-cols-2 max-w-4xl'
        : totalParticipants <= 4
          ? 'grid-cols-1 sm:grid-cols-2 max-w-5xl'
          : totalParticipants <= 9
            ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 max-w-7xl'
            : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 max-w-full';

  return (
    <div className="relative flex min-h-screen flex-col bg-slate-900">
      {/* Toast notifications */}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />

      {/* Whiteboard overlay */}
      {whiteboardOpen && socket && (
        <Whiteboard
          socket={socket}
          roomId={roomId}
          myUuid={roomInfo?.yourUuid ?? ''}
          isHost={isHost}
          onClose={() => setWhiteboardOpen(false)}
        />
      )}

      {/* Polls overlay */}
      {pollsOpen && socket && (
        <PollsPanel
          socket={socket}
          roomId={roomId}
          myUuid={roomInfo?.yourUuid ?? ''}
          myDisplayName={media.allParticipants[0]?.displayName ?? 'You'}
          isHost={isHost}
          onClose={() => setPollsOpen(false)}
        />
      )}

      {/* Breakout Rooms overlay */}
      {breakoutOpen && socket && (
        <BreakoutRoomsPanel
          socket={socket}
          roomId={roomId}
          myUuid={roomInfo?.yourUuid ?? ''}
          isHost={isHost}
          participants={media.allParticipants}
          onClose={() => setBreakoutOpen(false)}
        />
      )}

      {/* Chat Panel */}
      {chatPanelOpen && (
        <ChatPanel
          messages={chat.messages}
          chatEnabled={chat.chatEnabled}
          onSend={chat.sendMessage}
          onClose={() => setChatPanelOpen(false)}
          myDisplayName={media.allParticipants[0]?.displayName ?? 'You'}
          participantNames={participantNameMap}
        />
      )}

      {/* Participants Panel */}
      <ParticipantsPanel
        participants={media.allParticipants}
        isOpen={panelOpen}
        onClose={() => setPanelOpen(false)}
        isHost={isHost}
        socket={socket}
      />

      {/* Video Grid */}
      <div
        className={`mx-auto grid w-full flex-1 ${gridCols} auto-rows-fr gap-3 overflow-y-auto p-4 ${
          totalParticipants <= 2 ? 'place-content-center' : ''
        }`}
      >
        {/* Local video tile (self) */}
        <VideoTile
          uuid="local"
          displayName={media.allParticipants[0]?.displayName ?? 'You'}
          isHost={media.allParticipants[0]?.isHost ?? false}
          stream={media.localStream}
          cameraEnabled={media.cameraEnabled}
          micEnabled={media.micEnabled}
          isSpeaking={false}
          isLocal
          isScreenShare={media.isSharingScreen}
          videoRef={localVideoRef}
        />

        {/* Remote video tiles */}
        {media.remoteStreams.map((remote) => (
          <VideoTile
            key={remote.uuid}
            uuid={remote.uuid}
            displayName={remote.displayName}
            isHost={remote.isHost}
            stream={remote.stream}
            cameraEnabled={remote.cameraEnabled}
            micEnabled={remote.micEnabled}
            isSpeaking={remote.isSpeaking}
            isLocal={false}
            isScreenShare={remote.isSharingScreen}
          />
        ))}
      </div>

      {/* Recording indicator + completed recordings */}
      <div className="fixed left-1/2 top-4 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
        {isRecording && (
          <div className="flex items-center gap-2 rounded-full bg-red-600/90 px-4 py-2 text-sm font-medium text-white shadow-lg backdrop-blur-sm">
            <span className="flex h-3 w-3">
              <span className="absolute inline-flex h-3 w-3 animate-ping rounded-full bg-red-300 opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-red-400" />
            </span>
            <span>Recording</span>
          </div>
        )}
        {completedRecordings.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-full bg-slate-800/90 px-4 py-2 shadow-lg backdrop-blur-sm">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-emerald-400">
              <path d="M2 3.5A1.5 1.5 0 013.5 2h9A1.5 1.5 0 0114 3.5v11.75A2.75 2.75 0 0016.75 18h-12A2.75 2.75 0 012 15.25V3.5z" />
              <path d="M3 3.5a.5.5 0 01.5-.5h9a.5.5 0 01.5.5v.5H3v-.5z" />
            </svg>
            {completedRecordings.map((r, i) => {
              const downloadUrl = `/api/recordings/${roomId}/download/${r.id}`;
              return (
                <a
                  key={r.id}
                  href={downloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 rounded-full bg-emerald-700/50 px-3 py-1 text-xs font-medium text-emerald-200 transition-all hover:bg-emerald-700 hover:text-white"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3">
                    <path d="M10.75 2.75a.75.75 0 00-1.5 0v8.614L6.295 8.235a.75.75 0 10-1.09 1.03l4.25 4.5a.75.75 0 001.09 0l4.25-4.5a.75.75 0 00-1.09-1.03l-2.955 3.129V2.75z" />
                    <path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" />
                  </svg>
                  {i === 0 ? 'Recording' : `Recording ${i + 1}`}
                </a>
              );
            })}
          </div>
        )}
      </div>

      {/* Bottom toolbar */}
      <MeetingToolbar
        micEnabled={media.micEnabled}
        cameraEnabled={media.cameraEnabled}
        isSharingScreen={media.isSharingScreen}
        screenShareAllowed={media.screenShareAllowed}
        totalParticipants={totalParticipants}
        isHost={isHost}
        meetingLocked={meetingLocked}
        isRecording={isRecording}
        recordingAvailable={recordingAvailable}
        onToggleMic={media.toggleMic}
        onToggleCamera={media.toggleCamera}
        onLeave={async () => {
          await media.leave();
          router.push('/');
        }}
        currentBackgroundEffect={media.currentBackgroundEffect}
        onBackgroundEffectChange={media.setBackgroundEffect}
        onWhiteboard={() => setWhiteboardOpen((prev) => !prev)}
        onPolls={() => setPollsOpen((prev) => !prev)}
        onBreakoutRooms={() => setBreakoutOpen((prev) => !prev)}
        onTogglePanel={() => setPanelOpen((prev) => !prev)}
        onShareScreen={media.isSharingScreen ? media.stopScreenShare : media.startScreenShare}
        onChat={() => setChatPanelOpen((prev) => !prev)}
        chatUnreadCount={chat.unreadCount}
        onLockMeeting={() => socket?.emit(SocketEvents.HOST_LOCK)}
        onUnlockMeeting={() => socket?.emit(SocketEvents.HOST_UNLOCK)}
        onEndMeeting={() => socket?.emit(SocketEvents.HOST_END)}
        onMuteAll={() => socket?.emit(SocketEvents.HOST_MUTE_ALL)}
        onStartRecording={() => socket?.emit(SocketEvents.RECORDING_START)}
        onStopRecording={() => socket?.emit(SocketEvents.RECORDING_STOP)}
      />
    </div>
  );
}

// ---------------------------------------------------------
// VideoTile Component
// ---------------------------------------------------------

interface VideoTileProps {
  uuid: string;
  displayName: string;
  isHost: boolean;
  stream: MediaStream | null;
  cameraEnabled: boolean;
  micEnabled: boolean;
  isSpeaking: boolean;
  isLocal: boolean;
  isScreenShare: boolean;
  videoRef?: React.RefObject<HTMLVideoElement>;
}

function VideoTile({ uuid, displayName, isHost, stream, cameraEnabled, micEnabled, isSpeaking, isLocal, isScreenShare, videoRef: externalRef }: VideoTileProps) {
  const internalRef = useRef<HTMLVideoElement>(null);
  const videoRef = externalRef ?? internalRef;

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream, videoRef]);

  const showVideo = stream && cameraEnabled;
  const speakingRing = isSpeaking ? 'ring-2 ring-emerald-400 ring-offset-2 ring-offset-slate-900' : '';
  const screenShareRing = isScreenShare ? 'ring-2 ring-brand-400 ring-offset-2 ring-offset-slate-900' : '';

  return (
    <div
      className={`relative flex min-h-[200px] items-center justify-center overflow-hidden rounded-xl bg-slate-800 transition-all ${speakingRing} ${screenShareRing}`}
    >
      {showVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          className={`h-full w-full object-cover ${isLocal ? 'scale-x-[-1]' : ''}`}
        />
      ) : (
        /* Avatar placeholder when camera off */
        <div className="flex h-full w-full flex-col items-center justify-center gap-3">
          <div
            className={`flex h-20 w-20 items-center justify-center rounded-full text-3xl font-bold text-white shadow-lg ${
              isSpeaking ? 'ring-2 ring-emerald-400 ring-offset-2 ring-offset-slate-800' : ''
            }`}
            style={{
              background: `linear-gradient(135deg, hsl(${hashCode(uuid) % 360}, 65%, 55%), hsl(${(hashCode(uuid) + 40) % 360}, 65%, 45%))`,
            }}
          >
            {displayName.charAt(0).toUpperCase()}
          </div>
          <span className="text-sm text-slate-400">{isLocal ? 'You' : displayName}</span>
        </div>
      )}

      {/* Screen share badge */}
      {isScreenShare && (
        <div className="absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-lg bg-brand-600/90 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-sm">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
            <path d="M3.25 4A2.25 2.25 0 001 6.25v7.5A2.25 2.25 0 003.25 16h7.5A2.25 2.25 0 0013 13.75v-7.5A2.25 2.25 0 0010.75 4h-7.5zM19 5.5a.75.75 0 00-1.28-.53l-3 3a.75.75 0 00-.22.53v2.094c0 .398.158.78.44 1.06l3 3a.75.75 0 001.06-1.06l-2.25-2.25H16.5a.75.75 0 000-1.5h-2.19l2.25-2.25A.75.75 0 0019 6.5v-1z" />
          </svg>
          Sharing
        </div>
      )}

      {/* Speaking indicator */}
      {isSpeaking && showVideo && (
        <div className="absolute left-3 top-3 z-10 flex items-center gap-1 rounded-lg bg-emerald-600/80 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
          <span className="flex h-2 w-2">
            <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-emerald-300 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          Speaking
        </div>
      )}

      {/* Overlay: name + mic/camera status */}
      <div className="absolute bottom-0 left-0 right-0 flex items-center gap-2 bg-gradient-to-t from-black/70 via-black/30 to-transparent px-3 pb-3 pt-10">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-white">
            {isLocal ? 'You' : displayName}
          </span>
          {isHost && (
            <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">
              HOST
            </span>
          )}
        </div>
        <div className="ml-auto flex gap-1">
          {/* Mic */}
          {micEnabled ? (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" className="h-3.5 w-3.5 opacity-70">
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
          {/* Camera */}
          {cameraEnabled ? (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" className="h-3.5 w-3.5 opacity-70">
              <path d="M4.5 4.5a3 3 0 00-3 3v9a3 3 0 003 3h8.25a3 3 0 003-3v-9a3 3 0 00-3-3H4.5zM19.94 18.75l-2.69-2.69V7.94l2.69-2.69c.944-.945 2.56-.276 2.56 1.06v11.38c0 1.336-1.616 2.005-2.56 1.06z" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#ef4444" className="h-3.5 w-3.5">
              <path d="M4.5 4.5a3 3 0 00-3 3v9a3 3 0 003 3h8.25a3 3 0 003-3v-9a3 3 0 00-3-3H4.5z" />
              <line x1="3" y1="3" x2="21" y2="21" stroke="#ef4444" strokeWidth="2" />
            </svg>
          )}
        </div>
      </div>
    </div>
  );
}

// Simple hash function for generating avatar colors
function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

// ---------------------------------------------------------
// MeetingToolbar Component
// ---------------------------------------------------------

interface MeetingToolbarProps {
  micEnabled: boolean;
  cameraEnabled: boolean;
  isSharingScreen: boolean;
  screenShareAllowed: boolean;
  totalParticipants: number;
  isHost: boolean;
  meetingLocked: boolean;
  isRecording: boolean;
  recordingAvailable: boolean;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onLeave: () => void;
  currentBackgroundEffect: 'none' | 'blur' | 'image';
  onBackgroundEffectChange: (effect: 'none' | 'blur' | 'image', imageId?: string) => void;
  onWhiteboard: () => void;
  onPolls: () => void;
  onBreakoutRooms: () => void;
  onTogglePanel: () => void;
  onShareScreen: () => void;
  onChat: () => void;
  chatUnreadCount: number;
  onLockMeeting: () => void;
  onUnlockMeeting: () => void;
  onEndMeeting: () => void;
  onMuteAll: () => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
}

function MeetingToolbar({
  micEnabled,
  cameraEnabled,
  isSharingScreen,
  screenShareAllowed,
  totalParticipants,
  isHost,
  meetingLocked,
  isRecording,
  recordingAvailable,
  onToggleMic,
  onToggleCamera,
  onLeave,
  currentBackgroundEffect,
  onBackgroundEffectChange,
  onWhiteboard,
  onPolls,
  onBreakoutRooms,
  onTogglePanel,
  onShareScreen,
  onChat,
  chatUnreadCount,
  onLockMeeting,
  onUnlockMeeting,
  onEndMeeting,
  onMuteAll,
  onStartRecording,
  onStopRecording,
}: MeetingToolbarProps) {
  return (
    <div className="flex items-center justify-center gap-1.5 border-t border-slate-700 bg-slate-800/95 px-2 py-3 backdrop-blur-sm sm:gap-3 sm:px-6">
      {/* Mic toggle */}
      <ToolbarButton
        active={micEnabled}
        activeLabel="Mic"
        inactiveLabel="Muted"
        inactiveColor="red"
        onClick={onToggleMic}
        title={micEnabled ? 'Mute microphone (Ctrl+D)' : 'Unmute microphone (Ctrl+D)'}
      >
        {micEnabled ? (
          <path d="M8.25 4.5a3.75 3.75 0 117.5 0v8.25a3.75 3.75 0 11-7.5 0V4.5z" />
        ) : (
          <>
            <path d="M13.5 4.5a3.75 3.75 0 117.5 0v8.25a3.75 3.75 0 11-7.5 0V4.5z" />
            <path d="M12 16.5a6.75 6.75 0 006.75-6.75v-1.5a.75.75 0 011.5 0v1.5a8.251 8.251 0 01-7.5 8.209v2.291h3a.75.75 0 010 1.5h-8.5a.75.75 0 010-1.5h3v-2.291a8.251 8.251 0 01-7.5-8.209v-1.5a.75.75 0 011.5 0v1.5A6.75 6.75 0 0012 16.5z" />
            <line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" strokeWidth="2" />
          </>
        )}
      </ToolbarButton>

      {/* Camera toggle */}
      <ToolbarButton
        active={cameraEnabled}
        activeLabel="Camera"
        inactiveLabel="Off"
        inactiveColor="red"
        onClick={onToggleCamera}
        title={cameraEnabled ? 'Turn off camera (Ctrl+E)' : 'Turn on camera (Ctrl+E)'}
      >
        {cameraEnabled ? (
          <path d="M4.5 4.5a3 3 0 00-3 3v9a3 3 0 003 3h8.25a3 3 0 003-3v-9a3 3 0 00-3-3H4.5zM19.94 18.75l-2.69-2.69V7.94l2.69-2.69c.944-.945 2.56-.276 2.56 1.06v11.38c0 1.336-1.616 2.005-2.56 1.06z" />
        ) : (
          <>
            <path d="M4.5 4.5a3 3 0 00-3 3v9a3 3 0 003 3h8.25a3 3 0 003-3v-9a3 3 0 00-3-3H4.5z" />
            <line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" strokeWidth="2" />
          </>
        )}
      </ToolbarButton>

      {/* Spacer */}
      <div className="mx-1 h-8 w-px bg-slate-700 sm:mx-2" />

      {/* Share Screen */}
      <ToolbarButton
        active={isSharingScreen}
        activeLabel="Stop"
        inactiveLabel="Share"
        inactiveColor="slate"
        onClick={onShareScreen}
        disabled={!isSharingScreen && !screenShareAllowed}
        title={!screenShareAllowed ? 'Screen sharing disabled by host' : isSharingScreen ? 'Stop sharing' : 'Share screen'}
      >
        {isSharingScreen ? (
          <>
            <path d="M3.25 4A2.25 2.25 0 001 6.25v7.5A2.25 2.25 0 003.25 16h7.5A2.25 2.25 0 0013 13.75v-7.5A2.25 2.25 0 0010.75 4h-7.5zM19 5.5a.75.75 0 00-1.28-.53l-3 3a.75.75 0 00-.22.53v2.094c0 .398.158.78.44 1.06l3 3a.75.75 0 001.06-1.06l-2.25-2.25H16.5a.75.75 0 000-1.5h-2.19l2.25-2.25A.75.75 0 0019 6.5v-1z" />
            <line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" strokeWidth="2" />
          </>
        ) : (
          <path d="M3.25 4A2.25 2.25 0 001 6.25v7.5A2.25 2.25 0 003.25 16h7.5A2.25 2.25 0 0013 13.75v-7.5A2.25 2.25 0 0010.75 4h-7.5zM19 5.5a.75.75 0 00-1.28-.53l-3 3a.75.75 0 00-.22.53v2.094c0 .398.158.78.44 1.06l3 3a.75.75 0 001.06-1.06l-2.25-2.25H16.5a.75.75 0 000-1.5h-2.19l2.25-2.25A.75.75 0 0019 6.5v-1z" />
        )}
      </ToolbarButton>

      {/* Chat */}
      <button
        onClick={onChat}
        className="relative flex items-center gap-1.5 rounded-full bg-slate-700 px-3 py-2.5 text-sm font-medium text-white transition-all hover:bg-slate-600 active:scale-95 sm:px-4"
        title="Open chat"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
          <path d="M3.25 4A2.25 2.25 0 001 6.25v8.5A2.25 2.25 0 003.25 17h.75a.75.75 0 01.75.75v2.19a1 1 0 001.7.7l2.81-2.81a.75.75 0 01.53-.22h7.26A2.25 2.25 0 0019 15.25v-8.5A2.25 2.25 0 0016.75 4H3.25z" />
        </svg>
        <span className="hidden sm:inline">Chat</span>
        {chatUnreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {chatUnreadCount > 99 ? '99+' : chatUnreadCount}
          </span>
        )}
      </button>

      {/* Spacer */}
      <div className="mx-1 h-8 w-px bg-slate-700 sm:mx-2" />

      {/* Record button (host only, SFU rooms only) */}
      {isHost && recordingAvailable && (
        <ToolbarButton
          active={isRecording}
          activeLabel="Stop"
          inactiveLabel="Record"
          inactiveColor="red"
          onClick={isRecording ? onStopRecording : onStartRecording}
          title={isRecording ? 'Stop recording' : 'Start recording'}
        >
          {isRecording ? (
            <>
              <rect x="6" y="6" width="12" height="12" rx="2" />
              <line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" strokeWidth="2" />
            </>
          ) : (
            <circle cx="12" cy="12" r="8" />
          )}
        </ToolbarButton>
      )}

      {/* Background effect toggle */}
      <BackgroundEffectToggle
        currentEffect={currentBackgroundEffect}
        onEffectChange={onBackgroundEffectChange}
      />

      {/* Whiteboard */}
      <ToolbarButton
        active={false}
        activeLabel=""
        inactiveLabel="Board"
        inactiveColor="slate"
        onClick={onWhiteboard}
        title="Open whiteboard"
      >
        <path d="M6 4h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2z" />
        <line x1="8" y1="8" x2="8" y2="16" stroke="currentColor" strokeWidth="2" />
        <line x1="12" y1="8" x2="12" y2="16" stroke="currentColor" strokeWidth="2" />
        <line x1="16" y1="8" x2="16" y2="16" stroke="currentColor" strokeWidth="2" />
      </ToolbarButton>

      {/* Polls */}
      <ToolbarButton
        active={false}
        activeLabel=""
        inactiveLabel="Polls"
        inactiveColor="slate"
        onClick={onPolls}
        title="Open polls"
      >
        <path d="M3 3v18h18" />
        <line x1="7" y1="12" x2="7" y2="18" stroke="currentColor" strokeWidth="2" />
        <line x1="12" y1="9" x2="12" y2="18" stroke="currentColor" strokeWidth="2" />
        <line x1="17" y1="6" x2="17" y2="18" stroke="currentColor" strokeWidth="2" />
      </ToolbarButton>

      {/* Breakout Rooms */}
      <ToolbarButton
        active={false}
        activeLabel=""
        inactiveLabel="Rooms"
        inactiveColor="slate"
        onClick={onBreakoutRooms}
        title={isHost ? 'Manage breakout rooms' : 'View breakout rooms'}
      >
        <path d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
      </ToolbarButton>

      {/* Host-only controls */}
      {isHost && (
        <>
          <div className="mx-1 h-8 w-px bg-slate-700 sm:mx-2" />
          {/* Lock/Unlock */}
          <ToolbarButton
            active={meetingLocked}
            activeLabel="Unlock"
            inactiveLabel="Lock"
            inactiveColor="slate"
            onClick={meetingLocked ? onUnlockMeeting : onLockMeeting}
            title={meetingLocked ? 'Unlock meeting' : 'Lock meeting (prevent new joins)'}
          >
            {meetingLocked ? (
              <path d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            ) : (
              <path d="M18 1.5l-6 6m0 0l-6-6m6 6V15" />
            )}
          </ToolbarButton>

          {/* Mute All */}
          <ToolbarButton
            active={false}
            activeLabel=""
            inactiveLabel="Mute All"
            inactiveColor="slate"
            onClick={onMuteAll}
            title="Mute all participants"
          >
            <path d="M13.5 4.5a3.75 3.75 0 117.5 0v8.25a3.75 3.75 0 11-7.5 0V4.5z" />
            <path d="M6 10.5a.75.75 0 01.75.75v1.5a5.25 5.25 0 1010.5 0v-1.5a.75.75 0 011.5 0v1.5a6.751 6.751 0 01-6 6.709v2.291h3a.75.75 0 010 1.5h-8.5a.75.75 0 010-1.5h3v-2.291a6.751 6.751 0 01-6-6.709v-1.5A.75.75 0 016 10.5z" />
            <line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" strokeWidth="2" />
          </ToolbarButton>

          {/* End Meeting */}
          <ToolbarButton
            active={false}
            activeLabel="End"
            inactiveLabel="End"
            inactiveColor="red"
            onClick={onEndMeeting}
            title="End meeting for all"
          >
            <path d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5H9.75v3.396a.75.75 0 001.28.53l6.25-6.25a.75.75 0 00-.53-1.28H11.25L15 4.767a2.25 2.25 0 00-1.591-.659H9.75z" />
          </ToolbarButton>
        </>
      )}

      {/* Participants */}
      <button
        onClick={onTogglePanel}
        className="flex items-center gap-2 rounded-full bg-slate-700 px-4 py-2.5 text-sm font-medium text-white transition-all hover:bg-slate-600"
        title="View participants"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
          <path d="M4.5 6.375a4.125 4.125 0 118.25 0 4.125 4.125 0 01-8.25 0zM14.25 8.625a3.375 3.375 0 116.75 0 3.375 3.375 0 01-6.75 0zM1.5 19.125a7.125 7.125 0 0114.25 0v.003l-.001.119a.75.75 0 01-.363.63 13.067 13.067 0 01-6.761 1.873c-2.472 0-4.786-.684-6.76-1.873a.75.75 0 01-.364-.63l-.001-.122zM17.25 19.128l-.001.144a2.25 2.25 0 01-.233.96 10.088 10.088 0 005.06-1.01.75.75 0 00.42-.643 4.875 4.875 0 00-6.957-4.611 8.586 8.586 0 011.71 5.157v.003z" />
        </svg>
        <span className="hidden sm:inline">Participants</span>
        <span className="rounded bg-slate-600 px-1.5 py-0.5 text-xs">{totalParticipants}</span>
      </button>

      {/* Leave */}
      <button
        onClick={onLeave}
        className="flex items-center gap-2 rounded-full bg-red-600 px-5 py-2.5 text-sm font-medium text-white transition-all hover:bg-red-700 active:scale-95"
        title="Leave meeting"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
          <path fillRule="evenodd" d="M7.5 3.75A1.5 1.5 0 006 5.25v13.5a1.5 1.5 0 001.5 1.5h6a1.5 1.5 0 001.5-1.5V15a.75.75 0 011.5 0v3.75a3 3 0 01-3 3h-6a3 3 0 01-3-3V5.25a3 3 0 013-3h6a3 3 0 013 3V9A.75.75 0 0115 9V5.25a1.5 1.5 0 00-1.5-1.5h-6zm5.03 4.72a.75.75 0 010 1.06l-1.72 1.72h10.94a.75.75 0 010 1.5H10.81l1.72 1.72a.75.75 0 11-1.06 1.06l-3-3a.75.75 0 010-1.06l3-3a.75.75 0 011.06 0z" clipRule="evenodd" />
        </svg>
        <span className="hidden sm:inline">Leave</span>
      </button>
    </div>
  );
}

// Small helper for toolbar icon buttons
interface ToolbarButtonProps {
  active: boolean;
  activeLabel: string;
  inactiveLabel: string;
  inactiveColor: 'slate' | 'red';
  onClick: () => void;
  title: string;
  disabled?: boolean;
  children: React.ReactNode;
}

function ToolbarButton({ active, activeLabel, inactiveLabel, inactiveColor, onClick, title, disabled, children }: ToolbarButtonProps) {
  const inactiveBg = inactiveColor === 'red' ? 'bg-red-600 hover:bg-red-700' : 'bg-slate-700 hover:bg-slate-600';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 rounded-full px-3 py-2.5 text-sm font-medium transition-all active:scale-95 sm:px-4 ${
        disabled ? 'cursor-not-allowed opacity-40' : ''
      } ${
        active && !disabled ? 'bg-slate-700 text-white hover:bg-slate-600' : `${inactiveBg} text-white`
      }`}
      title={title}
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
        {children}
      </svg>
      <span className="hidden sm:inline">{active ? activeLabel : inactiveLabel}</span>
    </button>
  );
}
