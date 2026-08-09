'use client';

import { useCallback, useState } from 'react';
import { SocketEvents } from '@jehydro/shared-types';
import type { MediaMode, PrePollCreate, RoomCreatedPayload, RoomJoinedPayload, RoomErrorPayload } from '@jehydro/shared-types';
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

  // Pre-created polls state
  const [showPollBuilder, setShowPollBuilder] = useState(false);
  const [prePolls, setPrePolls] = useState<PrePollCreate[]>([]);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState<string[]>(['', '']);

  const addPoll = useCallback(() => {
    const question = pollQuestion.trim();
    const options = pollOptions.map((o) => o.trim()).filter((o) => o.length > 0);
    if (!question || options.length < 2) return;
    setPrePolls((prev) => [...prev, { question, options }]);
    setPollQuestion('');
    setPollOptions(['', '']);
  }, [pollQuestion, pollOptions]);

  const removePoll = useCallback((index: number) => {
    setPrePolls((prev) => prev.filter((_, i) => i !== index));
  }, []);

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
      prePolls: prePolls.length > 0 ? prePolls : undefined,
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

        {/* Pre-create polls */}
        <div className="mt-4 rounded-lg border border-slate-200 p-3 dark:border-slate-600">
          <button
            type="button"
            onClick={() => setShowPollBuilder(!showPollBuilder)}
            className="flex w-full items-center justify-between text-sm font-medium text-slate-800 dark:text-slate-200"
          >
            <span>Pre-create polls ({prePolls.length})</span>
            <svg
              className={`h-4 w-4 transition-transform ${showPollBuilder ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showPollBuilder && (
            <div className="mt-3 space-y-3">
              {/* Question */}
              <input
                type="text"
                value={pollQuestion}
                onChange={(e) => setPollQuestion(e.target.value)}
                placeholder="Poll question"
                maxLength={500}
                className="input-field text-sm"
              />

              {/* Options */}
              <div className="space-y-1.5">
                {pollOptions.map((opt, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={opt}
                      onChange={(e) => {
                        const updated = [...pollOptions];
                        updated[i] = e.target.value;
                        setPollOptions(updated);
                      }}
                      placeholder={`Option ${i + 1}`}
                      maxLength={200}
                      className="input-field flex-1 text-sm"
                    />
                    {pollOptions.length > 2 && (
                      <button
                        type="button"
                        onClick={() => setPollOptions((prev) => prev.filter((_, idx) => idx !== i))}
                        className="text-slate-400 hover:text-red-400"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {pollOptions.length < 10 && (
                <button
                  type="button"
                  onClick={() => setPollOptions((prev) => [...prev, ''])}
                  className="text-xs text-brand-500 hover:text-brand-400"
                >
                  + Add option
                </button>
              )}

              <button
                type="button"
                onClick={addPoll}
                disabled={!pollQuestion.trim() || pollOptions.filter((o) => o.trim()).length < 2}
                className="w-full rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-500 disabled:opacity-50"
              >
                Add Poll
              </button>

              {/* Created polls list */}
              {prePolls.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  {prePolls.map((poll, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between rounded-lg bg-slate-100 px-2.5 py-2 dark:bg-slate-700"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-slate-800 dark:text-slate-200">
                          {poll.question}
                        </p>
                        <p className="text-[10px] text-slate-500">
                          {poll.options.length} options
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removePoll(i)}
                        className="ml-2 shrink-0 text-slate-400 hover:text-red-400"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
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
