// ============================================================
// Jehydro Meet — Shared Types & Socket Event Constants
// This is the single source of truth for all interfaces and
// event names shared between frontend and backend.
// ============================================================

// -----------------------------------------------------------
// Media mode
// -----------------------------------------------------------
export type MediaMode = 'mesh' | 'sfu';

// -----------------------------------------------------------
// Participant
// -----------------------------------------------------------
export interface Participant {
  uuid: string;
  displayName: string;
  joinedAt: number; // Unix ms timestamp
  micEnabled: boolean;
  cameraEnabled: boolean;
  isSharingScreen: boolean;
  isHost: boolean;
  connectionState: 'connected' | 'disconnected' | 'reconnecting';
}

// -----------------------------------------------------------
// Room (server-side in-memory state)
// Note: `participants` uses Map internally on the server.
// When sending over Socket.IO, convert to Participant[] via RoomManager.getParticipants().
// -----------------------------------------------------------
export interface Room {
  roomId: string;
  mediaMode: MediaMode;
  hostId: string;
  participants: Map<string, Participant>;
  locked: boolean;
  chatEnabled: boolean;
  screenShareAllowed: boolean;
  currentScreenSharerId: string | null;
  createdAt: number; // Unix ms timestamp
}

// -----------------------------------------------------------
// Chat message
// -----------------------------------------------------------
export interface ChatMessage {
  id: string;
  senderUuid: string;
  senderName: string;
  text: string;
  timestamp: number; // Unix ms timestamp
}

// -----------------------------------------------------------
// WebRTC signaling messages (relayed through server)
// -----------------------------------------------------------
export type SignalType = 'offer' | 'answer' | 'ice-candidate';

export interface SignalMessage {
  type: SignalType;
  from: string; // sender UUID
  to: string; // recipient UUID
  payload: unknown; // RTCSessionDescription or RTCIceCandidateInit
}

// -----------------------------------------------------------
// Join options
// -----------------------------------------------------------
export interface JoinOptions {
  roomId: string;
  displayName: string;
  micEnabled: boolean;
  cameraEnabled: boolean;
}

// -----------------------------------------------------------
// Background effects (Phase 13)
// -----------------------------------------------------------
export type BackgroundEffect = 'none' | 'blur' | 'image';

export const BACKGROUND_IMAGE_PRESETS = [
  { id: 'meadow', name: 'Meadow', url: '/bg/meadow.jpg' },
  { id: 'office', name: 'Office', url: '/bg/office.jpg' },
  { id: 'abstract', name: 'Abstract', url: '/bg/abstract.jpg' },
  { id: 'beach', name: 'Beach', url: '/bg/beach.jpg' },
] as const;

export type BackgroundImagePresetId = (typeof BACKGROUND_IMAGE_PRESETS)[number]['id'];

// -----------------------------------------------------------
// MediaTransport interface (frontend-only contract)
// -----------------------------------------------------------
export type TransportEvent =
  | 'track-added'
  | 'track-removed'
  | 'peer-joined'
  | 'peer-left'
  | 'speaking-changed'
  | 'connection-state';

export interface MediaTransport {
  join(opts: JoinOptions): Promise<void>;
  leave(): Promise<void>;
  setMicEnabled(on: boolean): Promise<void>;
  setCameraEnabled(on: boolean): Promise<void>;
  startScreenShare(): Promise<void>;
  stopScreenShare(): Promise<void>;
  switchCamera(): Promise<void>;
  on(event: TransportEvent, handler: (...args: any[]) => void): void;
  off(event: TransportEvent, handler: (...args: any[]) => void): void;
  setBackgroundEffect(effect: BackgroundEffect, imageId?: BackgroundImagePresetId): Promise<void>;
}

