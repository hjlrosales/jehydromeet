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
  WaitingAdmitAllPayload,
  WaitingDenyPayload,
  WaitingDenyAllPayload,
  WaitingParticipantsListPayload,
  PollCreatePayload,
  PollVotePayload,
  PollClosePayload,
  BreakoutCreatePayload,
  BreakoutAssignPayload,
  BreakoutBroadcastPayload,
} from '@jehydro/shared-types';
import { RoomManager } from './rooms';
import { checkRateLimit } from './middleware/rateLimit';
import { AccessToken } from 'livekit-server-sdk';
import { startRecording, stopRecording, isRecording } from './services/recordingService';
import { recordMeetingJoin, recordMeetingLeave } from './services/meetingHistory';

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

// Maps participantUuid -> meeting history ID (for recording leave time on disconnect)
const historyIdByParticipant = new Map<string, string>();

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
        const { mediaMode, displayName, password, waitingRoom, prePolls } = payload;

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

        // Record meeting history for authenticated hosts
        const authUser = (socket as any)._user;
        if (authUser) {
          const historyId = await recordMeetingJoin(authUser.userId, roomId, 'host', mediaMode, 1);
          if (historyId) {
            historyIdByParticipant.set(hostId, historyId);
          }
        }

        // Create pre-created polls if provided
        if (prePolls && Array.isArray(prePolls) && prePolls.length > 0) {
          for (const prePoll of prePolls) {
            const question = (prePoll.question ?? '').trim();
            const options = (prePoll.options ?? [])
              .map((o: string) => o.trim())
              .filter((o: string) => o.length > 0);

            if (!question || options.length < 2) continue;

            const poll = roomManager.createPoll(roomId, hostId, question, options);
            if (poll) {
              io.to(roomId).emit(SocketEvents.POLL_CREATED, { poll });
              console.log(`[signaling] Pre-created poll in room ${roomId}: "${question}"`);
            }
          }
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

        // Record meeting history for authenticated joiners
        const authUser = (socket as any)._user;
        if (authUser) {
          const allParticipants = roomManager.getParticipants(roomId);
          const historyId = await recordMeetingJoin(authUser.userId, roomId, 'participant', room?.mediaMode ?? 'mesh', allParticipants.length);
          if (historyId) {
            historyIdByParticipant.set(participant.uuid, historyId);
          }
        }
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

    socket.on(SocketEvents.WAITING_ADMIT_ALL, async (_payload: WaitingAdmitAllPayload) => {
      try {
        const validation = validateHostAction(socket.id);
        if (!validation.valid) {
          socket.emit(SocketEvents.ROOM_ERROR, { code: 'NOT_HOST', message: validation.error });
          return;
        }

        const { roomId } = validation;

        // Lock overrides admit-all: if the meeting is locked, block admission
        const room = roomManager.getRoom(roomId);
        if (!room) {
          socket.emit(SocketEvents.ROOM_NOT_FOUND, { roomId });
          return;
        }
        if (room?.locked) {
          socket.emit(SocketEvents.ROOM_ERROR, {
            code: 'ROOM_LOCKED',
            message: 'Cannot admit participants while the meeting is locked. Unlock the meeting first.',
          });
          return;
        }

        const pendingList = roomManager.getPendingParticipants(roomId);
        if (pendingList.length === 0) {
          socket.emit(SocketEvents.ROOM_ERROR, { code: 'WAITING_EMPTY', message: 'No waiting participants to admit.' });
          return;
        }

        const mediaMode = room.mediaMode;
        const livekitUrl = mediaMode === 'sfu' ? LIVEKIT_URL : undefined;

        const { participants } = roomManager.admitAllPendingParticipants(roomId);

        if (participants.length === 0) {
          socket.emit(SocketEvents.ROOM_ERROR, { code: 'ADMIT_FAILED', message: 'Could not admit any participants. The room may be at full capacity.' });
          return;
        }

        // Admit each pending participant via their socket
        for (const participant of participants) {
          const admitSocketId = participantSockets.get(participant.uuid);
          if (admitSocketId) {
            const admitSocket = io.sockets.sockets.get(admitSocketId);
            if (admitSocket) {
              // Update socket tracking: move from pending to active
              socketRooms.set(admitSocketId, { roomId, participantUuid: participant.uuid });
              pendingSockets.delete(participant.uuid);
              participantSockets.set(participant.uuid, admitSocketId);

              // Join the Socket.IO room
              admitSocket.join(roomId);

              // Generate LiveKit token for SFU mode
              let livekitToken: string | undefined;
              if (mediaMode === 'sfu') {
                try {
                  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
                    identity: participant.uuid,
                    name: participant.displayName,
                    ttl: '12h',
                  });
                  at.addGrant({ roomJoin: true, room: roomId, canPublish: true, canSubscribe: true, canPublishData: true });
                  livekitToken = await at.toJwt();
                } catch (err) {
                  console.error('[signaling] Failed to generate LiveKit token for bulk admit:', err);
                }
              }

              // Send ROOM_JOINED to the admitted participant
              const joinedPayload: RoomJoinedPayload = {
                roomId,
                participants: roomManager.getParticipants(roomId),
                hostId: room.hostId,
                mediaMode,
                yourUuid: participant.uuid,
                locked: room.locked,
                chatEnabled: room.chatEnabled,
                screenShareAllowed: room.screenShareAllowed,
                livekitUrl,
                livekitToken,
              };
              admitSocket.emit(SocketEvents.ROOM_JOINED, joinedPayload);

              // Broadcast to room
              const partJoinedPayload: ParticipantJoinedPayload = { participant };
              admitSocket.to(roomId).emit(SocketEvents.PARTICIPANT_JOINED, partJoinedPayload);
            }
          }
        }

        // Notify host about updated (now empty) waiting list
        notifyHostAboutWaiting(io, roomManager, socket, roomId);
      } catch (err) {
        console.error('[signaling] Error admitting all participants:', err);
        socket.emit(SocketEvents.ROOM_ERROR, { code: 'INTERNAL_ERROR', message: 'Failed to admit all participants.' });
      }
    });

    socket.on(SocketEvents.WAITING_DENY_ALL, (_payload: WaitingDenyAllPayload) => {
      try {
        const validation = validateHostAction(socket.id);
        if (!validation.valid) {
          socket.emit(SocketEvents.ROOM_ERROR, { code: 'NOT_HOST', message: validation.error });
          return;
        }

        const { roomId } = validation;

        const pendingList = roomManager.getPendingParticipants(roomId);
        if (pendingList.length === 0) {
          socket.emit(SocketEvents.ROOM_ERROR, { code: 'WAITING_EMPTY', message: 'No waiting participants to deny.' });
          return;
        }

        const { denied } = roomManager.denyAllPendingParticipants(roomId);

        // Notify each denied participant and clean up tracking
        for (const pending of denied) {
          const denySocketId = participantSockets.get(pending.uuid);
          if (denySocketId) {
            const denySocket = io.sockets.sockets.get(denySocketId);
            if (denySocket) {
              denySocket.emit(SocketEvents.WAITING_REJECTED, { reason: 'The host denied your request to join the meeting.' });
            }
            // Clean up tracking
            pendingSockets.delete(pending.uuid);
            participantSockets.delete(pending.uuid);
            socketRooms.delete(denySocketId);
          }
        }

        // Notify host about updated (now empty) waiting list
        notifyHostAboutWaiting(io, roomManager, socket, roomId);
      } catch (err) {
        console.error('[signaling] Error denying all participants:', err);
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
    // Recording — host-only, SFU rooms only
    // -----------------------------------------------------------

    socket.on(SocketEvents.RECORDING_START, async () => {
      try {
        const validation = validateHostAction(socket.id);
        if (!validation.valid) {
          socket.emit(SocketEvents.RECORDING_ERROR, { roomId: '', error: validation.error });
          return;
        }

        const { roomId } = validation;

        // Only SFU rooms can record
        if (!roomManager.canRecord(roomId)) {
          socket.emit(SocketEvents.RECORDING_ERROR, {
            roomId,
            error: 'Recording is only available for meetings with more than 8 participants (SFU mode).',
          });
          return;
        }

        // Check if already recording
        if (roomManager.isRecording(roomId) || isRecording(roomId)) {
          socket.emit(SocketEvents.RECORDING_ERROR, {
            roomId,
            error: 'This meeting is already being recorded.',
          });
          return;
        }

        const recording = await startRecording(roomId);
        if (!recording) {
          socket.emit(SocketEvents.RECORDING_ERROR, {
            roomId,
            error: 'Failed to start recording. The recording service may be unavailable or storage is full.',
          });
          return;
        }

        // Update room state
        roomManager.setRecordingState(roomId, true, recording.id);

        // Notify all participants
        io.to(roomId).emit(SocketEvents.RECORDING_STARTED, {
          roomId,
          recording,
        });

        console.log(`[signaling] Recording started in room ${roomId} (egress: ${recording.id})`);
      } catch (err) {
        console.error('[signaling] Error starting recording:', err);
        socket.emit(SocketEvents.RECORDING_ERROR, { roomId: '', error: 'Failed to start recording.' });
      }
    });

    socket.on(SocketEvents.RECORDING_STOP, async () => {
      try {
        const validation = validateHostAction(socket.id);
        if (!validation.valid) {
          socket.emit(SocketEvents.RECORDING_ERROR, { roomId: '', error: validation.error });
          return;
        }

        const { roomId } = validation;

        // Check if recording is active
        if (!roomManager.isRecording(roomId) && !isRecording(roomId)) {
          socket.emit(SocketEvents.RECORDING_ERROR, {
            roomId,
            error: 'No active recording to stop.',
          });
          return;
        }

        // Pass userId for database persistence (Phase 15)
        const authUser = (socket as any)._user;
        const recording = await stopRecording(roomId, authUser?.userId);
        if (!recording) {
          socket.emit(SocketEvents.RECORDING_ERROR, {
            roomId,
            error: 'Failed to stop recording.',
          });
          return;
        }

        // Update room state
        roomManager.setRecordingState(roomId, false);

        // Add recording to room history
        roomManager.addRecording(roomId, recording);

        // Notify all participants
        io.to(roomId).emit(SocketEvents.RECORDING_STOPPED, {
          roomId,
          recording,
        });

        console.log(`[signaling] Recording stopped in room ${roomId} (duration: ${recording.durationMs}ms)`);
      } catch (err) {
        console.error('[signaling] Error stopping recording:', err);
        socket.emit(SocketEvents.RECORDING_ERROR, { roomId: '', error: 'Failed to stop recording.' });
      }
    });

    socket.on(SocketEvents.RECORDING_STATUS, () => {
      try {
        const roomEntry = socketRooms.get(socket.id);
        if (!roomEntry) return;

        const { roomId } = roomEntry;
        const roomRecordings = roomManager.getRecordings(roomId);
        const currentRecording = roomRecordings.find((r) => r.status === 'recording');

        socket.emit(SocketEvents.RECORDING_STATUS, {
          roomId,
          isRecording: roomManager.isRecording(roomId),
          recording: currentRecording ?? undefined,
        });
      } catch (err) {
        console.error('[signaling] Error getting recording status:', err);
      }
    });

    // -----------------------------------------------------------
    // Whiteboard — relay strokes and state changes to the room
    // -----------------------------------------------------------

    /**
     * whiteboard:update - Relay a whiteboard stroke to everyone in the room except sender.
     * Payload: { type: 'stroke', stroke: WhiteboardStroke } | { type: 'clear', clearedBy: string } | { type: 'lock', locked: boolean }
     */
    socket.on(SocketEvents.WHITEBOARD_UPDATE, (payload: unknown) => {
      try {
        const roomEntry = socketRooms.get(socket.id);
        if (!roomEntry) return;
        // Broadcast whiteboard update to all participants in the room except sender
        socket.to(roomEntry.roomId).emit(SocketEvents.WHITEBOARD_UPDATE, payload);
      } catch (err) {
        console.error('[signaling] Error relaying whiteboard update:', err);
      }
    });

    /**
     * whiteboard:clear - Host clears the whiteboard. Only the host can trigger this.
     */
    socket.on(SocketEvents.WHITEBOARD_CLEAR, () => {
      try {
        const validation = validateHostAction(socket.id);
        if (!validation.valid) {
          socket.emit(SocketEvents.ROOM_ERROR, { code: 'NOT_HOST', message: validation.error });
          return;
        }
        const { roomId } = validation;
        // Broadcast clear to all participants (including the host who sent it)
        io.to(roomId).emit(SocketEvents.WHITEBOARD_CLEAR, {
          roomId,
          clearedBy: validation.hostId,
        });
        console.log(`[signaling] Whiteboard cleared in room ${roomId} by host ${validation.hostId}`);
      } catch (err) {
        console.error('[signaling] Error clearing whiteboard:', err);
      }
    });

    /**
     * whiteboard:lock - Host locks/unlocks the whiteboard. Only the host can trigger this.
     */
    socket.on(SocketEvents.WHITEBOARD_LOCK, (payload: { locked: boolean }) => {
      try {
        const validation = validateHostAction(socket.id);
        if (!validation.valid) {
          socket.emit(SocketEvents.ROOM_ERROR, { code: 'NOT_HOST', message: validation.error });
          return;
        }
        const { roomId } = validation;
        // Broadcast lock state to all participants
        io.to(roomId).emit(SocketEvents.WHITEBOARD_LOCK, {
          roomId,
          locked: payload.locked,
        });
        console.log(`[signaling] Whiteboard ${payload.locked ? 'locked' : 'unlocked'} in room ${roomId} by host ${validation.hostId}`);
      } catch (err) {
        console.error('[signaling] Error locking whiteboard:', err);
      }
    });

    /**
     * whiteboard:state - Request the current whiteboard state (requested by a new joiner).
     * The sender who has the current state should respond with whiteboard:update messages.
     */
    socket.on(SocketEvents.WHITEBOARD_STATE, () => {
      try {
        const roomEntry = socketRooms.get(socket.id);
        if (!roomEntry) return;
        // Ask the room if anyone has whiteboard state to share
        socket.to(roomEntry.roomId).emit(SocketEvents.WHITEBOARD_STATE, {
          requesterId: roomEntry.participantUuid,
        });
      } catch (err) {
        console.error('[signaling] Error requesting whiteboard state:', err);
      }
    });

    // -----------------------------------------------------------
    // Polls — create, vote, close, and state sync
    // -----------------------------------------------------------

    /**
     * poll:create - Host creates a new poll. Only the host can trigger this.
     */
    socket.on(SocketEvents.POLL_CREATE, (payload: PollCreatePayload) => {
      try {
        const validation = validateHostAction(socket.id);
        if (!validation.valid) {
          socket.emit(SocketEvents.ROOM_ERROR, { code: 'NOT_HOST', message: validation.error });
          return;
        }

        const { roomId } = validation;

        // Validate question
        const question = payload.question.trim();
        if (!question || question.length > 500) {
          socket.emit(SocketEvents.ROOM_ERROR, {
            code: 'INVALID_POLL',
            message: 'Poll question must be between 1 and 500 characters.',
          });
          return;
        }

        // Validate options
        const options = payload.options
          .map((o) => o.trim())
          .filter((o) => o.length > 0);
        if (options.length < 2 || options.length > 10) {
          socket.emit(SocketEvents.ROOM_ERROR, {
            code: 'INVALID_POLL',
            message: 'Poll must have between 2 and 10 options.',
          });
          return;
        }

        const poll = roomManager.createPoll(roomId, validation.hostId, question, options);
        if (!poll) {
          socket.emit(SocketEvents.ROOM_ERROR, { code: 'POLL_FAILED', message: 'Failed to create poll.' });
          return;
        }

        // Broadcast to all participants (including creator)
        io.to(roomId).emit(SocketEvents.POLL_CREATED, { poll });
        console.log(`[signaling] Poll created in room ${roomId}: "${question}" (${options.length} options)`);
      } catch (err) {
        console.error('[signaling] Error creating poll:', err);
        socket.emit(SocketEvents.ROOM_ERROR, { code: 'INTERNAL_ERROR', message: 'Failed to create poll.' });
      }
    });

    /**
     * poll:vote - A participant votes on a poll option.
     */
    socket.on(SocketEvents.POLL_VOTE, (payload: PollVotePayload) => {
      try {
        const roomEntry = socketRooms.get(socket.id);
        if (!roomEntry) return;

        const { roomId, participantUuid } = roomEntry;
        const { pollId, optionId } = payload;

        if (!pollId || !optionId) {
          socket.emit(SocketEvents.ROOM_ERROR, { code: 'INVALID_VOTE', message: 'Invalid vote payload.' });
          return;
        }

        const poll = roomManager.votePoll(roomId, pollId, optionId, participantUuid);
        if (!poll) {
          socket.emit(SocketEvents.ROOM_ERROR, { code: 'VOTE_FAILED', message: 'Failed to vote. The poll may be closed or the option may not exist.' });
          return;
        }

        // Broadcast updated poll to all participants
        io.to(roomId).emit(SocketEvents.POLL_VOTED, { poll });
        console.log(`[signaling] Vote cast in room ${roomId} poll ${pollId} option ${optionId}`);
      } catch (err) {
        console.error('[signaling] Error voting:', err);
        socket.emit(SocketEvents.ROOM_ERROR, { code: 'INTERNAL_ERROR', message: 'Failed to vote.' });
      }
    });

    /**
     * poll:close - Host closes a poll. Only the host can trigger this.
     */
    socket.on(SocketEvents.POLL_CLOSE, (payload: PollClosePayload) => {
      try {
        const validation = validateHostAction(socket.id);
        if (!validation.valid) {
          socket.emit(SocketEvents.ROOM_ERROR, { code: 'NOT_HOST', message: validation.error });
          return;
        }

        const { roomId } = validation;
        const { pollId } = payload;

        if (!pollId) {
          socket.emit(SocketEvents.ROOM_ERROR, { code: 'INVALID_POLL', message: 'Poll ID is required.' });
          return;
        }

        const poll = roomManager.closePoll(roomId, pollId);
        if (!poll) {
          socket.emit(SocketEvents.ROOM_ERROR, { code: 'POLL_NOT_FOUND', message: 'Poll not found or already closed.' });
          return;
        }

        // Broadcast closed poll to all participants
        io.to(roomId).emit(SocketEvents.POLL_CLOSED, { poll });
        console.log(`[signaling] Poll ${pollId} closed in room ${roomId}`);
      } catch (err) {
        console.error('[signaling] Error closing poll:', err);
        socket.emit(SocketEvents.ROOM_ERROR, { code: 'INTERNAL_ERROR', message: 'Failed to close poll.' });
      }
    });

    /**
     * poll:state - Request current polls (e.g. when a participant reconnects).
     */
    socket.on(SocketEvents.POLL_STATE, () => {
      try {
        const roomEntry = socketRooms.get(socket.id);
        if (!roomEntry) return;

        const polls = roomManager.getPolls(roomEntry.roomId);
        socket.emit(SocketEvents.POLL_STATE, { polls });
      } catch (err) {
        console.error('[signaling] Error getting poll state:', err);
      }
    });

    // -----------------------------------------------------------
    // Breakout Rooms — create, assign, auto-split, close, broadcast, join/leave
    // -----------------------------------------------------------

    /**
     * breakout:create - Host creates N breakout rooms.
     */
    socket.on(SocketEvents.BREAKOUT_CREATE, (payload: BreakoutCreatePayload) => {
      try {
        const validation = validateHostAction(socket.id);
        if (!validation.valid) {
          socket.emit(SocketEvents.ROOM_ERROR, { code: 'NOT_HOST', message: validation.error });
          return;
        }

        const roomCount = payload.roomCount ?? 2;
        if (roomCount < 2 || roomCount > 8) {
          socket.emit(SocketEvents.ROOM_ERROR, {
            code: 'INVALID_BREAKOUT_COUNT',
            message: 'Breakout room count must be between 2 and 8.',
          });
          return;
        }

        const result = roomManager.createBreakoutRooms(validation.roomId, roomCount);
        if (!result) {
          socket.emit(SocketEvents.ROOM_ERROR, {
            code: 'BREAKOUT_ALREADY_ACTIVE',
            message: 'Breakout rooms are already active. Close them first.',
          });
          return;
        }

        const createdPayload = { state: result.state };

        // Broadcast to ALL participants (including host) so they know their assignment
        io.to(validation.roomId).emit(SocketEvents.BREAKOUT_CREATED, createdPayload);

        // Also notify each participant individually about their current breakout room
        // (the BREAKOUT_CREATED payload already has assignments)
        console.log(`[signaling] Breakout rooms created in room ${validation.roomId} by host ${validation.hostId}`);
      } catch (err) {
        console.error('[signaling] Error creating breakout rooms:', err);
        socket.emit(SocketEvents.ROOM_ERROR, { code: 'INTERNAL_ERROR', message: 'Failed to create breakout rooms.' });
      }
    });

    /**
     * breakout:assign - Host assigns a participant to a breakout room.
     */
    socket.on(SocketEvents.BREAKOUT_ASSIGN, (payload: BreakoutAssignPayload) => {
      try {
        const validation = validateHostAction(socket.id);
        if (!validation.valid) {
          socket.emit(SocketEvents.ROOM_ERROR, { code: 'NOT_HOST', message: validation.error });
          return;
        }

        const { participantUuid, roomId: breakoutRoomId } = payload;
        if (!participantUuid || !breakoutRoomId) {
          socket.emit(SocketEvents.ROOM_ERROR, { code: 'INVALID_ASSIGNMENT', message: 'Participant UUID and breakout room ID are required.' });
          return;
        }

        const ok = roomManager.assignToBreakout(validation.roomId, participantUuid, breakoutRoomId);
        if (!ok) {
          socket.emit(SocketEvents.ROOM_ERROR, { code: 'ASSIGN_FAILED', message: 'Failed to assign participant. Breakout rooms may not be active.' });
          return;
        }

        // Get the updated state and broadcast to all
        const state = roomManager.getBreakoutState(validation.roomId);
        io.to(validation.roomId).emit(SocketEvents.BREAKOUT_ASSIGNED, { state });

        console.log(`[signaling] Host assigned ${participantUuid} to ${breakoutRoomId}`);
      } catch (err) {
        console.error('[signaling] Error assigning to breakout:', err);
        socket.emit(SocketEvents.ROOM_ERROR, { code: 'INTERNAL_ERROR', message: 'Failed to assign participant.' });
      }
    });

    /**
     * breakout:auto-split - Host auto-splits all participants evenly.
     */
    socket.on(SocketEvents.BREAKOUT_AUTO_SPLIT, () => {
      try {
        const validation = validateHostAction(socket.id);
        if (!validation.valid) {
          socket.emit(SocketEvents.ROOM_ERROR, { code: 'NOT_HOST', message: validation.error });
          return;
        }

        const { roomId } = validation;

        // Get current breakout state to know room count
        const currentState = roomManager.getBreakoutState(roomId);
        if (!currentState || !currentState.isActive || currentState.rooms.length === 0) {
          socket.emit(SocketEvents.ROOM_ERROR, { code: 'NO_BREAKOUTS', message: 'No active breakout rooms to auto-split.' });
          return;
        }

        const roomCount = currentState.rooms.length;

        // Close and re-create with the same count
        roomManager.closeBreakoutRooms(roomId);
        const result = roomManager.createBreakoutRooms(roomId, roomCount);
        if (!result) {
          socket.emit(SocketEvents.ROOM_ERROR, { code: 'AUTO_SPLIT_FAILED', message: 'Failed to auto-split participants.' });
          return;
        }

        io.to(roomId).emit(SocketEvents.BREAKOUT_CREATED, { state: result.state });
        console.log(`[signaling] Auto-split participants in room ${roomId}`);
      } catch (err) {
        console.error('[signaling] Error auto-splitting:', err);
        socket.emit(SocketEvents.ROOM_ERROR, { code: 'INTERNAL_ERROR', message: 'Failed to auto-split participants.' });
      }
    });

    /**
     * breakout:close - Host closes all breakout rooms.
     */
    socket.on(SocketEvents.BREAKOUT_CLOSE, () => {
      try {
        const validation = validateHostAction(socket.id);
        if (!validation.valid) {
          socket.emit(SocketEvents.ROOM_ERROR, { code: 'NOT_HOST', message: validation.error });
          return;
        }

        const { roomId } = validation;

        const ok = roomManager.closeBreakoutRooms(roomId);
        if (!ok) {
          socket.emit(SocketEvents.ROOM_ERROR, { code: 'NO_BREAKOUTS', message: 'No active breakout rooms to close.' });
          return;
        }

        // Broadcast to all participants so they return to main room
        io.to(roomId).emit(SocketEvents.BREAKOUT_CLOSED, { roomId });
        console.log(`[signaling] Breakout rooms closed in room ${roomId}`);
      } catch (err) {
        console.error('[signaling] Error closing breakouts:', err);
        socket.emit(SocketEvents.ROOM_ERROR, { code: 'INTERNAL_ERROR', message: 'Failed to close breakout rooms.' });
      }
    });

    /**
     * breakout:broadcast - Host sends a message to all breakout rooms.
     */
    socket.on(SocketEvents.BREAKOUT_BROADCAST, (payload: BreakoutBroadcastPayload) => {
      try {
        const validation = validateHostAction(socket.id);
        if (!validation.valid) {
          socket.emit(SocketEvents.ROOM_ERROR, { code: 'NOT_HOST', message: validation.error });
          return;
        }

        const { roomId, hostId } = validation;
        const message = payload.message?.trim();
        if (!message || message.length > 500) {
          socket.emit(SocketEvents.ROOM_ERROR, { code: 'INVALID_MESSAGE', message: 'Message must be between 1 and 500 characters.' });
          return;
        }

        // Find host display name
        const host = roomManager.getParticipant(roomId, hostId);
        const senderName = host?.displayName ?? 'Host';

        // Broadcast to ALL participants (they filter based on breakout room on the client)
        io.to(roomId).emit(SocketEvents.BREAKOUT_BROADCASTED, {
          senderName,
          message,
        });
        console.log(`[signaling] Host broadcast in room ${roomId}: "${message}"`);
      } catch (err) {
        console.error('[signaling] Error broadcasting:', err);
        socket.emit(SocketEvents.ROOM_ERROR, { code: 'INTERNAL_ERROR', message: 'Failed to send broadcast.' });
      }
    });

    /**
     * breakout:state - Get the current breakout state.
     */
    socket.on(SocketEvents.BREAKOUT_STATE, () => {
      try {
        const roomEntry = socketRooms.get(socket.id);
        if (!roomEntry) return;

        const state = roomManager.getBreakoutState(roomEntry.roomId);
        socket.emit(SocketEvents.BREAKOUT_STATE, { state });
      } catch (err) {
        console.error('[signaling] Error getting breakout state:', err);
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

    // Record meeting leave for authenticated users (Phase 15)
    const historyId = historyIdByParticipant.get(participantUuid);
    if (historyId) {
      recordMeetingLeave(historyId);
      historyIdByParticipant.delete(participantUuid);
    }

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
  historyIdByParticipant.delete(participantUuid);
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
