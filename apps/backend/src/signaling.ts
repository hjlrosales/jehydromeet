import { Server as SocketIOServer, Socket } from 'socket.io';
import { SocketEvents } from '@jehydro/shared-types';
import type {
  RoomCreatePayload,
  RoomCreatedPayload,
  RoomJoinPayload,
  RoomJoinedPayload,
  ParticipantJoinedPayload,
  ParticipantLeftPayload,
  SignalMessage,
  ScreenShareStartPayload,
  ChatMessagePayload,
  WaitingAdmitPayload,
  WaitingDenyPayload,
  WaitingParticipantsListPayload,
} from '@jehydro/shared-types';
import { RoomManager } from './rooms';
import { checkRateLimit } from './middleware/rateLimit';
import { AccessToken } from 'livekit-server-sdk';

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY ?? '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET ?? '';
const LIVEKIT_URL = process.env.LIVEKIT_URL ?? '';

const MAX_ROOMS_PER_IP = process.env.MAX_ROOMS_PER_IP_PER_HOUR
  ? parseInt(process.env.MAX_ROOMS_PER_IP_PER_HOUR, 10)
  : 20;

// -----------------------------------------------------------
// Socket-to-room tracking
// We track every participant's socket so that leave/disconnect
// can properly remove them from their room.
// -----------------------------------------------------------

// Maps socketId -> { roomId, participantUuid }
const socketRooms = new Map<string, { roomId: string; participantUuid: string }>();

// Reverse lookup: participantUuid -> socketId (for WebRTC signaling relay)
const participantSockets = new Map<string, string>();

// Maps socketId -> { roomId, hostId, hostToken } (hosts only)
const hostTokens = new Map<string, { roomId: string; hostId: string; hostToken: string }>();

// Maps pending participant uuid -> socketId (waiting room only)
const pendingSockets = new Map<string, { roomId: string; participantUuid: string }>();

// Maps roomId:clientIp -> failed password attempts
const passwordAttempts = new Map<string, number>();

const MAX_PASSWORD_ATTEMPTS = 5;
const PASSWORD_RATE_LIMIT_WINDOW_MS = 60000; // 1 minute

