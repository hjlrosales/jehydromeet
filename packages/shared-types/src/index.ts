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
} as const;

export type SocketEventName = (typeof SocketEvents)[keyof typeof SocketEvents];

// -----------------------------------------------------------
// Socket event payload types
// -----------------------------------------------------------
export interface RoomCreatePayload {
  mediaMode: MediaMode;
  displayName: string;
  micEnabled: boolean;
  cameraEnabled: boolean;
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
