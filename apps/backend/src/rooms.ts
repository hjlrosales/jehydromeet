import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import type {
  BreakoutRoom,
  BreakoutRoomsState,
  MediaMode,
  Participant,
  Poll,
  Recording,
  Room as RoomState,
  WaitingParticipant,
} from '@jehydro/shared-types';

// -----------------------------------------------------------
// In-memory room store
// -----------------------------------------------------------
type ExtendedRoomState = RoomState & {
  password?: string;
  waitingRoom: boolean;
  pendingParticipants: Map<string, WaitingParticipant>;
  isRecording: boolean;
  recordingEgressId: string | null;
  recordingStartedAt: number | null;
  recordings: Recording[];
  polls: Poll[];
  breakoutActive: boolean;
  breakoutRooms: BreakoutRoom[];
  breakoutAssignments: Record<string, string>;
};

const rooms = new Map<string, ExtendedRoomState>();

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

    const room: ExtendedRoomState = {
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
      isRecording: false,
      recordingEgressId: null,
      recordingStartedAt: null,
      recordings: [],
      polls: [],
      breakoutActive: false,
      breakoutRooms: [],
      breakoutAssignments: {},
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

    if (password !== undefined) {
      room.password = password ? crypto.createHash('sha256').update(password).digest('hex') : undefined;
    }
    if (waitingRoom !== undefined) {
      room.waitingRoom = waitingRoom;
    }
    return true;
  }

  /**
   * Check if a room has a password set.
   */
  hasPassword(roomId: string): boolean {
    const room = rooms.get(roomId);
    return !!room?.password;
  }

  /**
   * Verify the meeting password.
   */
  verifyPassword(roomId: string, password: string): boolean {
    const room = rooms.get(roomId);
    if (!room?.password) return true; // No password set
    const hash = crypto.createHash('sha256').update(password).digest('hex');
    return room.password === hash;
  }

  /**
   * Check if waiting room is enabled.
   */
  hasWaitingRoom(roomId: string): boolean {
    const room = rooms.get(roomId);
    return !!room?.waitingRoom;
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

    room.pendingParticipants.set(uuid, pending);
    console.log(`[rooms] ${displayName} (${uuid}) is waiting to join room ${roomId}`);
    return pending;
  }

  /**
   * Remove a participant from the waiting room.
   */
  removePendingParticipant(roomId: string, uuid: string): WaitingParticipant | null {
    const room = rooms.get(roomId);
    if (!room) return null;

    const pending = room.pendingParticipants.get(uuid);
    if (!pending) return null;

    room.pendingParticipants.delete(uuid);
    return pending;
  }

  /**
   * Get all waiting participants.
   */
  getPendingParticipants(roomId: string): WaitingParticipant[] {
    const room = rooms.get(roomId);
    if (!room) return [];
    return Array.from(room.pendingParticipants.values());
  }

  /**
   * Admit a waiting participant into the meeting.
   */
  admitPendingParticipant(roomId: string, pendingUuid: string): { participant: Participant } | null {
    const room = rooms.get(roomId);
    if (!room) return null;

    const pending = room.pendingParticipants.get(pendingUuid);
    if (!pending) return null;

    // Remove from pending
    room.pendingParticipants.delete(pendingUuid);

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
   * Create a poll in a room (host only).
   */
  createPoll(roomId: string, createdBy: string, question: string, optionsText: string[]): Poll | null {
    const room = rooms.get(roomId);
    if (!room) return null;

    const poll: Poll = {
      id: uuidv4(),
      createdBy,
      question,
      options: optionsText.map((text) => ({
        id: uuidv4(),
        text,
        votes: [],
      })),
      createdAt: Date.now(),
      status: 'active',
    };

    room.polls.push(poll);
    return poll;
  }

  /**
   * Vote on a poll option.
   */
  votePoll(roomId: string, pollId: string, optionId: string, voterUuid: string): Poll | null {
    const room = rooms.get(roomId);
    if (!room) return null;
    const poll = room.polls.find((p) => p.id === pollId);
    if (!poll || poll.status === 'closed') return null;

    // Remove previous vote from this voter if any
    for (const opt of poll.options) {
      opt.votes = opt.votes.filter((v) => v !== voterUuid);
    }

    // Add vote to the selected option
    const option = poll.options.find((o) => o.id === optionId);
    if (!option) return null;
    option.votes.push(voterUuid);

    return poll;
  }

  /**
   * Close a poll.
   */
  closePoll(roomId: string, pollId: string): Poll | null {
    const room = rooms.get(roomId);
    if (!room) return null;
    const poll = room.polls.find((p) => p.id === pollId);
    if (!poll || poll.status === 'closed') return null;

    poll.status = 'closed';
    poll.closedAt = Date.now();
    return poll;
  }

  /**
   * Get all polls in a room.
   */
  getPolls(roomId: string): Poll[] {
    const room = rooms.get(roomId);
    if (!room) return [];
    return room.polls;
  }

  /**
   * Admit ALL waiting participants into the meeting.
   * Returns an array of successfully admitted participants.
   * Respects room capacity: admits only up to the remaining capacity.
   * Overflow participants remain in the pending queue.
   */
  admitAllPendingParticipants(roomId: string): { participants: Participant[] } {
    const room = rooms.get(roomId);
    if (!room) return { participants: [] };

    if (room.pendingParticipants.size === 0) {
      return { participants: [] };
    }

    const capacity = CAPACITY[room.mediaMode];
    const remainingCapacity = capacity - room.participants.size;
    if (remainingCapacity <= 0) {
      // No room at all — keep all pending and return empty
      return { participants: [] };
    }

    const admitted: Participant[] = [];
    const pendings = Array.from(room.pendingParticipants.values());

    for (const pending of pendings) {
      // If we've reached capacity, stop admitting; remaining stay in waiting
      if (admitted.length >= remainingCapacity) break;

      room.pendingParticipants.delete(pending.uuid);

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
      admitted.push(participant);

      console.log(`[rooms] ${participant.displayName} (${participant.uuid}) admitted to room ${roomId} (bulk)`);
    }

    return { participants: admitted };
  }

  /**
   * Deny (remove) ALL waiting participants from the waiting room.
   * Returns an array of removed pending participants for cleanup.
   */
  denyAllPendingParticipants(roomId: string): { denied: WaitingParticipant[] } {
    const room = rooms.get(roomId);
    if (!room) return { denied: [] };

    if (room.pendingParticipants.size === 0) {
      return { denied: [] };
    }

    const denied = Array.from(room.pendingParticipants.values());
    room.pendingParticipants.clear();

    console.log(`[rooms] Denied ${denied.length} waiting participant(s) from room ${roomId} (bulk)`);
    return { denied };
  }

  /**
   * Get room by ID. Returns undefined if not found.
   */
  getRoom(roomId: string): ExtendedRoomState | undefined {
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

    const needsPassword = !!room.password;
    const waitingEnabled = room.waitingRoom;

    // If waiting room is enabled, capacity check is against total (participants + waiting)
    const totalCapacity = CAPACITY[room.mediaMode] + (room.waitingRoom ? 20 : 0); // Allow extra queue spots
    const totalInRoom = room.participants.size + room.pendingParticipants.size;

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

  // -----------------------------------------------------------
  // Recording state
  // -----------------------------------------------------------

  /**
   * Set the recording state for a room.
   */
  setRecordingState(roomId: string, isRecording: boolean, egressId?: string): boolean {
    const room = rooms.get(roomId);
    if (!room) return false;
    room.isRecording = isRecording;
    if (isRecording && egressId) {
      room.recordingEgressId = egressId;
      room.recordingStartedAt = Date.now();
    }
    if (!isRecording) {
      room.recordingEgressId = null;
    }
    return true;
  }

  /**
   * Check if a room is currently recording.
   */
  isRecording(roomId: string): boolean {
    const room = rooms.get(roomId);
    return !!room?.isRecording;
  }

  /**
   * Add a completed recording to the room's recording history.
   */
  addRecording(roomId: string, recording: Recording): boolean {
    const room = rooms.get(roomId);
    if (!room) return false;
    room.recordings.push(recording);
    return true;
  }

  /**
   * Get all recordings for a room.
   */
  getRecordings(roomId: string): Recording[] {
    const room = rooms.get(roomId);
    if (!room) return [];
    return room.recordings;
  }

  /**
   * Get the current recording egress ID for a room.
   */
  getRecordingEgressId(roomId: string): string | null {
    const room = rooms.get(roomId);
    return room?.recordingEgressId ?? null;
  }

  /**
   * Get the LiveKit room name for a given room ID.
   * In our system, the room ID IS the LiveKit room name.
   */
  getLiveKitRoomName(roomId: string): string | null {
    const room = rooms.get(roomId);
    if (!room) return null;
    return room.roomId;
  }

  /**
   * Check if recording is available (only SFU rooms can record).
   */
  canRecord(roomId: string): boolean {
    const room = rooms.get(roomId);
    if (!room) return false;
    return room.mediaMode === 'sfu';
  }

  // -----------------------------------------------------------
  // Breakout Rooms
  // -----------------------------------------------------------

  /**
   * Create N breakout rooms and auto-assign participants evenly.
   * Only the host can trigger this.
   * Returns the new breakout state, or null if breakouts are already active.
   */
  createBreakoutRooms(roomId: string, roomCount: number): {
    state: BreakoutRoomsState;
  } | null {
    const room = rooms.get(roomId);
    if (!room) return null;

    // Clamp room count
    const count = Math.max(2, Math.min(8, roomCount));

    // Check if breakouts are already active
    if (room.breakoutActive) return null;

    // Get all non-host participants
    const participants = Array.from(room.participants.values()).filter((p) => !p.isHost);

    if (participants.length === 0) {
      // No participants to assign, but still create empty rooms (host can assign manually)
    }

    // Create breakout rooms with auto-generated names
    const breakoutRooms: BreakoutRoom[] = [];
    for (let i = 0; i < count; i++) {
      breakoutRooms.push({
        id: `breakout-${i + 1}`,
        name: `Room ${i + 1}`,
        participantUuids: [],
      });
    }

    // Auto-split participants evenly across rooms
    const assignments: Record<string, string> = {};
    for (let i = 0; i < participants.length; i++) {
      const roomIdx = i % count;
      const breakoutId = breakoutRooms[roomIdx]!.id;
      breakoutRooms[roomIdx]!.participantUuids.push(participants[i]!.uuid);
      assignments[participants[i]!.uuid] = breakoutId;
    }

    // Store state on the room
    room.breakoutActive = true;
    room.breakoutRooms = breakoutRooms;
    room.breakoutAssignments = assignments;

    console.log(`[rooms] Created ${count} breakout rooms in room ${roomId}`);

    return {
      state: {
        isActive: true,
        rooms: breakoutRooms,
        assignments,
      },
    };
  }

  /**
   * Assign a participant to a breakout room.
   */
  assignToBreakout(roomId: string, participantUuid: string, breakoutRoomId: string): boolean {
    const room = rooms.get(roomId);
    if (!room) return false;

    if (!room.breakoutActive) return false;

    const participant = room.participants.get(participantUuid);
    if (!participant || participant.isHost) return false;

    // Find the breakout room
    const breakout = room.breakoutRooms.find((br) => br.id === breakoutRoomId);
    if (!breakout) return false;

    // Remove from any current breakout
    const currentRoomId = room.breakoutAssignments[participantUuid];
    if (currentRoomId) {
      const currentRoom = room.breakoutRooms.find((br) => br.id === currentRoomId);
      if (currentRoom) {
        currentRoom.participantUuids = currentRoom.participantUuids.filter((u: string) => u !== participantUuid);
      }
    }

    // Add to new breakout
    if (!breakout.participantUuids.includes(participantUuid)) {
      breakout.participantUuids.push(participantUuid);
    }
    room.breakoutAssignments[participantUuid] = breakoutRoomId;

    return true;
  }

  /**
   * Get the current breakout state for a room.
   */
  getBreakoutState(roomId: string): BreakoutRoomsState | null {
    const room = rooms.get(roomId);
    if (!room) return null;

    if (!room.breakoutActive) {
      return { isActive: false, rooms: [], assignments: {} };
    }

    return {
      isActive: true,
      rooms: room.breakoutRooms,
      assignments: room.breakoutAssignments,
    };
  }

  /**
   * Close all breakout rooms and return participants to the main room.
   */
  closeBreakoutRooms(roomId: string): boolean {
    const room = rooms.get(roomId);
    if (!room) return false;

    if (!room.breakoutActive) return false;

    room.breakoutActive = false;
    room.breakoutRooms = [];
    room.breakoutAssignments = {};

    console.log(`[rooms] Closed breakout rooms in room ${roomId}`);
    return true;
  }

  /**
   * Get the breakout room ID for a participant (or null if not in a breakout).
   */
  getParticipantBreakoutRoom(roomId: string, participantUuid: string): string | null {
    const room = rooms.get(roomId);
    if (!room) return null;

    if (!room.breakoutActive) return null;

    return room.breakoutAssignments[participantUuid] ?? null;
  }
}