export function setupSignaling(io: SocketIOServer, roomManager: RoomManager): void {
  io.on('connection', (socket: Socket) => {
    console.log(`[signaling] Socket connected: ${socket.id}`);

    // -----------------------------------------------------------
    // room:create - Create a new meeting room
    // -----------------------------------------------------------
    socket.on(SocketEvents.ROOM_CREATE, async (payload: RoomCreatePayload) => {
      try {
        const { mediaMode, displayName, password, waitingRoom } = payload;

        // Validate display name
        if (!displayName || displayName.trim().length === 0 || displayName.length > 40) {
          socket.emit(SocketEvents.ROOM_ERROR, {
            code: 'INVALID_NAME',
            message: 'Display name must be between 1 and 40 characters.',
          });
          return;
        }

        // Validate media mode
        if (mediaMode !== 'mesh' && mediaMode !== 'sfu') {
          socket.emit(SocketEvents.ROOM_ERROR, {
            code: 'INVALID_MEDIA_MODE',
            message: 'Invalid media mode. Must be "mesh" or "sfu".',
          });
          return;
        }

        // Check LiveKit is configured for SFU mode
        if (mediaMode === 'sfu' && (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_URL)) {
          socket.emit(SocketEvents.ROOM_ERROR, {
            code: 'SFU_NOT_AVAILABLE',
            message: 'SFU mode is not available because the LiveKit server is not configured. Please select mesh mode (up to 8 people) or contact the administrator.',
          });
          return;
        }

        // Abuse guardrail: rate limit room creation per IP
        const clientIp = (socket as any)._clientIp ?? 'unknown';
        const rateResult = checkRateLimit(`create_room:${clientIp}`, MAX_ROOMS_PER_IP, 3600_000);
        if (!rateResult.allowed) {
          socket.emit(SocketEvents.ROOM_ERROR, {
            code: 'RATE_LIMITED',
            message: `You have created too many rooms. Maximum ${MAX_ROOMS_PER_IP} per hour.`,
          });
          return;
        }

        const { roomId, hostId, hostToken } = roomManager.createRoom(mediaMode, displayName.trim());

        // Apply optional room options (password, waiting room)
        if (password || waitingRoom) {
          roomManager.setRoomOptions(roomId, password, waitingRoom);
        }

        // Generate LiveKit token for SFU mode
        let livekitToken: string | undefined;
        if (mediaMode === 'sfu') {
          try {
            const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
              identity: hostId,
              name: displayName.trim(),
              ttl: '12h',
            });
            at.addGrant({
              roomJoin: true,
              room: roomId,
              canPublish: true,
              canSubscribe: true,
              canPublishData: true,
            });
            livekitToken = await at.toJwt();
          } catch (err) {
            console.error('[signaling] Failed to generate LiveKit token:', err);
            socket.emit(SocketEvents.ROOM_ERROR, {
              code: 'SFU_TOKEN_ERROR',
              message: 'Failed to generate LiveKit access token. Please try mesh mode instead.',
            });
            return;
          }
        }

        // Track socket -> room and participant mapping
        socketRooms.set(socket.id, { roomId, participantUuid: hostId });
        participantSockets.set(hostId, socket.id);
        hostTokens.set(socket.id, { roomId, hostId, hostToken });

        // Join the socket to the room's Socket.IO room
        socket.join(roomId);

        const createdPayload: RoomCreatedPayload = {
          roomId,
          hostId,
          hostToken,
          mediaMode,
        };
        socket.emit(SocketEvents.ROOM_CREATED, createdPayload);

        // Also emit ROOM_JOINED so the creator can enter the meeting directly
        const joinedPayload: RoomJoinedPayload = {
          roomId,
          participants: roomManager.getParticipants(roomId),
          hostId,
          mediaMode,
          yourUuid: hostId,
          yourToken: hostToken,
          locked: false,
          chatEnabled: true,
          screenShareAllowed: true,
          livekitUrl: mediaMode === 'sfu' ? LIVEKIT_URL : undefined,
          livekitToken,
        };
        socket.emit(SocketEvents.ROOM_JOINED, joinedPayload);

        // Broadcast participant joined to others already in the room (none on first create)
        const participant = roomManager.getParticipant(roomId, hostId);
        if (participant) {
          const partJoinedPayload: ParticipantJoinedPayload = { participant };
          socket.to(roomId).emit(SocketEvents.PARTICIPANT_JOINED, partJoinedPayload);
        }
      } catch (err) {
        console.error('[signaling] Error creating room:', err);
        socket.emit(SocketEvents.ROOM_ERROR, {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred while creating the room.',
        });
      }
    });

    // -----------------------------------------------------------
    // room:join - Join an existing meeting room
    // -----------------------------------------------------------
    socket.on(SocketEvents.ROOM_JOIN, async (payload: RoomJoinPayload) => {
      try {
        const { roomId, displayName, password } = payload;

        // Validate display name
        if (!displayName || displayName.trim().length === 0 || displayName.length > 40) {
          socket.emit(SocketEvents.ROOM_ERROR, {
            code: 'INVALID_NAME',
            message: 'Display name must be between 1 and 40 characters.',
          });
          return;
        }

        // -------------------------------------------------------
        // Re-join detection: if this socket already has an entry
        // in this room (e.g. from room:create), reuse the existing
        // participant instead of creating a duplicate.
        // -------------------------------------------------------
        const existingEntry = socketRooms.get(socket.id);
        if (existingEntry && existingEntry.roomId === roomId) {
          const existingParticipant = roomManager.getParticipant(roomId, existingEntry.participantUuid);
          if (existingParticipant) {
            // Update display name in case it changed
            existingParticipant.displayName = displayName.trim();

            // Generate LiveKit token for SFU re-join
            const room = roomManager.getRoom(roomId);
            let livekitToken: string | undefined;
            if (room && room.mediaMode === 'sfu') {
              try {
                const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
                  identity: existingParticipant.uuid,
                  name: displayName.trim(),
                  ttl: '12h',
                });
                at.addGrant({ roomJoin: true, room: roomId, canPublish: true, canSubscribe: true, canPublishData: true });
                livekitToken = await at.toJwt();
              } catch (err) {
                console.error('[signaling] Failed to generate LiveKit token for re-join:', err);
              }
            }

            // Reuse existing participant for the ROOM_JOINED response
            const joinedPayload: RoomJoinedPayload = {
              roomId,
              participants: roomManager.getParticipants(roomId),
              hostId: room!.hostId,
              mediaMode: room!.mediaMode,
              yourUuid: existingParticipant.uuid,
              locked: room!.locked,
              chatEnabled: room!.chatEnabled,
              screenShareAllowed: room!.screenShareAllowed,
              livekitUrl: room && room.mediaMode === 'sfu' ? LIVEKIT_URL : undefined,
              livekitToken,
            };
            socket.emit(SocketEvents.ROOM_JOINED, joinedPayload);
            console.log(`[signaling] Re-join: ${existingParticipant.displayName} (${existingParticipant.uuid}) reusing socket ${socket.id}`);
            return;
          }
        }

        // -------------------------------------------------------
        // Password check
        // -------------------------------------------------------
        if (roomManager.hasPassword(roomId)) {
          if (!password) {
            // No password provided — tell client to ask for one
            socket.emit(SocketEvents.PASSWORD_REQUIRED, { roomId });
            return;
          }

          // Rate limit password attempts
          const clientIp = (socket as any)._clientIp ?? 'unknown';
          const attemptKey = `${roomId}:${clientIp}`;
          const currentAttempts = passwordAttempts.get(attemptKey) ?? 0;
          const remaining = Math.max(0, MAX_PASSWORD_ATTEMPTS - currentAttempts - 1);

          if (currentAttempts >= MAX_PASSWORD_ATTEMPTS) {
            socket.emit(SocketEvents.PASSWORD_INCORRECT, { roomId, attemptsRemaining: 0, locked: true });
            return;
          }

          if (!roomManager.verifyPassword(roomId, password)) {
            passwordAttempts.set(attemptKey, currentAttempts + 1);
            // Auto-expire after the window
            setTimeout(() => passwordAttempts.delete(attemptKey), PASSWORD_RATE_LIMIT_WINDOW_MS);
            socket.emit(SocketEvents.PASSWORD_INCORRECT, { roomId, attemptsRemaining: remaining });
            return;
          }

          // Clear successful attempts
          passwordAttempts.delete(attemptKey);
        }

        // -------------------------------------------------------
        // Waiting room check
        // -------------------------------------------------------
        if (roomManager.hasWaitingRoom(roomId)) {
          // Add to pending queue instead of directly joining
          const pending = roomManager.addPendingParticipant(roomId, displayName.trim());
          if (!pending) {
            socket.emit(SocketEvents.ROOM_NOT_FOUND, { roomId });
            return;
          }

          // Track this socket with a pending flag (keyed by participant UUID for lookups)
          socketRooms.set(socket.id, { roomId, participantUuid: pending.uuid });
          pendingSockets.set(pending.uuid, { roomId, participantUuid: pending.uuid });
          participantSockets.set(pending.uuid, socket.id);

          // Notify the host about the new waiting participant
          notifyHostAboutWaiting(io, roomManager, socket, roomId);

          // Also send a notification event so the host can show a toast
          const hostId = roomManager.getRoom(roomId)?.hostId;
          if (hostId) {
            const hostSocketId = participantSockets.get(hostId);
            if (hostSocketId) {
              const hostSocket = io.sockets.sockets.get(hostSocketId);
              if (hostSocket) {
                hostSocket.emit(SocketEvents.WAITING_PARTICIPANT_ADDED, {
                  participant: pending,
                });
              }
            }
          }

          // Tell the joining client they're waiting for admission
          socket.emit(SocketEvents.WAITING_ADMITTED, { roomId });
          console.log(`[signaling] ${displayName.trim()} (${pending.uuid}) is waiting in room ${roomId}`);
          return;
        }

        // Check if room exists and is joinable
        const canJoin = roomManager.canJoin(roomId);
        if (!canJoin.ok) {
          if (canJoin.error === 'Room not found') {
            socket.emit(SocketEvents.ROOM_NOT_FOUND, { roomId });
          } else if (canJoin.error === 'Room is locked') {
            socket.emit(SocketEvents.ROOM_ERROR, {
              code: 'ROOM_LOCKED',
              message: 'This meeting is locked. Only the host can admit new participants.',
            });
          } else if (canJoin.error === 'Room is full') {
            socket.emit(SocketEvents.ROOM_FULL, { roomId, capacity: 8 });
          }
          return;
        }

        const result = roomManager.addParticipant(roomId, displayName.trim(), payload.micEnabled, payload.cameraEnabled);
        if (!result) {
          socket.emit(SocketEvents.ROOM_NOT_FOUND, { roomId });
          return;
        }

        const { participant } = result;

        // Track this socket
        socketRooms.set(socket.id, { roomId, participantUuid: participant.uuid });
        participantSockets.set(participant.uuid, socket.id);

        // Join the socket to the room's Socket.IO room
        socket.join(roomId);

        // Generate LiveKit token for SFU mode
        const room = roomManager.getRoom(roomId);
        let livekitToken: string | undefined;
        if (room && room.mediaMode === 'sfu') {
          try {
            const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
              identity: participant.uuid,
              name: displayName.trim(),
              ttl: '12h',
            });
            at.addGrant({ roomJoin: true, room: roomId, canPublish: true, canSubscribe: true, canPublishData: true });
            livekitToken = await at.toJwt();
          } catch (err) {
            console.error('[signaling] Failed to generate LiveKit token:', err);
          }
        }

        // Send joined payload back to the joining client
        const joinedPayload: RoomJoinedPayload = {
          roomId,
          participants: roomManager.getParticipants(roomId),
          hostId: room!.hostId,
          mediaMode: room!.mediaMode,
          yourUuid: participant.uuid,
          locked: room!.locked,
          chatEnabled: room!.chatEnabled,
          screenShareAllowed: room!.screenShareAllowed,
          livekitUrl: room && room.mediaMode === 'sfu' ? LIVEKIT_URL : undefined,
          livekitToken,
        };
        socket.emit(SocketEvents.ROOM_JOINED, joinedPayload);

        // Broadcast to other participants
        const participantJoinedPayload: ParticipantJoinedPayload = { participant };
        socket.to(roomId).emit(SocketEvents.PARTICIPANT_JOINED, participantJoinedPayload);
      } catch (err) {
        console.error('[signaling] Error joining room:', err);
        socket.emit(SocketEvents.ROOM_ERROR, {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred while joining the room.',
        });
      }
    });

    // -----------------------------------------------------------
    // participant:updated - Broadcast media state changes to the room
    // -----------------------------------------------------------
    // -----------------------------------------------------------
    // Waiting room: host admit/deny
    // -----------------------------------------------------------

    socket.on(SocketEvents.WAITING_ADMIT, async (payload: WaitingAdmitPayload) => {
      try {
        const validation = validateHostAction(socket.id);
        if (!validation.valid) {
          socket.emit(SocketEvents.ROOM_ERROR, { code: 'NOT_HOST', message: validation.error });
          return;
        }

        const { roomId } = validation;

        // Lock overrides admit: if the meeting is locked, block admission
        const room = roomManager.getRoom(roomId);
        if (room?.locked) {
          socket.emit(SocketEvents.ROOM_ERROR, {
            code: 'ROOM_LOCKED',
            message: 'Cannot admit participants while the meeting is locked. Unlock the meeting first.',
          });
          return;
        }

        const pending = roomManager.getPendingParticipants(roomId);
        const target = pending.find((p) => p.uuid === payload.targetUuid);
        if (!target) {
          socket.emit(SocketEvents.ROOM_ERROR, { code: 'WAITING_NOT_FOUND', message: 'Waiting participant not found.' });
          return;
        }

        const result = roomManager.admitPendingParticipant(roomId, payload.targetUuid);
        if (!result) {
          socket.emit(SocketEvents.ROOM_ERROR, { code: 'ADMIT_FAILED', message: 'Failed to admit participant.' });
          return;
        }

        const { participant } = result;

        // Find the waiting participant's socket (participantSockets is always set)
        const admitSocketId = participantSockets.get(payload.targetUuid);

        if (admitSocketId) {
          const admitSocket = io.sockets.sockets.get(admitSocketId);
          if (admitSocket) {
            // Update socket tracking: move from pending to active
            socketRooms.set(admitSocketId, { roomId, participantUuid: participant.uuid });
            pendingSockets.delete(payload.targetUuid);
            participantSockets.set(participant.uuid, admitSocketId);

            // Join the Socket.IO room
            admitSocket.join(roomId);

            // Generate LiveKit token for SFU mode
            const room = roomManager.getRoom(roomId);
            let livekitToken: string | undefined;
            if (room && room.mediaMode === 'sfu') {
              try {
                const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
                  identity: participant.uuid,
                  name: participant.displayName,
                  ttl: '12h',
                });
                at.addGrant({ roomJoin: true, room: roomId, canPublish: true, canSubscribe: true, canPublishData: true });
                livekitToken = await at.toJwt();
              } catch (err) {
                console.error('[signaling] Failed to generate LiveKit token for admit:', err);
              }
            }

            // Send ROOM_JOINED to the admitted participant
            const joinedPayload: RoomJoinedPayload = {
              roomId,
              participants: roomManager.getParticipants(roomId),
              hostId: room?.hostId ?? '',
              mediaMode: room?.mediaMode ?? 'mesh',
              yourUuid: participant.uuid,
              locked: room?.locked ?? false,
              chatEnabled: room?.chatEnabled ?? true,
              screenShareAllowed: room?.screenShareAllowed ?? true,
              livekitUrl: room && room.mediaMode === 'sfu' ? LIVEKIT_URL : undefined,
              livekitToken,
            };
            admitSocket.emit(SocketEvents.ROOM_JOINED, joinedPayload);

            // Broadcast to room
            const partJoinedPayload: ParticipantJoinedPayload = { participant };
            admitSocket.to(roomId).emit(SocketEvents.PARTICIPANT_JOINED, partJoinedPayload);

            // Notify host about updated waiting list
            notifyHostAboutWaiting(io, roomManager, socket, roomId);
          }
        }
      } catch (err) {
        console.error('[signaling] Error admitting participant:', err);
        socket.emit(SocketEvents.ROOM_ERROR, { code: 'INTERNAL_ERROR', message: 'Failed to admit participant.' });
      }
    });

    socket.on(SocketEvents.WAITING_DENY, (payload: WaitingDenyPayload) => {
      try {
        const validation = validateHostAction(socket.id);
        if (!validation.valid) {
          socket.emit(SocketEvents.ROOM_ERROR, { code: 'NOT_HOST', message: validation.error });
          return;
        }

        const { roomId } = validation;
        const pending = roomManager.removePendingParticipant(roomId, payload.targetUuid);
        if (!pending) return;

        // Notify the denied participant (participantSockets is always set)
        const denySocketId = participantSockets.get(payload.targetUuid);
        if (denySocketId) {
          const denySocket = io.sockets.sockets.get(denySocketId);
          if (denySocket) {
            denySocket.emit(SocketEvents.WAITING_REJECTED, { reason: 'The host denied your request to join the meeting.' });
          }
          // Clean up tracking
          pendingSockets.delete(payload.targetUuid);
          participantSockets.delete(payload.targetUuid);
          socketRooms.delete(denySocketId);
        }

        // Notify host about updated waiting list
        notifyHostAboutWaiting(io, roomManager, socket, roomId);
      } catch (err) {
        console.error('[signaling] Error denying participant:', err);
      }
    });

    // -----------------------------------------------------------
    // participant:updated
    // -----------------------------------------------------------
    socket.on(SocketEvents.PARTICIPANT_UPDATED, (payload: { uuid: string; micEnabled?: boolean; cameraEnabled?: boolean; isSharingScreen?: boolean }) => {
      try {
        const roomEntry = socketRooms.get(socket.id);
        if (!roomEntry) return;
        // Broadcast to all other participants in the room
        socket.to(roomEntry.roomId).emit(SocketEvents.PARTICIPANT_UPDATED, payload);
      } catch (err) {
        console.error('[signaling] Error broadcasting participant:updated:', err);
      }
    });

    // -----------------------------------------------------------
    // room:leave - Leave a room
    // -----------------------------------------------------------
    socket.on(SocketEvents.ROOM_LEAVE, () => {
      try {
        handleLeave(socket, io, roomManager);
      } catch (err) {
        console.error('[signaling] Error leaving room:', err);
      }
    });

    // -----------------------------------------------------------
    // Disconnect - Clean up on socket disconnect
    // -----------------------------------------------------------
    socket.on('disconnect', () => {
      console.log(`[signaling] Socket disconnected: ${socket.id}`);
      try {
        handleLeave(socket, io, roomManager);
      } catch (err) {
        console.error('[signaling] Error on disconnect:', err);
      }
    });

    // -----------------------------------------------------------
    // WebRTC signaling relay
    // Relays offer/answer/ICE-candidate to the intended recipient.
    // -----------------------------------------------------------

    /**
     * signal:offer - Relay a WebRTC offer to a specific participant
     * Payload: { type: 'offer', from: uuid, to: uuid, payload: RTCSessionDescription }
     */
    socket.on(SocketEvents.SIGNAL_OFFER, (message: SignalMessage) => {
      try {
        const targetSocketId = participantSockets.get(message.to);
        if (targetSocketId) {
          io.to(targetSocketId).emit(SocketEvents.SIGNAL_OFFER, message);
        }
      } catch (err) {
        console.error('[signaling] Error relaying offer:', err);
      }
    });

    /**
     * signal:answer - Relay a WebRTC answer to a specific participant
     * Payload: { type: 'answer', from: uuid, to: uuid, payload: RTCSessionDescription }
     */
    socket.on(SocketEvents.SIGNAL_ANSWER, (message: SignalMessage) => {
      try {
        const targetSocketId = participantSockets.get(message.to);
        if (targetSocketId) {
          io.to(targetSocketId).emit(SocketEvents.SIGNAL_ANSWER, message);
        }
      } catch (err) {
        console.error('[signaling] Error relaying answer:', err);
      }
    });

    /**
     * signal:ice - Relay an ICE candidate to a specific participant
     */
    socket.on(SocketEvents.SIGNAL_ICE, (message: SignalMessage) => {
      try {
        const targetSocketId = participantSockets.get(message.to);
        if (targetSocketId) {
          io.to(targetSocketId).emit(SocketEvents.SIGNAL_ICE, message);
        }
      } catch (err) {
        console.error('[signaling] Error relaying ICE candidate:', err);
      }
    });

    // -----------------------------------------------------------
    // Host action validation helper
    // -----------------------------------------------------------

    /**
     * Validates that the sender is the host of their room.
     */
    function validateHostAction(socketId: string): {
      valid: true;
      roomId: string;
      hostId: string;
    } | { valid: false; error: string } {
      const roomEntry = socketRooms.get(socketId);
      if (!roomEntry) return { valid: false, error: 'Not in a room' };

      const tokenEntry = hostTokens.get(socketId);
      if (!tokenEntry) return { valid: false, error: 'Not the host' };

      const room = roomManager.getRoom(roomEntry.roomId);
      if (!room) return { valid: false, error: 'Room not found' };

      if (room.hostId !== tokenEntry.hostId) return { valid: false, error: 'Not the host' };

      return { valid: true, roomId: roomEntry.roomId, hostId: tokenEntry.hostId };
    }

    // -----------------------------------------------------------
    // Host actions
    // -----------------------------------------------------------

    socket.on(SocketEvents.HOST_LOCK, () => {
      const validation = validateHostAction(socket.id);
      if (!validation.valid) { socket.emit(SocketEvents.ROOM_ERROR, { code: 'NOT_HOST', message: validation.error }); return; }
      roomManager.setLocked(validation.roomId, true);
      io.to(validation.roomId).emit(SocketEvents.ROOM_LOCKED, { roomId: validation.roomId });
    });

    socket.on(SocketEvents.HOST_UNLOCK, () => {
      const validation = validateHostAction(socket.id);
      if (!validation.valid) { socket.emit(SocketEvents.ROOM_ERROR, { code: 'NOT_HOST', message: validation.error }); return; }
      roomManager.setLocked(validation.roomId, false);
      io.to(validation.roomId).emit(SocketEvents.ROOM_UNLOCKED, { roomId: validation.roomId });
    });

    socket.on(SocketEvents.HOST_END, () => {
      const validation = validateHostAction(socket.id);
      if (!validation.valid) { socket.emit(SocketEvents.ROOM_ERROR, { code: 'NOT_HOST', message: validation.error }); return; }
      io.to(validation.roomId).emit(SocketEvents.ROOM_ENDED, { roomId: validation.roomId, reason: 'Host ended the meeting' });
      // Clean up all sockets in the room
      for (const p of roomManager.getParticipants(validation.roomId)) {
        const sid = participantSockets.get(p.uuid);
        if (sid) {
          socketRooms.delete(sid); participantSockets.delete(p.uuid); hostTokens.delete(sid);
          io.sockets.sockets.get(sid)?.leave(validation.roomId);
        }
      }
      roomManager.destroyRoom(validation.roomId);
    });

    socket.on(SocketEvents.HOST_REMOVE, (payload: { targetUuid: string }) => {
      const validation = validateHostAction(socket.id);
      if (!validation.valid) { socket.emit(SocketEvents.ROOM_ERROR, { code: 'NOT_HOST', message: validation.error }); return; }
      if (payload.targetUuid === validation.hostId) { socket.emit(SocketEvents.ROOM_ERROR, { code: 'CANNOT_REMOVE_SELF', message: 'You cannot remove yourself.' }); return; }
      if (!roomManager.getParticipant(validation.roomId, payload.targetUuid)) {
        socket.emit(SocketEvents.ROOM_ERROR, { code: 'PARTICIPANT_NOT_FOUND', message: 'Participant not found.' }); return;
      }
      const targetSocketId = participantSockets.get(payload.targetUuid);
      if (targetSocketId) {
        io.to(targetSocketId).emit(SocketEvents.PARTICIPANT_REMOVED, { reason: 'You were removed from the meeting by the host.' });
        roomManager.removeParticipant(validation.roomId, payload.targetUuid);
        io.to(validation.roomId).emit(SocketEvents.PARTICIPANT_LEFT, { uuid: payload.targetUuid });
        socketRooms.delete(targetSocketId); participantSockets.delete(payload.targetUuid); hostTokens.delete(targetSocketId);
        io.sockets.sockets.get(targetSocketId)?.leave(validation.roomId);
      }
    });

    socket.on(SocketEvents.HOST_MUTE, (payload: { targetUuid: string }) => {
      const validation = validateHostAction(socket.id);
      if (!validation.valid) { socket.emit(SocketEvents.ROOM_ERROR, { code: 'NOT_HOST', message: validation.error }); return; }
      if (payload.targetUuid === validation.hostId) { socket.emit(SocketEvents.ROOM_ERROR, { code: 'CANNOT_MUTE_SELF', message: 'You cannot mute yourself.' }); return; }
      const tid = participantSockets.get(payload.targetUuid);
      if (tid) io.to(tid).emit(SocketEvents.HOST_MUTE, { targetUuid: payload.targetUuid });
    });

    socket.on(SocketEvents.HOST_MUTE_ALL, () => {
      const validation = validateHostAction(socket.id);
      if (!validation.valid) { socket.emit(SocketEvents.ROOM_ERROR, { code: 'NOT_HOST', message: validation.error }); return; }
      for (const p of roomManager.getParticipants(validation.roomId)) {
        if (p.uuid !== validation.hostId) {
          const tid = participantSockets.get(p.uuid);
          if (tid) io.to(tid).emit(SocketEvents.HOST_MUTE, { targetUuid: p.uuid });
        }
      }
    });

    // -----------------------------------------------------------
    // Screen sharing
    // -----------------------------------------------------------

    /**
     * screen-share:start - Attempt to start sharing. Server validates:
     * - Screen sharing is allowed by the host
     * - No other participant is currently sharing
     */
    socket.on(SocketEvents.SCREEN_SHARE_START, (payload: ScreenShareStartPayload) => {
      try {
        const roomEntry = socketRooms.get(socket.id);
        if (!roomEntry) {
          socket.emit(SocketEvents.SCREEN_SHARE_BLOCKED, { reason: 'Not in a room' });
          return;
        }

        const result = roomManager.startScreenShare(roomEntry.roomId, payload.uuid);
        if (result.ok) {
          // Broadcast to all participants in the room (including the sharer)
          io.to(roomEntry.roomId).emit(SocketEvents.SCREEN_SHARE_STARTED, {
            uuid: payload.uuid,
          });
        } else {
          socket.emit(SocketEvents.SCREEN_SHARE_BLOCKED, { reason: result.error });
        }
      } catch (err) {
        console.error('[signaling] Error starting screen share:', err);
      }
    });

    /**
     * screen-share:stop - Stop sharing.
     */
    socket.on(SocketEvents.SCREEN_SHARE_STOP, (payload: { uuid: string }) => {
      try {
        const roomEntry = socketRooms.get(socket.id);
        if (!roomEntry) return;

        roomManager.stopScreenShare(roomEntry.roomId, payload.uuid);
        io.to(roomEntry.roomId).emit(SocketEvents.SCREEN_SHARE_STOPPED, {
          uuid: payload.uuid,
        });
      } catch (err) {
        console.error('[signaling] Error stopping screen share:', err);
      }
    });

    // -----------------------------------------------------------
    // Chat
    // -----------------------------------------------------------

    /**
     * chat:message - Relay a chat message to the room.
     * Validates: chat enabled, message length, basic sanitization.
     */
    socket.on(SocketEvents.CHAT_MESSAGE, (payload: ChatMessagePayload) => {
      try {
        const roomEntry = socketRooms.get(socket.id);
        if (!roomEntry) return;

        const room = roomManager.getRoom(roomEntry.roomId);
        if (!room) return;

        // Check if chat is enabled
        if (!room.chatEnabled) {
          socket.emit(SocketEvents.CHAT_DISABLED, { reason: 'Chat is disabled by the host' });
          return;
        }

        const { message } = payload;

        // Validate message
        if (!message.text || message.text.trim().length === 0) return;
        if (message.text.length > 2000) {
          socket.emit(SocketEvents.ROOM_ERROR, {
            code: 'MESSAGE_TOO_LONG',
            message: 'Message cannot exceed 2000 characters.',
          });
          return;
        }

        // Don't escape HTML — React's default text rendering handles XSS prevention
        const relayPayload: ChatMessagePayload = {
          message: {
            id: message.id,
            senderUuid: message.senderUuid,
            senderName: message.senderName,
            text: message.text,
            timestamp: message.timestamp,
          },
        };

        // Broadcast to ALL participants in the room except sender
        // (sender adds their own message locally for instant feedback)
        socket.to(roomEntry.roomId).emit(SocketEvents.CHAT_MESSAGE, relayPayload);
      } catch (err) {
        console.error('[signaling] Error handling chat message:', err);
      }
    });
  });
}