// -----------------------------------------------------------
// Socket.IO event names (namespaced string constants)
// -----------------------------------------------------------
export const SocketEvents = {
  // Room lifecycle
  ROOM_CREATE: 'room:create',
  ROOM_CREATED: 'room:created',
  ROOM_JOIN: 'room:join',
  ROOM_JOINED: 'room:joined',
  ROOM_LEAVE: 'room:leave',
  ROOM_LEFT: 'room:left',
  ROOM_LOCK: 'room:lock',
  ROOM_LOCKED: 'room:locked',
  ROOM_UNLOCKED: 'room:unlocked',
  ROOM_END: 'room:end',
  ROOM_ENDED: 'room:ended',
  ROOM_ERROR: 'room:error',
  ROOM_NOT_FOUND: 'room:not-found',
  ROOM_FULL: 'room:full',

  // Participant events
  PARTICIPANT_JOINED: 'participant:joined',
  PARTICIPANT_LEFT: 'participant:left',
  PARTICIPANT_UPDATED: 'participant:updated',
  PARTICIPANT_REMOVED: 'participant:removed',

  // WebRTC signaling
  SIGNAL_OFFER: 'signal:offer',
  SIGNAL_ANSWER: 'signal:answer',
  SIGNAL_ICE: 'signal:ice',

  // Chat
  CHAT_MESSAGE: 'chat:message',
  CHAT_DISABLED: 'chat:disabled',
  CHAT_ENABLED: 'chat:enabled',

  // Host actions
  HOST_MUTE: 'host:mute',
  HOST_MUTE_ALL: 'host:mute-all',
  HOST_REMOVE: 'host:remove',
  HOST_LOCK: 'host:lock',
  HOST_UNLOCK: 'host:unlock',
  HOST_END: 'host:end',
  HOST_MIGRATED: 'host:migrated',

  // Screen share
  SCREEN_SHARE_START: 'screen-share:start',
  SCREEN_SHARE_STARTED: 'screen-share:started',
  SCREEN_SHARE_STOP: 'screen-share:stop',
  SCREEN_SHARE_STOPPED: 'screen-share:stopped',
  SCREEN_SHARE_BLOCKED: 'screen-share:blocked',

  // Speaking
  SPEAKING_STARTED: 'speaking:started',
  SPEAKING_STOPPED: 'speaking:stopped',

  // TURN credentials
  TURN_CREDENTIALS: 'turn:credentials',
  TURN_CREDENTIALS_RESPONSE: 'turn:credentials:response',

  // Recording
  RECORDING_START: 'recording:start',
  RECORDING_STOP: 'recording:stop',
  RECORDING_STARTED: 'recording:started',
  RECORDING_STOPPED: 'recording:stopped',
  RECORDING_ERROR: 'recording:error',
  RECORDING_COMPLETED: 'recording:completed',
  RECORDING_STATUS: 'recording:status',

  // Waiting room & password
  WAITING_PARTICIPANT_ADDED: 'waiting:participant-added',
  WAITING_PARTICIPANT_REMOVED: 'waiting:participant-removed',
  WAITING_PARTICIPANTS_LIST: 'waiting:participants-list',
  WAITING_ADMIT: 'waiting:admit',
  WAITING_ADMIT_ALL: 'waiting:admit-all',
  WAITING_DENY: 'waiting:deny',
  WAITING_DENY_ALL: 'waiting:deny-all',
  WAITING_ADMITTED: 'waiting:admitted',
  WAITING_REJECTED: 'waiting:rejected',
  PASSWORD_REQUIRED: 'room:password-required',
  PASSWORD_INCORRECT: 'room:password-incorrect',

  // Whiteboard (Phase 14)
  WHITEBOARD_UPDATE: 'whiteboard:update',
  WHITEBOARD_CLEAR: 'whiteboard:clear',
  WHITEBOARD_LOCK: 'whiteboard:lock',
  WHITEBOARD_STATE: 'whiteboard:state',

  // Polls (Phase 14)
  POLL_CREATE: 'poll:create',
  POLL_CREATED: 'poll:created',
  POLL_VOTE: 'poll:vote',
  POLL_VOTED: 'poll:voted',
  POLL_CLOSE: 'poll:close',
  POLL_CLOSED: 'poll:closed',
  POLL_STATE: 'poll:state',

  // Breakout Rooms (Phase 14)
  BREAKOUT_CREATE: 'breakout:create',
  BREAKOUT_CREATED: 'breakout:created',
  BREAKOUT_ASSIGN: 'breakout:assign',
  BREAKOUT_ASSIGNED: 'breakout:assigned',
  BREAKOUT_AUTO_SPLIT: 'breakout:auto-split',
  BREAKOUT_CLOSE: 'breakout:close',
  BREAKOUT_CLOSED: 'breakout:closed',
  BREAKOUT_BROADCAST: 'breakout:broadcast',
  BREAKOUT_BROADCASTED: 'breakout:broadcasted',
  BREAKOUT_STATE: 'breakout:state',
  BREAKOUT_JOIN: 'breakout:join',
  BREAKOUT_LEAVE: 'breakout:leave',
} as const;

