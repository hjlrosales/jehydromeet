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
} from '@jehydro/shared-types';
import { RoomManager } from './rooms';

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

export function setupSignaling(io: SocketIOServer, roomManager: RoomManager): void {
  io.on('connection', (socket: Socket) => {
    console.log(`[signaling] Socket connected: ${socket.id}`);

    // -----------------------------------------------------------
    // room:create - Create a new meeting room
    // -----------------------------------------------------------
    socket.on(SocketEvents.ROOM_CREATE, (payload: RoomCreatePayload) => {
      try {
        const { mediaMode, displayName } = payload;

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

        // SFU mode not available yet
        if (mediaMode === 'sfu') {
          socket.emit(SocketEvents.ROOM_ERROR, {
            code: 'SFU_NOT_AVAILABLE',
            message: 'SFU mode (more than 8 participants) is coming soon. Please select mesh mode.',
          });
          return;
        }

        const { roomId, hostId, hostToken } = roomManager.createRoom(mediaMode, displayName.trim());

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
    socket.on(SocketEvents.ROOM_JOIN, (payload: RoomJoinPayload) => {
      try {
        const { roomId, displayName } = payload;

        // Validate display name
        if (!displayName || displayName.trim().length === 0 || displayName.length > 40) {
          socket.emit(SocketEvents.ROOM_ERROR, {
            code: 'INVALID_NAME',
            message: 'Display name must be between 1 and 40 characters.',
          });
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

        // Send joined payload back to the joining client
        const room = roomManager.getRoom(roomId);
        const joinedPayload: RoomJoinedPayload = {
          roomId,
          participants: roomManager.getParticipants(roomId),
          hostId: room!.hostId,
          mediaMode: room!.mediaMode,
          yourUuid: participant.uuid,
          locked: room!.locked,
          chatEnabled: room!.chatEnabled,
          screenShareAllowed: room!.screenShareAllowed,
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
    // Relays offe