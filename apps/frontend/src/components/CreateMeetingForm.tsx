'use client';

import { useState } from 'react';
import { SocketEvents } from '@jehydro/shared-types';
import type { MediaMode, RoomCreatedPayload, RoomJoinedPayload, RoomErrorPayload } from '@jehydro/shared-types';
import { useSocket } from '@/hooks/useSocket';
import { setPendingRoomState } from '@/lib/roomState';

interface CreateMeetingFormProps {
  onCreated: (roomId: string) => void;
}

export function CreateMeetingForm({ onCreated }: CreateMeetingFormProps) {
  const [displayName, setDisplayName] = useState('');
  const [mediaMode, setMediaMode] = useState<MediaMode>('mesh');
  const [password, setPassword] = useState('');
  const [enableWaitingRoom, setEnableWaitingRoom] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const socket = useSocket();

  const handleCreate = async () => {
    const trimmedName = displayName.trim();
    if (!trimmedName) {
      setError('Please enter a display name.');
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

    setLoading(true);
    setError(null);

    socket.emit(SocketEvents.ROOM_CREATE, {
      mediaMode,
      displayName: trimmedName,
      micEnabled: true,
      cameraEnabled: true,
      password: password.trim() || undefined,
      waitingRoom: enableWaitingRoom || undefined,
    });

    socket.on(SocketEvents.ROOM_CREATED, (_payload: RoomCreatedPayload) => {
      socket.on(SocketEvents.ROOM_JOINED, (joinedPayload: RoomJoinedPayload) => {
        socket.off(SocketEvents.ROOM_CREATED);
        socket.off(SocketEvents.ROOM_JOINED);
        socket.off(SocketEvents.ROOM_ERROR);
        setLoading(false);

        sessionStorage.setItem('jehydro-host-token', joinedPayload.yourToken ?? '');
        sessionStorage.setItem('jehydro-host-id', joinedPayload.yourUuid);
        setPendingRoomState(joinedPayload, joinedPayload.yourToken ?? '');
        onCreated(joinedPayload.roomId);
      });
    });

    socket.on(SocketEvents.ROOM_ERROR, (payload: RoomErrorPayload) => {
      socket.off(SocketEvents.ROOM_CREATED);
      socket.off(SocketEvents.ROOM_JOINED);
      socket.off(SocketEvents.ROOM_ERROR);
      setLoading(false);
      setError(payload.message);
    });
  };

  return (
    <div className="card">
      <h2 className="mb-6 text-xl font-semibold text-slate-900 dark:text-white">Create Meeting</h2>

      {/* Display Name */}
      <div className="mb-5">
        <label htmlFor="create-name" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
          Your name
        </label>
        <input
          id="create-name"
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Enter your display name"
          className="input-field"
          maxLength={40}
          autoFocus
        />
        <p className="mt-1 text-xs text-slate-400">{displayName.length}/40</p>
      </div>

      {/* Expected participants selector */}
      <div className="mb-6">
        <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
          Expected participants
        </label>
        <div className="space-y-2">
          <label className={`flex cursor-pointer items-center rounded-lg border p-3 transition-all ${
            mediaMode === 'mesh'
              ? 'border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-900/20'
              : 'border-slate-200 hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-700/50'
          }`}>
            <input
              type="radio"
              name="mediaMode"
              value="mesh"
              checked={mediaMode === 'mesh'}
              onChange={() => setMediaMode('mesh')}
              className="h-4 w-4 text-brand-600 focus:ring-brand-500"
            />
            <div className="ml-3">
              <span className="text-sm font-medium text-slate-900 dark:text-white">Up to 8 people</span>
              <p className="text-xs text-slate-500 dark:text-slate-400">Peer-to-peer. Best for small meetings.</p>
            </div>
          </label>
          <label className={`flex cursor-pointer items-center rounded-lg border p-3 transition-all ${
            mediaMode === 'sfu'
              ? 'border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-900/20'
              : 'border-slate-200 hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-700/50'
          }`}>
            <input
              type="radio"
              name="mediaMode"
              value="sfu"
              checked={mediaMode === 'sfu'}
              onChange={() => setMediaMode('sfu')}
              className="h-4 w-4 text-brand-600 focus:ring-brand-500"
            />
            <div className="ml-3">
              <span className="text-sm font-medium text-slate-900 dark:text-white">More than 8 people (up to 50)</span>
              <p className="text-xs text-slate-500 dark:text-slate-400">Media server (SFU). Requires LiveKit.</p>
            </div>
          </label>
        </div>
      </div>

      {/* Meeting Options */}
      <div className="mb-6 rounded-lg border border-slate-200 p-4 dark:border-slate-600">
        <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">Meeting Options</h3>

        {/* Password */}
        <div className="mb-4">
          <label htmlFor="meeting-password" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
            Meeting password <span className="text-xs text-slate-400">(optional)</span>
          </label>
          <input
            id="meeting-password"
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter a password"
            className="input-field"
            maxLength={64}
          />
          <p className="mt-1 text-xs text-slate-400">
            {password ? 'Attendees will need this password to join.' : 'Leave blank for no password.'}
          </p>
        </div>

        {/* Waiting Room Toggle */}
        <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-700/50">
          <input
            type="checkbox"
            checked={enableWaitingRoom}
            onChange={(e) => setEnableWaitingRoom(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-slate-500"
          />
          <div>
            <span className="text-sm font-medium text-slate-900 dark:text-white">Waiting room</span>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Admit participants one by one from a waiting room.
            </p>
          </div>
        </label>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Create Button */}
      <button onClick={handleCreate} disabled={loading} className="btn-primary w-full py-3 text-base">
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Creating...
          </span>
        ) : (
          'Create Meeting'
        )}
      </button>
    </div>
  );
}
