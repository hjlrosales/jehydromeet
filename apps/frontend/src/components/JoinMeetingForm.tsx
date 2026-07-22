'use client';

import { useState } from 'react';

export function JoinMeetingForm() {
  const [roomId, setRoomId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleJoin = () => {
    const trimmedRoomId = roomId.trim();
    const trimmedName = displayName.trim();

    if (!trimmedRoomId) {
      setError('Please enter a meeting link or ID.');
      return;
    }
    if (!trimmedName) {
      setError('Please enter your display name.');
      return;
    }
    if (trimmedName.length > 40) {
      setError('Display name cannot exceed 40 characters.');
      return;
    }

    // Extract room ID from URL if full link is pasted
    let finalRoomId = trimmedRoomId;
    if (trimmedRoomId.includes('/meet/')) {
      const parts = trimmedRoomId.split('/meet/');
      finalRoomId = parts[parts.length - 1]!.split(/[?#]/)[0]!;
    }

    if (finalRoomId.length < 8) {
      setError('Invalid meeting ID. It should be at least 8 characters.');
      return;
    }

    window.location.href = `/meet/${finalRoomId}?name=${encodeURIComponent(trimmedName)}`;
  };

  return (
    <div className="card">
      <h2 className="mb-6 text-xl font-semibold text-slate-900 dark:text-white">Join Meeting</h2>

      {/* Room ID / Link */}
      <div className="mb-4">
        <label
          htmlFor="join-link"
          className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
        >
          Meeting link or ID
        </label>
        <input
          id="join-link"
          type="text"
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
          placeholder="Paste a meeting link or ID"
          className="input-field"
          autoFocus
        />
      </div>

      {/* Display Name */}
      <div className="mb-5">
        <label
          htmlFor="join-name"
          className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
        >
          Your name
        </label>
        <input
          id="join-name"
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Enter your display name"
          className="input-field"
          maxLength={40}
        />
        <p className="mt-1 text-xs text-slate-400">{displayName.length}/40</p>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Join Button */}
      <button onClick={handleJoin} className="btn-primary w-full py-3 text-base">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="mr-2 h-5 w-5"
        >
          <path
            fillRule="evenodd"
            d="M12.97 3.97a.75.75 0 011.06 0l7.5 7.5a.75.75 0 010 1.06l-7.5 7.5a.75.75 0 11-1.06-1.06l6.22-6.22H3a.75.75 0 010-1.5h16.19l-6.22-6.22a.75.75 0 010-1.06z"
            clipRule="evenodd"
          />
        </svg>
        Join
      </button>
    </div>
  );
}
