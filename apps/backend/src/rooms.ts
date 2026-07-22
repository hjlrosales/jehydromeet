import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import type { MediaMode, Participant, WaitingParticipant, Room as RoomState } from '@jehydro/shared-types';

// -----------------------------------------------------------
// In-memory room store
// -----------------------------------------------------------
const rooms = new Map<string, RoomState>();

const ROOM_ID_LENGTH = 8;
const ROOM_ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const ROOM_EMPTY_TTL_MS =
  (process.env.ROOM_EMPTY_TTL_MIN ? parseInt(process.env.ROOM_EMPTY_TTL_MIN, 10) : 10) * 60 * 1000;

const CAPACITY: Record<MediaMode, number> = {
  mesh: 8,
  sfu: 50,
};

// -----------------------------------------------------------
// Room ID generation
// -----------------------------------------------------------
function generateRoomId(): string {
  const bytes = crypto.randomBytes(ROOM_ID_LENGTH);
  let id = '';
  for (let i = 0; i < ROOM_ID_LENGTH; i++) {
    id += ROOM_ID_CHARS[bytes[i]! % ROOM_ID_CHARS.length];
  }
  return id;
}

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

// -----------------------------------------------------------
// Room Manager
// -----------------------------------------------------------
export class RoomManager {
  /**
   * Create a new room and return its ID, the host's UUID, and the host token.
   */
  createRoom(mediaMode: MediaMode, hostDisplayName: string): {
    roomId: string;
    hostId: string;
    hostToken: string;
  } {
    let roomId: string;
    do {
      roomId = generateRoomId();
    } while (rooms.has(roomId));

    const hostId = uuidv4();
    const hostToken = generateToken();

    const participant: Participant = {
      uuid: hostId,
      displayName: hostDisplayName,
      joinedAt: Date.now(),
      micEnabled: true,
      cameraEnabled: true,
      isSharingScreen: false,
      isHost: true,
      connectionState: 'connected',
    };

    const room: RoomState & { password?: string; waitingRoom: boolean; pendingParticipants: Map<string, WaitingParticipant> } = {
      roomId,
      mediaMode,
      hostId,
      participants: new Map([[hostId, participant]]),
      locked: false,
      chatEnabled: true,
      screenShareAllowed: true,
      currentScreenSharerId: null,
      createdAt: Date.now(),
      password: undefined,
      waitingRoom: false,
      pendingParticipants: new Map(),
    };

    rooms.set(roomId, room);
    console.log(`[rooms] Created room ${roomId} (mode: ${mediaMode}, host: ${hostDisplayName})`);

    return { roomId, hostId, hostToken };
  }

  /**
   * Set the room password and waiting room toggle.
   */
  setRoomOptions(roomId: string, password?: string, waitingRoom?: boolean): boolean {
    const room = rooms.get(roomId);
    if (!room) return false;
    const r = room as any;

    if (password !== undefined) {
      r.password = password ? crypto.createHash('sha256').update(password).digest('hex') : undefined;
    }
    if (waitingRoom !== undefined) {
      r.waitingRoom = waitingRoom;
    }
    return true;
  }

  /**
   * Check if a room has a password set.
   */
  hasPassword(roomId: string): boolean {
    const room = rooms.get(roomId);
    return !!((room as any)?.password);
  }

  /**
   * Verify the meeting password.
   */
  verifyPassword(roomId: string, password: string): boolean {
    const room = rooms.get(roomId) as any;
    if (!room?.password) return true; // No password set
    const hash = crypto.createHash('sha256').update(password).digest('hex');
    return room.password === hash;
  }

  /**
   * Check if waiting room is enabled.
   */
  hasWaitingRoom(roomId: string): boolean {
    const room = rooms.get(roomId);
    return !!(room as any)?.waitingRoom;
  }

  /**
   * Add a participant to the waiting room (pending queue).
   */
  addPendingParticipant(roomId: string, displayName: string): WaitingParticipant | null {
    const room = rooms.get(roomId);
    if (!room) return null;

    const uuid = uuidv4();
    const pending: WaitingParticipant = {
      uuid,
      displayName,
      joinedAt: Date.now(),
    };

    const roomAny = room as any;
    if (!roomAny.pendingParticipants) {
      roomAny.pendingParticipants = new Map<string, WaitingParticipant>();
    }
    roomAny.pendingParticipants.set(uuid, pending);
    console.log(`[rooms] ${displayName} (${uuid}) is waiting to join room ${roomId}`);
    return pending;
  }

  /**
   * Remove a participant from the waiting room.
   */
  removePendingParticipant(roomId: string, uuid: string): WaitingParticipant | null {
    const room = rooms.get(roomId);
    if (!room) return null;

    const roomAny = room as any;
    if (!roomAny.pendingParticipants) return null;

    const pending = roomAny.pendingParticipants.get(uuid);
    if (!pending) return null;

    roomAny.pendingParticipants.delete(uuid);
    return pending;
  }

