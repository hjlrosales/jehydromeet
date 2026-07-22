// ============================================================
// Global room state — survives client-side route changes
// Used to pass created room info from CreateMeetingForm to
// the meet room page without needing a server round-trip.
// ============================================================

import type { Participant, RoomJoinedPayload } from '@jehydro/shared-types';

interface PendingRoomState {
  roomId: string;
  yourUuid: string;
  hostId: string;
  hostToken: string;
  mediaMode: 'mesh' | 'sfu';
  participants: Participant[];
  locked: boolean;
  chatEnabled: boolean;
  screenShareAllowed: boolean;
}

let _pending: PendingRoomState | null = null;

export function setPendingRoomState(payload: RoomJoinedPayload, hostToken: string): void {
  _pending = {
    roomId: payload.roomId,
    yourUuid: payload.yourUuid,
    hostId: payload.hostId,
    hostToken,
    mediaMode: payload.mediaMode,
    participants: payload.participants,
    locked: payload.locked,
    chatEnabled: payload.chatEnabled,
    screenShareAllowed: payload.screenShareAllowed,
  };
}

export function consumePendingRoomState(): PendingRoomState | null {
  const state = _pending;
  _pending = null;
  return state;
}
