'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { SocketEvents } from '@jehydro/shared-types';
import type { BreakoutRoomsState } from '@jehydro/shared-types';

// Minimal participant type used by this component
interface BreakoutParticipant {
  uuid: string;
  displayName: string;
  isHost: boolean;
}

interface BreakoutRoomsPanelProps {
  socket: Socket | null;
  roomId: string;
  myUuid: string;
  isHost: boolean;
  participants: BreakoutParticipant[];
  onClose: () => void;
}

const breakoutStore = new Map<string, BreakoutRoomsState | null>();
const broadcastHistoryStore = new Map<string, { senderName: string; message: string }[]>();

export function BreakoutRoomsPanel({
  socket,
  roomId,
  myUuid,
  isHost,
  participants,
  onClose,
}: BreakoutRoomsPanelProps) {
  const [breakoutState, setBreakoutState] = useState<BreakoutRoomsState | null>(
    () => breakoutStore.get(roomId) ?? null
  );
  const [roomCount, setRoomCount] = useState(2);
  const [broadcastText, setBroadcastText] = useState('');
  const [broadcastHistory, setBroadcastHistory] = useState<{ senderName: string; message: string }[]>(
    () => broadcastHistoryStore.get(roomId) ?? []
  );

  // My current breakout room (null if in main room)
  const myBreakoutRoomId = breakoutState?.assignments?.[myUuid] ?? null;
  const myBreakoutRoom = breakoutState?.rooms?.find((r) => r.id === myBreakoutRoomId);

  // -----------------------------------------------------------
  // Socket listeners
  // -----------------------------------------------------------
  useEffect(() => {
    if (!socket) return;

    const onBreakoutCreated = (payload: { state: BreakoutRoomsState }) => {
      breakoutStore.set(roomId, payload.state);
      setBreakoutState(payload.state);
    };

    const onBreakoutAssigned = (payload: { state: BreakoutRoomsState }) => {
      breakoutStore.set(roomId, payload.state);
      setBreakoutState(payload.state);
    };

    const onBreakoutClosed = () => {
      breakoutStore.set(roomId, null);
      broadcastHistoryStore.delete(roomId);
      setBreakoutState(null);
      setBroadcastHistory([]);
    };

    const onBreakoutBroadcasted = (payload: { senderName: string; message: string }) => {
      const existing = broadcastHistoryStore.get(roomId) ?? [];
      const updated = [...existing, payload];
      broadcastHistoryStore.set(roomId, updated);
      setBroadcastHistory(updated);
    };

    const onBreakoutState = (payload: { state: BreakoutRoomsState | null }) => {
      breakoutStore.set(roomId, payload.state);
      setBreakoutState(payload.state);
    };

    socket.on(SocketEvents.BREAKOUT_CREATED, onBreakoutCreated);
    socket.on(SocketEvents.BREAKOUT_ASSIGNED, onBreakoutAssigned);
    socket.on(SocketEvents.BREAKOUT_CLOSED, onBreakoutClosed);
    socket.on(SocketEvents.BREAKOUT_BROADCASTED, onBreakoutBroadcasted);
    socket.on(SocketEvents.BREAKOUT_STATE, onBreakoutState);

    // Request current state on mount
    socket.emit(SocketEvents.BREAKOUT_STATE);

    return () => {
      socket.off(SocketEvents.BREAKOUT_CREATED, onBreakoutCreated);
      socket.off(SocketEvents.BREAKOUT_ASSIGNED, onBreakoutAssigned);
      socket.off(SocketEvents.BREAKOUT_CLOSED, onBreakoutClosed);
      socket.off(SocketEvents.BREAKOUT_BROADCASTED, onBreakoutBroadcasted);
      socket.off(SocketEvents.BREAKOUT_STATE, onBreakoutState);
    };
  }, [socket, roomId]);

  // -----------------------------------------------------------
  // Host actions
  // -----------------------------------------------------------
  const handleCreate = useCallback(() => {
    socket?.emit(SocketEvents.BREAKOUT_CREATE, { roomCount });
  }, [socket, roomCount]);

  const handleAutoSplit = useCallback(() => {
    socket?.emit(SocketEvents.BREAKOUT_AUTO_SPLIT);
  }, [socket]);

  const handleClose = useCallback(() => {
    socket?.emit(SocketEvents.BREAKOUT_CLOSE);
  }, [socket]);

  const handleAssign = useCallback(
    (participantUuid: string, breakoutRoomId: string) => {
      socket?.emit(SocketEvents.BREAKOUT_ASSIGN, { participantUuid, breakoutRoomId });
    },
    [socket]
  );

  const handleBroadcast = useCallback(() => {
    const message = broadcastText.trim();
    if (!message) return;
    socket?.emit(SocketEvents.BREAKOUT_BROADCAST, { message });
    setBroadcastText('');
  }, [socket, broadcastText]);

  // -----------------------------------------------------------
  // Get participants grouped by breakout room
  // -----------------------------------------------------------
  const participantsByRoom = breakoutState?.rooms?.map((room) => ({
    room,
    participants: participants.filter((p) => room.participantUuids.includes(p.uuid)),
  })) ?? [];

  // Participants not assigned to any breakout room
  const unassignedParticipants = breakoutState?.isActive
    ? participants.filter((p) => !p.isHost && !breakoutState.assignments?.[p.uuid])
    : [];

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-slate-900/95 backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
        <h2 className="text-lg font-semibold text-white">Breakout Rooms</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-700 px-3 py-1.5 text-sm font-medium text-slate-300 hover:bg-slate-600 hover:text-white"
          >
            Close
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {/* Show breakout room indicator for non-host participants */}
        {!isHost && breakoutState?.isActive && (
          <div className="mb-4 rounded-xl border border-violet-600/50 bg-violet-600/10 p-4">
            <div className="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5 text-violet-400">
                <path d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
              </svg>
              <span className="text-sm font-medium text-violet-200">
                You are in <span className="font-semibold">{myBreakoutRoom?.name ?? 'Main Room'}</span>
              </span>
            </div>
            {myBreakoutRoom && (
              <p className="mt-1 text-xs text-violet-400">
                {myBreakoutRoom.participantUuids.length} participant{myBreakoutRoom.participantUuids.length === 1 ? '' : 's'} in this room
              </p>
            )}
          </div>
        )}

        {/* Host controls — only when NOT in active breakouts */}
        {isHost && !breakoutState?.isActive && (
          <div className="mb-4 rounded-xl border border-slate-600 bg-slate-800 p-4">
            <h3 className="mb-3 text-sm font-medium text-white">Create Breakout Rooms</h3>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="mb-1 block text-xs text-slate-400">Number of rooms</label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setRoomCount(Math.max(2, roomCount - 1))}
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600"
                    disabled={roomCount <= 2}
                  >
                    -
                  </button>
                  <span className="w-8 text-center text-lg font-semibold text-white">{roomCount}</span>
                  <button
                    type="button"
                    onClick={() => setRoomCount(Math.min(8, roomCount + 1))}
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600"
                    disabled={roomCount >= 8}
                  >
                    +
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCreate}
                className="mt-5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500"
              >
                Create
              </button>
            </div>
          </div>
        )}

        {/* Active breakout rooms view (host + participants) */}
        {breakoutState?.isActive && (
          <div className="space-y-4">
            {/* Host action buttons */}
            {isHost && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleAutoSplit}
                  className="rounded-lg bg-slate-700 px-3 py-1.5 text-sm font-medium text-slate-300 hover:bg-slate-600 hover:text-white"
                  title="Re-distribute all participants evenly"
                >
                  Auto-split
                </button>
                <button
                  type="button"
                  onClick={handleClose}
                  className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
                >
                  Close All Rooms
                </button>
              </div>
            )}

            {/* Host broadcast bar */}
            {isHost && (
              <div className="flex items-center gap-2 rounded-lg bg-slate-800 p-2">
                <input
                  type="text"
                  value={broadcastText}
                  onChange={(e) => setBroadcastText(e.target.value)}
                  placeholder="Broadcast message to all rooms..."
                  maxLength={500}
                  className="flex-1 rounded-lg border border-slate-600 bg-slate-700 px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                  onKeyDown={(e) => e.key === 'Enter' && handleBroadcast()}
                />
                <button
                  type="button"
                  onClick={handleBroadcast}
                  disabled={!broadcastText.trim()}
                  className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
                >
                  Send
                </button>
              </div>
            )}

            {/* Broadcast history */}
            {broadcastHistory.length > 0 && (
              <div className="rounded-lg border border-slate-600/50 bg-slate-800/50 p-3">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Announcements</h4>
                <div className="space-y-1.5">
                  {broadcastHistory.map((item, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <span className="shrink-0 rounded bg-amber-500/20 px-1.5 text-xs font-medium text-amber-400">
                        {item.senderName}
                      </span>
                      <span className="text-slate-200">{item.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Room cards */}
            {participantsByRoom.map(({ room, participants: roomParticipants }) => {
              const isCurrentRoom = room.id === myBreakoutRoomId;

              return (
                <div
                  key={room.id}
                  className={`rounded-xl border p-4 ${
                    isCurrentRoom
                      ? 'border-violet-600/50 bg-violet-600/5'
                      : 'border-slate-600 bg-slate-800'
                  }`}
                >
                  {/* Room header */}
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-white">{room.name}</span>
                      {isCurrentRoom && (
                        <span className="rounded bg-violet-600/20 px-1.5 py-0.5 text-[10px] font-medium text-violet-400">
                          YOU
                        </span>
                      )}
                      <span className="text-xs text-slate-400">
                        {room.participantUuids.length} participant{room.participantUuids.length === 1 ? '' : 's'}
                      </span>
                    </div>
                  </div>

                  {/* Participants in this room */}
                  <div className="space-y-1">
                    {roomParticipants.map((p) => (
                      <div
                        key={p.uuid}
                        className="flex items-center justify-between rounded-lg bg-slate-700/40 px-3 py-1.5"
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white"
                            style={{
                              background: `hsl(${hashCode(p.uuid) % 360}, 55%, 50%)`,
                            }}
                          >
                            {p.displayName.charAt(0).toUpperCase()}
                          </div>
                          <span className="text-sm text-slate-200">{p.displayName}</span>
                          {p.isHost && (
                            <span className="rounded bg-amber-500/20 px-1 text-[10px] font-semibold text-amber-400">
                              HOST
                            </span>
                          )}
                        </div>
                        {isHost && !p.isHost && (
                          <div className="flex gap-1">
                            {breakoutState?.rooms
                              ?.filter((r) => r.id !== room.id)
                              .map((r) => (
                                <button
                                  key={r.id}
                                  type="button"
                                  onClick={() => handleAssign(p.uuid, r.id)}
                                  className="rounded bg-slate-600 px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-slate-500"
                                  title={`Move to ${r.name}`}
                                >
                                  →{r.name.replace('Room ', '')}
                                </button>
                              ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Unassigned participants that could be added to this room (host only) */}
                  {isHost && unassignedParticipants.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {unassignedParticipants.map((p) => (
                        <div
                          key={p.uuid}
                          className="flex items-center justify-between rounded-lg bg-slate-700/20 px-3 py-1"
                        >
                          <span className="text-sm text-slate-400">{p.displayName}</span>
                          <button
                            type="button"
                            onClick={() => handleAssign(p.uuid, room.id)}
                            className="rounded bg-slate-600 px-2 py-0.5 text-[10px] text-slate-300 hover:bg-slate-500"
                          >
                            + Assign
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Empty state */}
            {breakoutState?.rooms?.length === 0 && (
              <div className="flex items-center justify-center py-12">
                <p className="text-sm text-slate-500">No breakout rooms created yet.</p>
              </div>
            )}
          </div>
        )}

        {/* No breakout state */}
        {!breakoutState?.isActive && !isHost && (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-slate-500">No active breakout rooms. Wait for the host to create them.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// Simple hash function for avatar colors
function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash);
}