/**
 * Handle a socket leaving its room(s). Uses the socketRooms tracking map
 * instead of socket.rooms (which is empty on disconnect). Cleans up
 * host tokens, pending sockets, and broadcasts participant:left.
 */
function handleLeave(socket: Socket, io: SocketIOServer, roomManager: RoomManager): void {
  const roomEntry = socketRooms.get(socket.id);
  if (!roomEntry) return;

  const { roomId, participantUuid } = roomEntry;

  // Check if this was a pending (waiting room) socket
  const pendingEntry = pendingSockets.get(participantUuid);
  if (pendingEntry) {
    // Remove from pending queue
    roomManager.removePendingParticipant(roomId, participantUuid);
    pendingSockets.delete(participantUuid);
    participantSockets.delete(participantUuid);
    socketRooms.delete(socket.id);
    socket.leave(roomId);

    // Notify host about updated waiting list
    const hostId = roomManager.getRoom(roomId)?.hostId;
    if (hostId) {
      const hostSocketId = participantSockets.get(hostId);
      if (hostSocketId) {
        const hostSocket = io.sockets.sockets.get(hostSocketId);
        if (hostSocket) {
          notifyHostAboutWaiting(io, roomManager, hostSocket, roomId);
        }
      }
    }
    return;
  }

  const participant = roomManager.removeParticipant(roomId, participantUuid);
  if (participant) {
    const leftPayload: ParticipantLeftPayload = { uuid: participant.uuid };
    socket.to(roomId).emit(SocketEvents.PARTICIPANT_LEFT, leftPayload);

    // Handle host migration if the leaving participant was the host
    if (participant.isHost) {
      const migration = roomManager.promoteNextHost(roomId);
      if (migration) {
        // Store host token for the new host so they can perform host actions
        const newHostSocketId = participantSockets.get(migration.newHostId);
        if (newHostSocketId) {
          hostTokens.set(newHostSocketId, {
            roomId,
            hostId: migration.newHostId,
            hostToken: migration.newHostToken,
          });
        }
        io.to(roomId).emit(SocketEvents.HOST_MIGRATED, {
          newHostId: migration.newHostId,
          newHostToken: migration.newHostToken,
        });
      }
    }
  }

  socket.leave(roomId);

  // Clean up tracking
  socketRooms.delete(socket.id);
  participantSockets.delete(participantUuid);
  hostTokens.delete(socket.id);
}

/**
 * Notify the host about the current waiting list for a room.
 * Emits the full list of waiting participants to the host's socket
 * and a notification that someone new is waiting.
 */
function notifyHostAboutWaiting(io: SocketIOServer, roomManager: RoomManager, _socket: Socket, roomId: string): void {
  const room = roomManager.getRoom(roomId);
  if (!room) return;

  const hostSocketId = participantSockets.get(room.hostId);
  if (!hostSocketId) return;

  const hostSocket = io.sockets.sockets.get(hostSocketId);
  if (!hostSocket) return;

  const waitingParticipants = roomManager.getPendingParticipants(roomId);
  const listPayload: WaitingParticipantsListPayload = { participants: waitingParticipants };
  hostSocket.emit(SocketEvents.WAITING_PARTICIPANTS_LIST, listPayload);
}
