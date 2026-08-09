'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { SocketEvents } from '@jehydro/shared-types';
import type { WhiteboardStroke, WhiteboardUpdate } from '@jehydro/shared-types';

interface WhiteboardProps {
  socket: Socket | null;
  roomId: string;
  myUuid: string;
  isHost: boolean;
  onClose: () => void;
}

const COLORS = ['#ffffff', '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899'];
const SIZES = [2, 4, 6, 10];

// In-memory stroke store per room (keyed on roomId)
const strokeStore = new Map<string, WhiteboardStroke[]>();
const whiteboardLocked = new Map<string, boolean>();

export function Whiteboard({ socket, roomId, myUuid, isHost, onClose }: WhiteboardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [strokes, setStrokes] = useState<WhiteboardStroke[]>(() => strokeStore.get(roomId) ?? []);
  const [color, setColor] = useState('#ffffff');
  const [size, setSize] = useState(4);
  const [locked, setLocked] = useState(() => whiteboardLocked.get(roomId) ?? false);
  const [isDrawing, setIsDrawing] = useState(false);

  const currentStroke = useRef<{ x: number; y: number }[]>([]);
  const strokesRef = useRef<WhiteboardStroke[]>(strokes);

  // Keep ref in sync
  strokesRef.current = strokes;

  // -----------------------------------------------------------
  // Redraw canvas whenever strokes change
  // -----------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size to container
    const rect = canvas.parentElement?.getBoundingClientRect();
    if (rect) {
      canvas.width = rect.width;
      canvas.height = rect.height;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw all strokes
    for (const stroke of strokes) {
      if (stroke.points.length < 2) continue;
      ctx.beginPath();
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.moveTo(stroke.points[0]!.x, stroke.points[0]!.y);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i]!.x, stroke.points[i]!.y);
      }
      ctx.stroke();
    }
  }, [strokes]);

  // -----------------------------------------------------------
  // Socket listeners for whiteboard sync
  // -----------------------------------------------------------
  useEffect(() => {
    if (!socket) return;

    const onWhiteboardUpdate = (payload: WhiteboardUpdate) => {
      if (payload.type === 'stroke') {
        const newStrokes = [...(strokeStore.get(roomId) ?? []), payload.stroke];
        strokeStore.set(roomId, newStrokes);
        setStrokes(newStrokes);
      } else if (payload.type === 'clear') {
        strokeStore.set(roomId, []);
        setStrokes([]);
      } else if (payload.type === 'lock') {
        whiteboardLocked.set(roomId, payload.locked);
        setLocked(payload.locked);
      }
    };

    const onWhiteboardClear = () => {
      strokeStore.set(roomId, []);
      setStrokes([]);
    };

    const onWhiteboardLock = (payload: { locked: boolean }) => {
      whiteboardLocked.set(roomId, payload.locked);
      setLocked(payload.locked);
    };

    /**
     * Respond to WHITEBOARD_STATE requests from new joiners:
     * only the host re-emits all existing strokes to avoid duplicates.
     */
    const onWhiteboardState = (_payload: { requesterId: string }) => {
      if (!isHost) return;
      const existingStrokes = strokeStore.get(roomId) ?? [];
      if (existingStrokes.length === 0) return;
      for (const stroke of existingStrokes) {
        socket.emit(SocketEvents.WHITEBOARD_UPDATE, {
          type: 'stroke',
          stroke,
        });
      }
    };

    socket.on(SocketEvents.WHITEBOARD_UPDATE, onWhiteboardUpdate);
    socket.on(SocketEvents.WHITEBOARD_CLEAR, onWhiteboardClear);
    socket.on(SocketEvents.WHITEBOARD_LOCK, onWhiteboardLock);
    socket.on(SocketEvents.WHITEBOARD_STATE, onWhiteboardState);

    // Request existing state when first mounting
    socket.emit(SocketEvents.WHITEBOARD_STATE);

    return () => {
      socket.off(SocketEvents.WHITEBOARD_UPDATE, onWhiteboardUpdate);
      socket.off(SocketEvents.WHITEBOARD_CLEAR, onWhiteboardClear);
      socket.off(SocketEvents.WHITEBOARD_LOCK, onWhiteboardLock);
      socket.off(SocketEvents.WHITEBOARD_STATE, onWhiteboardState);
    };
  }, [socket, roomId, myUuid, isHost]);

  // -----------------------------------------------------------
  // Drawing handlers
  // -----------------------------------------------------------
  const getCanvasPos = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return {
        x: clientX - rect.left,
        y: clientY - rect.top,
      };
    },
    []
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (locked) return;
      e.preventDefault();
      const pos = getCanvasPos(e.clientX, e.clientY);
      currentStroke.current = [pos];
      setIsDrawing(true);
      canvasRef.current?.setPointerCapture(e.pointerId);
    },
    [locked, getCanvasPos]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDrawing || locked) return;
      e.preventDefault();
      const pos = getCanvasPos(e.clientX, e.clientY);
      currentStroke.current.push(pos);

      // Draw incrementally
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const points = currentStroke.current;
      if (points.length < 2) return;
      const prev = points[points.length - 2]!;
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    },
    [isDrawing, locked, getCanvasPos, color, size]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isDrawing || locked) return;
      e.preventDefault();
      setIsDrawing(false);
      canvasRef.current?.releasePointerCapture(e.pointerId);

      const points = currentStroke.current;
      if (points.length < 2) return;

      // Create stroke and broadcast
      const stroke: WhiteboardStroke = {
        id: `${myUuid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        senderUuid: myUuid,
        points,
        color,
        width: size,
        timestamp: Date.now(),
      };

      // Add locally
      const newStrokes = [...strokesRef.current, stroke];
      strokeStore.set(roomId, newStrokes);
      setStrokes(newStrokes);

      // Broadcast via socket
      socket?.emit(SocketEvents.WHITEBOARD_UPDATE, {
        type: 'stroke',
        stroke,
      });

      currentStroke.current = [];
    },
    [isDrawing, locked, myUuid, color, size, socket, roomId]
  );

  // -----------------------------------------------------------
  // Host actions
  // -----------------------------------------------------------
  const handleClear = useCallback(() => {
    if (!isHost) return;
    strokeStore.set(roomId, []);
    setStrokes([]);
    socket?.emit(SocketEvents.WHITEBOARD_CLEAR);
  }, [isHost, socket, roomId]);

  const handleToggleLock = useCallback(() => {
    if (!isHost) return;
    const newLocked = !locked;
    whiteboardLocked.set(roomId, newLocked);
    setLocked(newLocked);
    socket?.emit(SocketEvents.WHITEBOARD_LOCK, { locked: newLocked });
  }, [isHost, locked, socket, roomId]);

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-slate-900/95 backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-white">Whiteboard</h2>
          {locked && (
            <span className="rounded bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-400">
              Locked
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Color picker */}
          <div className="flex items-center gap-1 rounded-lg bg-slate-800 p-1.5">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`h-6 w-6 rounded-full border-2 transition-all ${
                  color === c ? 'border-white scale-110' : 'border-transparent'
                }`}
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
          </div>

          {/* Size picker */}
          <div className="flex items-center gap-1 rounded-lg bg-slate-800 p-1.5">
            {SIZES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSize(s)}
                className={`flex items-center justify-center rounded-full p-1.5 transition-all ${
                  size === s ? 'bg-slate-600' : 'hover:bg-slate-700'
                }`}
                title={`${s}px`}
              >
                <div
                  className="rounded-full bg-white"
                  style={{ width: s + 4, height: s + 4 }}
                />
              </button>
            ))}
          </div>

          {isHost && (
            <>
              <button
                type="button"
                onClick={handleToggleLock}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  locked
                    ? 'bg-amber-600 text-white hover:bg-amber-500'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600 hover:text-white'
                }`}
              >
                {locked ? 'Unlock' : 'Lock'}
              </button>
              <button
                type="button"
                onClick={handleClear}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
              >
                Clear
              </button>
            </>
          )}

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-700 px-3 py-1.5 text-sm font-medium text-slate-300 hover:bg-slate-600 hover:text-white"
          >
            Close
          </button>
        </div>
      </div>

      {/* Lock overlay */}
      {locked && (
        <div className="absolute inset-x-0 top-14 z-10 flex items-center justify-center">
          <div className="rounded-full bg-slate-800/80 px-4 py-2 text-sm text-slate-400 backdrop-blur-sm">
            Whiteboard is locked by the host
          </div>
        </div>
      )}

      {/* Canvas */}
      <div className="flex-1 cursor-crosshair">
        <canvas
          ref={canvasRef}
          className="h-full w-full touch-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />
      </div>
    </div>
  );
}
