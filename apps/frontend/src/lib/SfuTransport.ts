// ============================================================
// SfuTransport — LiveKit SFU implementation of MediaTransport
//
// Connects to a LiveKit server for media routing when
// mediaMode === 'sfu'. All media (AV, screen share, speaker
// detection) goes through the LiveKit SFU.
//
// Implements the same MediaTransport interface as MeshTransport
// so the UI and hooks work identically in both modes.
// ============================================================

import { Room, RoomEvent, Track, type RemoteParticipant, type RemoteTrackPublication } from 'livekit-client';
import type { MediaTransport, JoinOptions, TransportEvent } from '@jehydro/shared-types';

type EventHandler = (...args: any[]) => void;

export class SfuTransport implements MediaTransport {
  private room: Room;
  private livekitUrl: string;
  private token: string;
  private localStream: MediaStream | null = null;

  // Event listeners
  private listeners = new Map<TransportEvent, Set<EventHandler>>();

  // Track subscriptions: remote participant identity -> parsed uuid
  private remoteParticipants = new Map<string, string>();

  // Reverse lookup: uuid -> identity
  private uuidToIdentity = new Map<string, string>();

  // Track previous speaking state to only emit on changes
  private previousSpeakingState = new Map<string, boolean>();

  constructor(livekitUrl: string, token: string) {
    this.livekitUrl = livekitUrl;
    this.token = token;
    this.room = new Room({
      adaptiveStream: true,
      dynacast: true,
      stopLocalTrackOnUnpublish: false,
    });
  }

  // -----------------------------------------------------------
  // MediaTransport interface implementation
  // -----------------------------------------------------------

  async join(opts: JoinOptions): Promise<void> {
    // Check if a stream was pre-acquired (from JoinPreview)
    const preAcquiredStream = (opts as any).localStream as MediaStream | undefined;

    try {
      // Connect to LiveKit room using the access token
      await this.room.connect(this.livekitUrl, this.token);

      // Set up event listeners
      this.setupRoomListeners();

      // Publish local media
      if (preAcquiredStream) {
        this.localStream = preAcquiredStream;
        for (const track of preAcquiredStream.getTracks()) {
          if (track.kind === 'audio' || track.kind === 'video') {
            await this.room.localParticipant.publishTrack(track, {
              simulcast: track.kind === 'video',
              videoCodec: 'vp8',
            });
          }
        }
      } else {
        await this.room.localParticipant.enableCameraAndMicrophone();
      }

      this.syncLocalStream();
    } catch (err) {
      console.error('[SfuTransport] Error joining:', err);
      throw err;
    }
  }

  async leave(): Promise<void> {
    this.room.disconnect();

    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }

    this.remoteParticipants.clear();
    this.uuidToIdentity.clear();
    this.listeners.clear();
  }

  async setMicEnabled(on: boolean): Promise<void> {
    // Use LiveKit's local participant method for mute/unmute
    await this.room.localParticipant.setMicrophoneEnabled(on);
  }

  async setCameraEnabled(on: boolean): Promise<void> {
    await this.room.localParticipant.setCameraEnabled(on);
  }

  async startScreenShare(): Promise<void> {
    if (this.room.localParticipant.isScreenShareEnabled) {
      console.log('[SfuTransport] Already sharing screen');
      return;
    }

    try {
      await this.room.localParticipant.setScreenShareEnabled(true);
      console.log('[SfuTransport] Screen sharing started');
    } catch (err) {
      console.error('[SfuTransport] Error starting screen share:', err);
      throw err;
    }
  }

  async stopScreenShare(): Promise<void> {
    if (!this.room.localParticipant.isScreenShareEnabled) {
      return;
    }

    try {
      await this.room.localParticipant.setScreenShareEnabled(false);
      console.log('[SfuTransport] Screen sharing stopped');
    } catch (err) {
      console.error('[SfuTransport] Error stopping screen share:', err);
    }
  }

  async switchCamera(): Promise<void> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter((d) => d.kind === 'videoinput');

    if (videoDevices.length < 2) return;

    const currentPub = this.room.localParticipant.getTrackPublication(Track.Source.Camera);
    if (!currentPub?.track) return;

    const currentDeviceId = currentPub.track.mediaStreamTrack.getSettings().deviceId;
    const currentIndex = videoDevices.findIndex((d) => d.deviceId === currentDeviceId);
    const nextDevice = videoDevices[(currentIndex + 1) % videoDevices.length];
    if (!nextDevice) return;

    try {
      await this.room.localParticipant.unpublishTrack(currentPub.track, true);

      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: nextDevice.deviceId } },
      });

      const newTrack = newStream.getVideoTracks()[0];
      if (newTrack) {
        await this.room.localParticipant.publishTrack(newTrack, {
          simulcast: true,
          videoCodec: 'vp8',
        });
        this.syncLocalStream();
      }
    } catch (err) {
      console.error('[SfuTransport] Error switching camera:', err);
    }
  }

  on(event: TransportEvent, handler: EventHandler): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
  }

  off(event: TransportEvent, handler: EventHandler): void {
    this.listeners.get(event)?.delete(handler);
  }

  // -----------------------------------------------------------
  // Public helpers for the hook
  // -----------------------------------------------------------

  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  // -----------------------------------------------------------
  // Private methods
  // -----------------------------------------------------------

  private setupRoomListeners(): void {
    // When a remote participant publishes a track (audio/video/screen share)
    this.room.on(
      RoomEvent.TrackSubscribed,
      (track: any, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
        const remoteUuid = this.parseParticipantUuid(participant);
        if (!remoteUuid) return;

        const stream = new MediaStream([track.mediaStreamTrack]);

        const isScreenShare =
          publication.source === Track.Source.ScreenShare ||
          publication.source === Track.Source.ScreenShareAudio;

        this.emit('track-added', remoteUuid, stream, { isScreenShare });
      }
    );

    // Remote participant connected to LiveKit
    this.room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
      const remoteUuid = this.parseParticipantUuid(participant);
      if (!remoteUuid) return;

      this.remoteParticipants.set(participant.identity, remoteUuid);
      this.uuidToIdentity.set(remoteUuid, participant.identity);
      this.emit('peer-joined', remoteUuid);
    });

    // Remote participant disconnected from LiveKit
    this.room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
      const remoteUuid = this.parseParticipantUuid(participant);
      if (!remoteUuid) return;

      this.remoteParticipants.delete(participant.identity);
      this.uuidToIdentity.delete(remoteUuid);
      this.emit('peer-left', remoteUuid);
    });

    // Active speaker detection (LiveKit's built-in)
    this.room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      const activeSpeakerIdentities = new Set(speakers.map((s) => s.identity));

      for (const [identity, uuid] of this.remoteParticipants) {
        const isSpeaking = activeSpeakerIdentities.has(identity);
        const prevState = this.previousSpeakingState.get(uuid) ?? false;
        if (isSpeaking !== prevState) {
          this.previousSpeakingState.set(uuid, isSpeaking);
          this.emit('speaking-changed', uuid, isSpeaking);
        }
      }
    });
  }

  /**
   * Parse a LiveKit participant identity to get the Jehydro UUID.
   * The identity is set to the participant's UUID on the backend.
   */
  private parseParticipantUuid(participant: RemoteParticipant): string | null {
    if (participant.identity && participant.identity !== '') {
      return participant.identity;
    }
    return null;
  }

  /**
   * Sync the local MediaStream from LiveKit's local participant tracks.
   */
  private syncLocalStream(): void {
    const stream = new MediaStream();
    const publications = this.room.localParticipant.trackPublications;

    for (const [, publication] of publications) {
      if (
        publication.track &&
        (publication.track.kind === 'audio' || publication.track.kind === 'video')
      ) {
        stream.addTrack(publication.track.mediaStreamTrack);
      }
    }

    this.localStream = stream;
  }

  private emit(event: TransportEvent, ...args: any[]): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        handler(...args);
      }
    }
  }
}