export type SocketEventName = (typeof SocketEvents)[keyof typeof SocketEvents];

// -----------------------------------------------------------
// Socket event payload types
// -----------------------------------------------------------
/** A minimal poll spec for pre-creating polls before the meeting starts */
export interface PrePollCreate {
  question: string;
  options: string[];
}

export interface RoomCreatePayload {
  mediaMode: MediaMode;
  displayName: string;
  micEnabled: boolean;
  cameraEnabled: boolean;
  password?: string;
  waitingRoom?: boolean;
  prePolls?: PrePollCreate[];
}

export interface RoomCreatedPayload {
  roomId: string;
  hostId: string;
  hostToken: string;
  mediaMode: MediaMode;
}

export interface RoomJoinPayload {
  roomId: string;
  displayName: string;
  micEnabled: boolean;
  cameraEnabled: boolean;
  password?: string;
}

export interface RoomJoinedPayload {
  roomId: string;
  participants: Participant[];
  hostId: string;
  mediaMode: MediaMode;
  yourUuid: string;
  yourToken?: string; // host token if you're the host
  locked: boolean;
  chatEnabled: boolean;
  screenShareAllowed: boolean;
  // LiveKit SFU fields (only present when mediaMode === 'sfu')
  livekitUrl?: string;
  livekitToken?: string;
}

export interface ParticipantJoinedPayload {
  participant: Participant;
}

export interface ParticipantLeftPayload {
  uuid: string;
}

export interface ChatMessagePayload {
  message: ChatMessage;
}

export interface HostMutePayload {
  targetUuid: string;
}

export interface HostRemovePayload {
  targetUuid: string;
}

export interface HostMigratedPayload {
  newHostId: string;
  newHostToken?: string;
}

export interface ScreenShareStartPayload {
  uuid: string;
}

export interface ScreenShareStartedPayload {
  uuid: string;
}

export interface ScreenShareStoppedPayload {
  uuid: string;
}

export interface ScreenShareBlockedPayload {
  reason: string;
}

export interface RoomErrorPayload {
  code: string;
  message: string;
}

// -----------------------------------------------------------
// Waiting room types
// -----------------------------------------------------------
export interface WaitingParticipant {
  uuid: string;
  displayName: string;
  joinedAt: number;
}

export interface WaitingParticipantAddedPayload {
  participant: WaitingParticipant;
}

export interface WaitingParticipantRemovedPayload {
  uuid: string;
}

export interface WaitingParticipantsListPayload {
  participants: WaitingParticipant[];
}

export interface WaitingAdmitPayload {
  targetUuid: string;
}

export interface WaitingDenyPayload {
  targetUuid: string;
}

export interface WaitingAdmitAllPayload {
  // No additional fields needed — admits all pending
}