  /**
   * Get all waiting participants.
   */
  getPendingParticipants(roomId: string): WaitingParticipant[] {
    const room = rooms.get(roomId);
    if (!room) return [];
    const roomAny = room as any;
    if (!roomAny.pendingParticipants) return [];
    return Array.from(roomAny.pendingParticipants.values());
  }

  /**
   * Admit a waiting participant into the meeting.
   */
  admitPendingParticipant(roomId: string, pendingUuid: string): { participant: Participant } | null {
    const room = rooms.get(roomId);
    if (!room) return null;

    const roomAny = room as any;
    if (!roomAny.pendingParticipants) return null;

    const pending = roomAny.pendingParticipants.get(pendingUuid);
    if (!pending) return null;

    // Remove from pending
    roomAny.pendingParticipants.delete(pendingUuid);

    // Add as participant
    const participant: Participant = {
      uuid: pending.uuid,
      displayName: pending.displayName,
      joinedAt: Date.now(),
      micEnabled: true,
      cameraEnabled: true,
      isSharingScreen: false,
      isHost: false,
      connectionState: 'connected',
    };
    room.participants.set(participant.uuid, participant);

    console.log(`[rooms] ${participant.displayName} (${participant.uuid}) admitted to room ${roomId}`);
    return { participant };
  }

  /**
   * Get room by ID. Returns undefined if not found.
   */
  getRoom(roomId: string): RoomState | undefined {
    return rooms.get(roomId);
  }

  /**
   * Check if a room exists and is joinable.
   */
  canJoin(roomId: string, lockedOk: boolean = false): { ok: boolean; error?: string } {
    const room = rooms.get(roomId);
    if (!room) {
      return { ok: false, error: 'Room not found' };
    }
    if (room.locked && !lockedOk) {
      return { ok: false, error: 'Room is locked' };
    }
    const capacity = CAPACITY[room.mediaMode];
    if (room.participants.size >= capacity) {
      return { ok: false, error: 'Room is full' };
    }
    return { ok: true };
  }

  /**
   * Add a participant to a room. Returns their assigned UUID.
   */
  addParticipant(roomId: string, displayName: string, micEnabled: boolean, cameraEnabled: boolean): {
    participant: Participant;
    token?: string;
  } | null {
    const room = rooms.get(roomId);
    if (!room) return null;

    const uuid = uuidv4();
    const participant: Participant = {
      uuid,
      displayName,
      joinedAt: Date.now(),
      micEnabled,
      cameraEnabled,
      isSharingScreen: false,
      isHost: false,
      connectionState: 'connected',
    };

    room.participants.set(uuid, participant);
    console.log(`[rooms] Participant ${displayName} (${uuid}) joined room ${roomId}`);
    return { participant };
  }

  /**
   * Remove a participant from a room. Returns the removed participant or null.
   * If the room becomes empty, schedules garbage collection.
   */
  removeParticipant(roomId: string, uuid: string): Participant | null {
    const room = rooms.get(roomId);
    if (!room) return null;

    const participant = room.participants.get(uuid);
    if (!participant) return null;

    room.participants.delete(uuid);

    // Clear screen sharer if they were sharing
    if (room.currentScreenSharerId === uuid) {
      room.currentScreenSharerId = null;
    }

    // If room is now empty, schedule cleanup
    if (room.participants.size === 0) {
      setTimeout(() => {
        const stillEmpty = rooms.get(roomId)?.participants.size === 0;
        if (stillEmpty) {
          rooms.delete(roomId);
          console.log(`[rooms] Deleted empty room ${roomId}`);
        }
      }, ROOM_EMPTY_TTL_MS);
    }

    console.log(`[rooms] Participant ${participant.displayName} (${uuid}) left room ${roomId}`);
    return participant;
  }

  /**
   * Get all participants in a room.
   */
  getParticipants(roomId: string): Participant[] {
    const room = rooms.get(roomId);
    if (!room) return [];
    return Array.from(room.participants.values());
  }

  /**
   * Get a participant by UUID.
   */
  getParticipant(roomId: string, uuid: string): Participant | undefined {
    return rooms.get(roomId)?.participants.get(uuid);
  }

  /**
   * Destroy a room entirely.
   */
  destroyRoom(roomId: string): boolean {
    return rooms.delete(roomId);
  }

