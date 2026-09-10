'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { SocketEvents } from '@jehydro/shared-types';
import type {
  BackgroundEffect,
  BackgroundImagePresetId,
  JoinOptions,
  Participant,
  ParticipantJoinedPayload,
  ParticipantLeftPayload,
  RoomJoinedPayload,
  MediaTransport,
} from '@jehydro/shared-types';
import { MeshTransport } from '@/lib/MeshTransport';
import { SfuTransport } from '@/lib/SfuTransport';

interface RemoteParticipantStream {
  uuid: string;
  displayName: string;
  stream: MediaStream;
  isHost: boolean;
  micEnabled: boolean;
  cameraEnabled: boolean;
  isSharingScreen: boolean;
  isSpeaking: boolean;
}

interface UseMediaTransportResult {
  // Local state
  localStream: MediaStream | null;
  micEnabled: boolean;
  cameraEnabled: boolean;

  // Screen sharing
  isSharingScreen: boolean;
  screenShareAllowed: boolean;

  // Remote participants and their streams
  remoteStreams: RemoteParticipantStream[];

  // Speaking state (who's talking)
  speakingUuids: Set<string>;

  // Actions
  toggleMic: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  switchCamera: () => Promise<void>;
  startScreenShare: () => Promise<void>;
  stopScreenShare: () => Promise<void>;
  setBackgroundEffect: (effect: BackgroundEffect, imageId?: BackgroundImagePresetId) => Promise<void>;
  leave: () => Promise<void>;

  // Background
  currentBackgroundEffect: BackgroundEffect;

  // All participants combined (self + remote) for the panel
  allParticipants: ParticipantBrief[];

  // Initialization
  joinMeeting: (payload: RoomJoinedPayload) => Promise<void>;
  setPendingMedia: (stream: MediaStream | null, initialMic: boolean, initialCamera: boolean) => void;
  isReady: boolean;
}

export interface ParticipantBrief {
  uuid: string;
  displayName: string;
  micEnabled: boolean;
  cameraEnabled: boolean;
  isHost: boolean;
  isSharingScreen: boolean;
  isSpeaking: boolean;
}

/**
 * Hook that creates and manages a MediaTransport instance.
 * Automatically selects MeshTransport or SfuTransport based on
 * the mediaMode in the RoomJoinedPayload.
 * Call joinMeeting() with the ROOM_JOINED payload to start media.
 */