export interface WaitingDenyAllPayload {
  // No additional fields needed — denies all pending
}

export interface WaitingAdmittedPayload {
  roomId: string;
}

export interface WaitingRejectedPayload {
  reason: string;
}

export interface PasswordRequiredPayload {
  roomId: string;
}

export interface PasswordIncorrectPayload {
  roomId: string;
  attemptsRemaining: number;
  locked?: boolean;
}

// -----------------------------------------------------------
// Whiteboard types (Phase 14)
// -----------------------------------------------------------
export interface WhiteboardStroke {
  id: string;
  senderUuid: string;
  /** SVG path data or array of {x,y} points */
  points: { x: number; y: number }[];
  color: string;
  width: number;
  timestamp: number;
}

export interface WhiteboardClearPayload {
  roomId: string;
  clearedBy: string;
}

export interface WhiteboardLockPayload {
  roomId: string;
  locked: boolean;
}

export type WhiteboardUpdate = {
  type: 'stroke';
  stroke: WhiteboardStroke;
} | {
  type: 'clear';
  clearedBy: string;
} | {
  type: 'lock';
  locked: boolean;
};

// -----------------------------------------------------------
// Poll types (Phase 14)
// -----------------------------------------------------------
export interface PollOption {
  id: string;
  text: string;
  votes: string[]; // UUIDs of voters
}

export interface Poll {
  id: string;
  createdBy: string;
  question: string;
  options: PollOption[];
  createdAt: number;
  closedAt?: number;
  status: 'active' | 'closed';
}

export interface PollCreatePayload {
  question: string;
  options: string[]; // option text strings
}

export interface PollCreatedPayload {
  poll: Poll;
}

export interface PollVotePayload {
  pollId: string;
  optionId: string;
}

export interface PollVotedPayload {
  poll: Poll;
}

export interface PollClosePayload {
  pollId: string;
}

export interface PollClosedPayload {
  poll: Poll;
}

export interface PollStatePayload {
  polls: Poll[];
}

// -----------------------------------------------------------
// Breakout Room types (Phase 14)
// -----------------------------------------------------------
export interface BreakoutRoom {
  id: string;
  name: string;
  participantUuids: string[];
}

export interface BreakoutRoomsState {
  isActive: boolean;
  rooms: BreakoutRoom[];
  /** participantUuid -> breakoutRoomId */
  assignments: Record<string, string>;
}

export interface BreakoutCreatePayload {
  roomCount: number; // 2-8 rooms
}

export interface BreakoutAssignPayload {
  participantUuid: string;
  roomId: string;
}

export interface BreakoutBroadcastPayload {
  message: string;
}

export interface BreakoutJoinPayload {
  roomId: string;
}

export interface BreakoutCreatedPayload {
  state: BreakoutRoomsState;
}

export interface BreakoutAssignedPayload {
  state: BreakoutRoomsState;
}

export interface BreakoutClosedPayload {
  roomId: string; // main room ID (for client to clear state)
}

export interface BreakoutBroadcastedPayload {
  senderName: string;
  message: string;
}

export interface BreakoutStatePayload {
  state: BreakoutRoomsState | null;
}

// -----------------------------------------------------------
// Recording types
// -----------------------------------------------------------
export interface Recording {
  id: string;
  roomId: string;
  startedAt: number;
  stoppedAt?: number;
  durationMs?: number;
  filePath?: string;
  fileSize?: number;
  status: 'recording' | 'completed' | 'failed';
}

export interface RecordingStartedPayload {
  roomId: string;
  recording: Recording;
}

export interface RecordingStoppedPayload {
  roomId: string;
  recording: Recording;
}

export interface RecordingCompletedPayload {
  roomId: string;
  recording: Recording;
}

export interface RecordingErrorPayload {
  roomId: string;
  error: string;
}

export interface RecordingStatusPayload {
  roomId: string;
  isRecording: boolean;
  recording?: Recording;
}