  /**
   * Promote the longest-present participant to host. Returns their UUID and a new host token, or null if no one remains.
   */
  promoteNextHost(roomId: string): { newHostId: string; newHostToken: string } | null {
    const room = rooms.get(roomId);
    if (!room || room.participants.size === 0) return null;

    // Sort by join time ascending
    const sorted = Array.from(room.participants.values()).sort((a, b) => a.joinedAt - b.joinedAt);
    const newHost = sorted[0]!;
    newHost.isHost = true;
    room.hostId = newHost.uuid;

    const newHostToken = generateToken();
    console.log(`[rooms] Host migrated to ${newHost.displayName} (${newHost.uuid}) in room ${roomId}`);
    return { newHostId: newHost.uuid, newHostToken };
  }

  /**
   * Start screen sharing for a participant. Sets the participant's isSharingScreen
   * flag and the room's currentScreenSharerId. Returns an error string if another
   * participant is already sharing.
   */
  startScreenShare(roomId: string, uuid: string): { ok: true } | { ok: false; error: string } {
    const room = rooms.get(roomId);
    if (!room) return { ok: false, error: 'Room not found' };

    // Check if screen sharing is allowed by host
    if (!room.screenShareAllowed) {
      return { ok: false, error: 'Screen sharing is disabled by the host' };
    }

    // Check if someone else is already sharing
    if (room.currentScreenSharerId && room.currentScreenSharerId !== uuid) {
      const currentSharer = room.participants.get(room.currentScreenSharerId);
      return {
        ok: false,
        error: `Screen sharing is already in progress by ${currentSharer?.displayName ?? 'another participant'}`,
      };
    }

    const participant = room.participants.get(uuid);
    if (!participant) return { ok: false, error: 'Participant not found' };

    participant.isSharingScreen = true;
    room.currentScreenSharerId = uuid;
    return { ok: true };
  }

  /**
   * Stop screen sharing for a participant.
   */
  stopScreenShare(roomId: string, uuid: string): boolean {
    const room = rooms.get(roomId);
    if (!room) return false;

    const participant = room.participants.get(uuid);
    if (!participant) return false;

    participant.isSharingScreen = false;
    if (room.currentScreenSharerId === uuid) {
      room.currentScreenSharerId = null;
    }
    return true;
  }

  /**
   * Check if a room exists and is joinable, including waiting room check.
   * If waitingRoom is enabled, the room is considered joinable (into waiting).
   */
  canJoinOrWait(roomId: string): { ok: boolean; error?: string; needsPassword?: boolean; hasWaitingRoom?: boolean } {
    const room = rooms.get(roomId);
    if (!room) {
      return { ok: false, error: 'Room not found' };
    }

    const roomAny = room as any;
    const needsPassword = !!roomAny.password;
    const waitingEnabled = !!roomAny.waitingRoom;

    // If waiting room is enabled, capacity check is against total (participants + waiting)
    const totalCapacity = CAPACITY[room.mediaMode] + (roomAny.waitingRoom ? 20 : 0); // Allow extra queue spots
    const totalInRoom = room.participants.size + (roomAny.pendingParticipants?.size ?? 0);

    if (totalInRoom >= totalCapacity) {
      return { ok: false, error: 'Room is full' };
    }

    // If waiting room is enabled, lock only prevents direct join (waiting still works while locked)
    if (room.locked && !waitingEnabled) {
      return { ok: false, error: 'Room is locked' };
    }

    // Check direct participant capacity separately
    if (room.locked) {
      // Room is locked but waiting room is enabled — OK to wait
    }

    if (!room.locked && room.participants.size >= CAPACITY[room.mediaMode] && !waitingEnabled) {
      return { ok: false, error: 'Room is full' };
    }

    return { ok: true, needsPassword, hasWaitingRoom: waitingEnabled };
  }

  /**
   * Set whether screen sharing is allowed in the room.
   */
  setScreenShareAllowed(roomId: string, allowed: boolean): boolean {
    const room = rooms.get(roomId);
    if (!room) return false;
    room.screenShareAllowed = allowed;
    return true;
  }

  /**
   * Set whether chat is enabled in the room.
   */
  setChatEnabled(roomId: string, enabled: boolean): boolean {
    const room = rooms.get(roomId);
    if (!room) return false;
    room.chatEnabled = enabled;
    return true;
  }

  /**
   * Set whether the room is locked (rejects new joins).
   */
  setLocked(roomId: string, locked: boolean): boolean {
    const room = rooms.get(roomId);
    if (!room) return false;
    room.locked = locked;
    return true;
  }

  /**
   * Validate a host's token for a given room.
   * Called for all host actions. Actual token validation happens in
   * signaling.ts with the hostTokens map.
   */
  validateHostAction(roomId: string, hostId: string): boolean {
    const room = rooms.get(roomId);
    if (!room) return false;
    return room.hostId === hostId;
  }

  /**
   * Validate a host's token for a given room.
   */
  validateHostToken(roomId: string, hostId: string, _hostToken: string): boolean {
    const room = rooms.get(roomId);
    if (!room) return false;
    if (room.hostId !== hostId) return false;
    return true;
  }
}