export function useMediaTransport(socket: Socket | null): UseMediaTransportResult {
  const transportRef = useRef<MediaTransport | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);

  // Store pending pre-acquired stream + initial state from JoinPreview
  const pendingJoinState = useRef<{
    stream: MediaStream | null;
    micEnabled: boolean;
    cameraEnabled: boolean;
  } | null>(null);

  /**
   * Set the pre-acquired stream and initial mic/camera state (called before joinMeeting).
   */
  const setPendingMedia = useCallback(
    (stream: MediaStream | null, initialMic: boolean, initialCamera: boolean) => {
      pendingJoinState.current = { stream, micEnabled: initialMic, cameraEnabled: initialCamera };
      setMicEnabled(initialMic);
      setCameraEnabled(initialCamera);
      if (stream) setLocalStream(stream);
    },
    []
  );
  const [remoteStreams, setRemoteStreams] = useState<RemoteParticipantStream[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [isSharingScreen, setIsSharingScreen] = useState(false);
  const [screenShareAllowed, setScreenShareAllowed] = useState<boolean>(true);
  const [speakingUuids, setSpeakingUuids] = useState<Set<string>>(new Set());
  const [currentBackgroundEffect, setCurrentBackgroundEffect] = useState<BackgroundEffect>('none');
  const participantsRef = useRef<Map<string, Participant>>(new Map());
  const remoteStreamsRef = useRef<Map<string, RemoteParticipantStream>>(new Map());
  const speakingRef = useRef<Set<string>>(new Set());
  const myUuidRef = useRef<string>('');

  // Helper to push remote streams state to React
  const updateRemoteStreams = useCallback(() => {
    setRemoteStreams(Array.from(remoteStreamsRef.current.values()));
  }, []);

  /**
   * Set up transport event listeners for remote streams, speaking detection, etc.
   * Shared between MeshTransport and SfuTransport.
   */
  const setupTransportListeners = useCallback((transport: MediaTransport) => {
    transport.on('track-added', (remoteUuid: string, stream: unknown) => {
      if (!(stream instanceof MediaStream)) return;

      const participant = participantsRef.current.get(remoteUuid);
      if (!participant) return;

      const existing = remoteStreamsRef.current.get(remoteUuid);
      if (existing) {
        existing.stream = stream;
      } else {
        remoteStreamsRef.current.set(remoteUuid, {
          uuid: remoteUuid,
          displayName: participant.displayName,
          stream,
          isHost: participant.isHost,
          micEnabled: participant.micEnabled,
          cameraEnabled: participant.cameraEnabled,
          isSharingScreen: participant.isSharingScreen,
          isSpeaking: false,
        });
      }
      updateRemoteStreams();
    });

    transport.on('peer-left', (remoteUuid: string) => {
      remoteStreamsRef.current.delete(remoteUuid);
      participantsRef.current.delete(remoteUuid);
      updateRemoteStreams();
    });

    transport.on('speaking-changed', (remoteUuid: string, speaking: boolean) => {
      const updated = new Set(speakingRef.current);
      if (speaking) {
        updated.add(remoteUuid);
      } else {
        updated.delete(remoteUuid);
      }
      speakingRef.current = updated;
      setSpeakingUuids(new Set(updated));

      const entry = remoteStreamsRef.current.get(remoteUuid);
      if (entry) {
        entry.isSpeaking = speaking;
        updateRemoteStreams();
      }
    });

    transport.on('connection-state', (_uuid: string, _state: string) => {
      // Could update connection status in the UI
    });
  }, [updateRemoteStreams]);

  /**
   * Create a MeshTransport and set up its event listeners.
   * Only used when mediaMode === 'mesh'.
   */
  const createMeshTransport = useCallback(() => {
    if (!socket) return null;

    const transport = new MeshTransport(socket);
    setupTransportListeners(transport);
    return transport;
  }, [socket, setupTransportListeners]);

  // Set up socket-level listeners (shared between mesh and SFU)
  useEffect(() => {
    if (!socket) return;

    // Listen for participant updates (mic/cam state changes)
    socket.on(SocketEvents.PARTICIPANT_UPDATED, (payload: { uuid: string; micEnabled?: boolean; cameraEnabled?: boolean }) => {
      const p = participantsRef.current.get(payload.uuid);
      if (!p) return;

      if (payload.micEnabled !== undefined) p.micEnabled = payload.micEnabled;
      if (payload.cameraEnabled !== undefined) p.cameraEnabled = payload.cameraEnabled;

      const entry = remoteStreamsRef.current.get(payload.uuid);
      if (entry) {
        if (payload.micEnabled !== undefined) entry.micEnabled = payload.micEnabled;
        if (payload.cameraEnabled !== undefined) entry.cameraEnabled = payload.cameraEnabled;
        updateRemoteStreams();
      }
    });

    // Listen for host migration to update isHost flags
    socket.on(SocketEvents.HOST_MIGRATED, (payload: { newHostId: string }) => {
      for (const [uuid, p] of participantsRef.current) {
        p.isHost = uuid === payload.newHostId;
      }
      for (const [uuid, entry] of remoteStreamsRef.current) {
        entry.isHost = uuid === payload.newHostId;
      }
      updateRemoteStreams();
    });

    // Listen for screen share events
    socket.on(SocketEvents.SCREEN_SHARE_STARTED, (payload: { uuid: string }) => {
      const entry = remoteStreamsRef.current.get(payload.uuid);
      if (entry) {
        entry.isSharingScreen = true;
        updateRemoteStreams();
      }
      const p = participantsRef.current.get(payload.uuid);
      if (p) p.isSharingScreen = true;
    });

    socket.on(SocketEvents.SCREEN_SHARE_STOPPED, (payload: { uuid: string }) => {
      if (payload.uuid === myUuidRef.current) return;
      const entry = remoteStreamsRef.current.get(payload.uuid);
      if (entry) {
        entry.isSharingScreen = false;
        updateRemoteStreams();
      }
      const p = participantsRef.current.get(payload.uuid);
      if (p) p.isSharingScreen = false;
    });

    return () => {
      socket.off(SocketEvents.PARTICIPANT_UPDATED);
      socket.off(SocketEvents.HOST_MIGRATED);
      socket.off(SocketEvents.SCREEN_SHARE_STARTED);
      socket.off(SocketEvents.SCREEN_SHARE_STOPPED);
    };
  }, [socket, updateRemoteStreams]);

  const joinMeeting = useCallback(
    async (payload: RoomJoinedPayload) => {
      if (!socket) return;

      // Consume pending join state (pre-acquired stream from JoinPreview if any)
      const pending = pendingJoinState.current;
      pendingJoinState.current = null;
      const initialMic = pending?.micEnabled ?? true;
      const initialCamera = pending?.cameraEnabled ?? true;

      // Store participants
      for (const p of payload.participants) {
        participantsRef.current.set(p.uuid, p);
      }

      myUuidRef.current = payload.yourUuid;
      setScreenShareAllowed(payload.screenShareAllowed);

      // Create the appropriate transport based on media mode
      let transport: MediaTransport;
      if (payload.mediaMode === 'sfu') {
        // SFU mode: connect to LiveKit server
        if (!payload.livekitUrl || !payload.livekitToken) {
          console.error('[useMediaTransport] SFU mode selected but no LiveKit URL/token provided');
          return;
        }
        const sfuTransport = new SfuTransport(payload.livekitUrl, payload.livekitToken);
        setupTransportListeners(sfuTransport);
        transport = sfuTransport;
      } else {
        // Mesh mode: use Socket.IO signaling
        transport = createMeshTransport() as MediaTransport;
      }

      transportRef.current = transport;

      // Set UUID on transport (MeshTransport needs it)
      if (transport instanceof MeshTransport) {
        transport.setUuid(payload.yourUuid);
      }

      // Join via transport
      await transport.join({
        roomId: payload.roomId,
        displayName: payload.participants.find((p) => p.uuid === payload.yourUuid)?.displayName ?? '',
        micEnabled: initialMic,
        cameraEnabled: initialCamera,
        localStream: pending?.stream ?? undefined,
      } as JoinOptions & { localStream?: MediaStream });

      // Apply initial mute state to the stream
      if (pending?.stream) {
        pending.stream.getAudioTracks().forEach((t) => { t.enabled = initialMic; });
        pending.stream.getVideoTracks().forEach((t) => { t.enabled = initialCamera; });
      }

      // Get local stream (both MeshTransport and SfuTransport have this method)
      const getLocalStream = (transport as any).getLocalStream as (() => MediaStream | null) | undefined;
      if (getLocalStream) {
        const local = getLocalStream();
        setLocalStream(local);
      }
      setMicEnabled(initialMic);
      setCameraEnabled(initialCamera);

      // For mesh mode: set up peer connections for existing participants
      if (transport instanceof MeshTransport) {
        for (const p of payload.participants) {
          if (p.uuid !== payload.yourUuid) {
            transport.addPeer(p.uuid);
          }
        }

        // Listen for new participants and create peer connections (mesh only)
        socket.on(SocketEvents.PARTICIPANT_JOINED, (joinPayload: ParticipantJoinedPayload) => {
          const newParticipant = joinPayload.participant;
          participantsRef.current.set(newParticipant.uuid, newParticipant);
          transport.addPeer(newParticipant.uuid);
        });

        // Listen for participants leaving (mesh only)
        socket.on(SocketEvents.PARTICIPANT_LEFT, (leftPayload: ParticipantLeftPayload) => {
          transport.removePeer(leftPayload.uuid);
          participantsRef.current.delete(leftPayload.uuid);
        });
      } else {
        // SFU mode: LiveKit handles participant join/leave internally.
        // Still track participant list for UI updates from Socket.IO
        socket.on(SocketEvents.PARTICIPANT_JOINED, (joinPayload: ParticipantJoinedPayload) => {
          participantsRef.current.set(joinPayload.participant.uuid, joinPayload.participant);
        });

        socket.on(SocketEvents.PARTICIPANT_LEFT, (leftPayload: ParticipantLeftPayload) => {
          participantsRef.current.delete(leftPayload.uuid);
        });
      }

      setIsReady(true);
    },
    [socket, createMeshTransport, setupTransportListeners]
  );

  const toggleMic = useCallback(async () => {
    const transport = transportRef.current;
    if (!transport) return;
    const newState = !micEnabled;
    setMicEnabled(newState);
    await transport.setMicEnabled(newState);
  }, [micEnabled]);

  const toggleCamera = useCallback(async () => {
    const transport = transportRef.current;
    if (!transport) return;
    const newState = !cameraEnabled;
    setCameraEnabled(newState);
    await transport.setCameraEnabled(newState);
  }, [cameraEnabled]);

  const switchCamera = useCallback(async () => {
    const transport = transportRef.current;
    if (!transport) return;
    await transport.switchCamera();
  }, []);

  const startScreenShare = useCallback(async () => {
    const transport = transportRef.current;
    if (!transport) return;
    try {
      await transport.startScreenShare();
      setIsSharingScreen(true);
    } catch (err) {
      console.error('[useMediaTransport] Screen share failed:', err);
    }
  }, []);

  const stopScreenShare = useCallback(async () => {
    const transport = transportRef.current;
    if (!transport) return;
    try {
      await transport.stopScreenShare();
      setIsSharingScreen(false);
    } catch (err) {
      console.error('[useMediaTransport] Stop screen share failed:', err);
    }
  }, []);

  const setBackgroundEffect = useCallback(
    async (effect: 'none' | 'blur' | 'image', imageId?: BackgroundImagePresetId) => {
      const transport = transportRef.current;
      if (!transport) return;
      try {
        await transport.setBackgroundEffect(effect, imageId);
        setCurrentBackgroundEffect(effect);
      } catch (err) {
        console.error('[useMediaTransport] setBackgroundEffect failed:', err);
      }
    },
    []
  );

  const leave = useCallback(async () => {
    const transport = transportRef.current;
    if (!transport) return;
    // Stop screen sharing if active
    if (isSharingScreen) {
      await transport.stopScreenShare().catch(() => {});
    }
    socket?.emit(SocketEvents.ROOM_LEAVE);
    await transport.leave();
    transportRef.current = null;
    setLocalStream(null);
    setRemoteStreams([]);
    setIsSharingScreen(false);
    setIsReady(false);
  }, [socket, isSharingScreen]);

  // Build the combined participant list (self + remote)
  const allParticipants: ParticipantBrief[] = (() => {
    const list: ParticipantBrief[] = [];
    const myUuid = myUuidRef.current;

    // Self
    const myEntry = participantsRef.current.get(myUuid);
    const myName = myEntry?.displayName ?? 'You';
    list.push({
      uuid: myUuid,
      displayName: myName,
      micEnabled,
      cameraEnabled,
      isHost: myEntry?.isHost ?? false,
      isSharingScreen: isSharingScreen,
      isSpeaking: false, // We don't do local speaking detection
    });

    // Remote participants
    for (const r of remoteStreams) {
      list.push({
        uuid: r.uuid,
        displayName: r.displayName,
        micEnabled: r.micEnabled,
        cameraEnabled: r.cameraEnabled,
        isHost: r.isHost,
        isSharingScreen: r.isSharingScreen,
        isSpeaking: r.isSpeaking,
      });
    }

    return list;
  })();

  return {
    localStream,
    micEnabled,
    cameraEnabled,
    isSharingScreen,
    screenShareAllowed,
    remoteStreams,
    speakingUuids,
    allParticipants,
    toggleMic,
    toggleCamera,
    switchCamera,
    startScreenShare,
    stopScreenShare,
    setBackgroundEffect,
    currentBackgroundEffect,
    leave,
    joinMeeting,
    setPendingMedia,
    isReady,
  };
}
