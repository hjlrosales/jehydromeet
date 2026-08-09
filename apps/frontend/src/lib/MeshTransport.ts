// ============================================================
// MeshTransport — Full-mesh WebRTC implementation of MediaTransport
//
// Creates one RTCPeerConnection per remote peer and relays
// signaling through the Socket.IO signaling server.
//
// Polite peer pattern: the peer with the lexicographically
// smaller UUID is "polite" and rolls back on glare.
// ============================================================

import type { Socket } from 'socket.io-client';
import { SocketEvents } from '@jehydro/shared-types';
import type {
  MediaTransport,
  JoinOptions,
  TransportEvent,
  SignalMessage,
} from '@jehydro/shared-types';

import { BackgroundProcessor } from './BackgroundProcessor';
import type { BackgroundEffect, BackgroundImagePresetId } from '@jehydro/shared-types';

// ICE servers from environment or default Google STUN
function getIceServers(): RTCIceServer[] {
  try {
    const env = process.env.NEXT_PUBLIC_ICE_SERVERS;
    if (env) return JSON.parse(env) as RTCIceServer[];
  } catch {
    // fall through
  }
  return [{ urls: 'stun:stun.l.google.com:19302' }];
}

const ICE_SERVERS = getIceServers();

// getUserMedia constraints with echo cancellation + noise suppression
const MEDIA_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  } as MediaTrackConstraints,
  video: {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30 },
  } as MediaTrackConstraints,
};

type EventHandler = (...args: any[]) => void;

export class MeshTransport implements MediaTransport {
  private socket: Socket;
  private myUuid: string = '';

  // Local media
  private localStream: MediaStream | null = null;

  // Peer connections: remoteUuid -> RTCPeerConnection
  private peers = new Map<string, RTCPeerConnection>();

  // Remote streams: remoteUuid -> MediaStream (for rendering)
  private remoteStreams = new Map<string, MediaStream>();

  // Event listeners
  private listeners = new Map<TransportEvent, Set<EventHandler>>();

  // Track which remote participants we've already sent an offer to
  private offeredPeers = new Set<string>();

  // Making/awaiting an offer (to avoid glare)
  private makingOffer: boolean = false;

  // Active speaker detection
  private audioContext: AudioContext | null = null;
  private speakerAnalysers = new Map<string, { analyser: AnalyserNode; source: MediaStreamAudioSourceNode; dataArray: Uint8Array<ArrayBuffer> }>();
  private speakingStates = new Map<string, boolean>();
  private speakerDetectionTimer: ReturnType<typeof setInterval> | null = null;
  private readonly SPEAKER_THRESHOLD = 0.12;
  private readonly SPEAKER_CHECK_INTERVAL = 150; // ms

  constructor(socket: Socket) {
    this.socket = socket;
  }

  // -----------------------------------------------------------
  // MediaTransport interface implementation
  // -----------------------------------------------------------

  /**
   * Join the media session.
   * If `opts.localStream` is provided (e.g., from the join preview), use it.
   * Otherwise, call getUserMedia.
   */
  async join(opts: JoinOptions): Promise<void> {
    this.myUuid = opts.displayName; // will be overwritten by ROOM_JOINED

    // Check if a stream was pre-acquired (from JoinPreview)
    const preAcquiredStream = (opts as any).localStream as MediaStream | undefined;
    if (preAcquiredStream) {
      this.localStream = preAcquiredStream;
    } else {
      // Get local media
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia(MEDIA_CONSTRAINTS);
      } catch (err) {
        console.warn('[MeshTransport] getUserMedia failed, proceeding without local media:', err);
      }
    }

    // Set up signaling listeners
    this.setupSignalingListeners();
  }

  async leave(): Promise<void> {
    // Close all peer connections
    for (const [, pc] of this.peers) {
      pc.close();
    }
    this.peers.clear();
    this.remoteStreams.clear();
    this.offeredPeers.clear();

    // Stop local tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }

    // Stop speaker detection
    this.stopSpeakerDetection();

    // Remove signaling listeners
    this.removeSignalingListeners();
  }

  async setMicEnabled(on: boolean): Promise<void> {
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = on;
      });
    }
    // Broadcast state change to the room via socket
    this.socket.emit(SocketEvents.PARTICIPANT_UPDATED, {
      uuid: this.myUuid,
      micEnabled: on,
    });
  }

  async setCameraEnabled(on: boolean): Promise<void> {
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach((track) => {
        track.enabled = on;
      });
    }
    this.socket.emit(SocketEvents.PARTICIPANT_UPDATED, {
      uuid: this.myUuid,
      cameraEnabled: on,
    });
  }

  // Screen sharing state
  private screenTrack: MediaStreamTrack | null = null;
  private cameraTrackBeforeShare: MediaStreamTrack | null = null;
  private stopScreenShareHandler: (() => void) | null = null;

  // Background effect (Phase 13)
  private backgroundProcessor: BackgroundProcessor | null = null;
  private originalVideoTrack: MediaStreamTrack | null = null;
  private backgroundImageId: BackgroundImagePresetId | null = null;

  async startScreenShare(): Promise<void> {
    if (this.screenTrack) {
      console.log('[MeshTransport] Already sharing screen');
      return;
    }

    try {
      // Capture screen/window/tab
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 },
        } as MediaTrackConstraints,
        audio: false, // We don't share system audio
      });

      const track = screenStream.getVideoTracks()[0];
      if (!track) {
        screenStream.getTracks().forEach((t) => t.stop());
        throw new Error('No video track from getDisplayMedia');
      }

      this.screenTrack = track;

      // Save current camera track if any
      const currentVideoTrack = this.localStream?.getVideoTracks()[0] ?? null;
      this.cameraTrackBeforeShare = currentVideoTrack;

      // Notify server we're starting
      this.socket.emit(SocketEvents.SCREEN_SHARE_START, { uuid: this.myUuid });

      if (this.localStream) {
        // If there's a camera track, remove it and add the screen track
        if (currentVideoTrack) {
          this.localStream.removeTrack(currentVideoTrack);
          // Keep the camera track alive (don't stop it) so we can restore it later
        }
        this.localStream.addTrack(track);
      }

      // Replace video track in all peer connections using replaceTrack (no renegotiation)
      const replacePromises: Promise<void>[] = [];
      for (const [remoteUuid, pc] of this.peers) {
        const videoSender = pc.getSenders().find((s) => s.track?.kind === 'video');
        if (videoSender) {
          replacePromises.push(
            videoSender.replaceTrack(track).catch((err) => {
              console.warn(`[MeshTransport] replaceTrack failed for ${remoteUuid}:`, err);
            })
          );
        } else {
          // No existing video sender — add track (will trigger negotiation)
          try {
            pc.addTrack(track, this.localStream!);
          } catch (err) {
            console.warn(`[MeshTransport] addTrack for ${remoteUuid}:`, err);
          }
        }
      }
      await Promise.allSettled(replacePromises);

      // Listen for the browser's native stop (user clicks "Stop sharing" in browser UI)
      const onTrackEnded = () => {
        console.log('[MeshTransport] Screen share track ended (browser native stop)');
        this.stopScreenShare();
      };
      track.addEventListener('ended', onTrackEnded);
      this.stopScreenShareHandler = () => {
        track.removeEventListener('ended', onTrackEnded);
      };

      console.log('[MeshTransport] Screen sharing started');
    } catch (err) {
      console.error('[MeshTransport] Error starting screen share:', err);
      this.screenTrack = null;
      this.cameraTrackBeforeShare = null;
      throw err;
    }
  }

  async stopScreenShare(): Promise<void> {
    if (!this.screenTrack) {
      console.log('[MeshTransport] Not sharing screen');
      return;
    }

    console.log('[MeshTransport] Stopping screen share');

    // Remove ended listener
    this.stopScreenShareHandler?.();
    this.stopScreenShareHandler = null;

    const track = this.screenTrack;
    this.screenTrack = null;

    // Stop the screen track
    track.stop();

    // Notify server
    this.socket.emit(SocketEvents.SCREEN_SHARE_STOP, { uuid: this.myUuid });

    if (this.localStream) {
      // Remove screen track from local stream
      this.localStream.removeTrack(track);

      // Restore camera track if we had one
      if (this.cameraTrackBeforeShare) {
        this.localStream.addTrack(this.cameraTrackBeforeShare);
      }
    }

    // Restore video track in all peer connections
    const restoreTrack = this.cameraTrackBeforeShare;
    this.cameraTrackBeforeShare = null;

    const replacePromises: Promise<void>[] = [];
    for (const [remoteUuid, pc] of this.peers) {
      const videoSender = pc.getSenders().find((s) => s.track?.kind === 'video');
      if (videoSender && restoreTrack) {
        replacePromises.push(
          videoSender.replaceTrack(restoreTrack).catch((err) => {
            console.warn(`[MeshTransport] restore track failed for ${remoteUuid}:`, err);
          })
        );
      } else if (videoSender && !restoreTrack) {
        // No camera to restore — remove the sender
        try {
          pc.removeTrack(videoSender);
        } catch (err) {
          console.warn(`[MeshTransport] removeTrack for ${remoteUuid}:`, err);
        }
      }
    }
    await Promise.allSettled(replacePromises);

    console.log('[MeshTransport] Screen sharing stopped');
  }

  async switchCamera(): Promise<void> {
    if (!this.localStream) return;

    const videoTrack = this.localStream.getVideoTracks()[0];
    if (!videoTrack) return;

    // Get list of video devices
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter((d) => d.kind === 'videoinput');

    if (videoDevices.length < 2) return; // No second camera

    // Find the current device and switch to the next one
    const currentDeviceId = videoTrack.getSettings().deviceId;
    const currentIndex = videoDevices.findIndex((d) => d.deviceId === currentDeviceId);
    const nextDevice = videoDevices[(currentIndex + 1) % videoDevices.length];

    if (!nextDevice) return;

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { deviceId: { exact: nextDevice.deviceId } },
      });

      const newTrack = newStream.getVideoTracks()[0];
      if (!newTrack) return;

      // Replace track in local stream
      this.localStream.removeTrack(videoTrack);
      videoTrack.stop();
      this.localStream.addTrack(newTrack);

      // Replace track in all peer connections
      for (const pc of this.peers.values()) {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
        if (sender) {
          await sender.replaceTrack(newTrack);
        }
      }
    } catch (err) {
      console.error('[MeshTransport] Error switching camera:', err);
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
  // Internal helpers
  // -----------------------------------------------------------

  /**
   * Set UUID after receiving ROOM_JOINED payload (called by hook/page)
   */
  setUuid(uuid: string): void {
    this.myUuid = uuid;
  }

  /**
   * Called when a new participant joins — create an offer to them
   */
  addPeer(remoteUuid: string): void {
    if (this.peers.has(remoteUuid) || remoteUuid === this.myUuid) return;

    console.log(`[MeshTransport] Adding peer ${remoteUuid}`);
    const pc = this.createPeerConnection(remoteUuid);
    this.peers.set(remoteUuid, pc);

    // Add local tracks to the new connection
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        pc.addTrack(track, this.localStream);
      }
    }

    // Create and send offer
    this.createAndSendOffer(remoteUuid, pc);

    // Apply bandwidth adaptation for the new participant count
    this.applyBandwidthLimit();
  }

  /**
   * Called when a participant leaves — close their peer connection
   */
  removePeer(remoteUuid: string): void {
    const pc = this.peers.get(remoteUuid);
    if (pc) {
      pc.close();
      this.peers.delete(remoteUuid);
    }
    this.remoteStreams.delete(remoteUuid);
    this.offeredPeers.delete(remoteUuid);

    // Clean up speaker detection
    this.removeSpeakerDetection(remoteUuid);

    this.emit('peer-left', remoteUuid);

    // Re-apply bandwidth adaptation for the reduced participant count
    this.applyBandwidthLimit();
  }

  /**
   * Get a remote stream for rendering
   */
  getRemoteStream(remoteUuid: string): MediaStream | undefined {
    return this.remoteStreams.get(remoteUuid);
  }

  /**
   * Get the local stream
   */
  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  // -----------------------------------------------------------
  // Private methods
  // -----------------------------------------------------------

  private createPeerConnection(remoteUuid: string): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal({
          type: 'ice-candidate',
          from: this.myUuid,
          to: remoteUuid,
          payload: event.candidate.toJSON(),
        });
      }
    };

    pc.ontrack = (event) => {
      console.log(`[MeshTransport] Received track from ${remoteUuid}:`, event.track.kind);

      // Create or update the remote stream
      let stream = this.remoteStreams.get(remoteUuid);
      if (!stream) {
        stream = new MediaStream();
        this.remoteStreams.set(remoteUuid, stream);
        this.emit('track-added', remoteUuid, stream);
      }
      stream.addTrack(event.track);

      // Set up speaker detection for audio tracks
      if (event.track.kind === 'audio') {
        this.initSpeakerDetection(remoteUuid, stream);
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[MeshTransport] ICE state (${remoteUuid}): ${pc.iceConnectionState}`);

      if (pc.iceConnectionState === 'failed') {
        // Attempt ICE restart once before giving up
        console.log(`[MeshTransport] ICE failed for ${remoteUuid}, attempting restart`);
        this.restartIce(remoteUuid, pc);
      } else if (pc.iceConnectionState === 'disconnected') {
        // Allow some time for reconnection
        setTimeout(() => {
          if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
            console.log(`[MeshTransport] Peer ${remoteUuid} still disconnected, closing`);
            this.removePeer(remoteUuid);
          }
        }, 5000);
      } else if (pc.iceConnectionState === 'connected') {
        this.emit('connection-state', remoteUuid, 'connected');
      }
    };

    pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await pc.setLocalDescription();
        this.sendSignal({
          type: 'offer',
          from: this.myUuid,
          to: remoteUuid,
          payload: pc.localDescription,
        });
      } catch (err) {
        console.error('[MeshTransport] negotiationneeded error:', err);
      } finally {
        this.makingOffer = false;
      }
    };

    return pc;
  }

  private async createAndSendOffer(remoteUuid: string, pc: RTCPeerConnection): Promise<void> {
    if (this.offeredPeers.has(remoteUuid)) return;
    this.offeredPeers.add(remoteUuid);

    try {
      this.makingOffer = true;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.sendSignal({
        type: 'offer',
        from: this.myUuid,
        to: remoteUuid,
        payload: offer,
      });
    } catch (err) {
      console.error(`[MeshTransport] Error creating offer for ${remoteUuid}:`, err);
    } finally {
      this.makingOffer = false;
    }
  }

  private async handleOffer(message: SignalMessage): Promise<void> {
    const pc = this.peers.get(message.from);
    if (!pc) {
      console.warn(`[MeshTransport] Received offer from unknown peer ${message.from}`);
      return;
    }

    const offer = message.payload as RTCSessionDescriptionInit;
    const offerCollision = this.makingOffer || pc.signalingState !== 'stable';

    // Polite peer rolls back on collision; impolite ignores
    const shouldIgnore = !this.isPolitePeer(message.from) && offerCollision;
    if (shouldIgnore) {
      console.log(`[MeshTransport] Ignoring offer from ${message.from} (collision)`);
      return;
    }

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      await pc.setLocalDescription();
      this.sendSignal({
        type: 'answer',
        from: this.myUuid,
        to: message.from,
        payload: pc.localDescription,
      });
    } catch (err) {
      console.error(`[MeshTransport] Error handling offer from ${message.from}:`, err);
    }
  }

  private async handleAnswer(message: SignalMessage): Promise<void> {
    const pc = this.peers.get(message.from);
    if (!pc) {
      console.warn(`[MeshTransport] Received answer from unknown peer ${message.from}`);
      return;
    }

    const answer = message.payload as RTCSessionDescriptionInit;
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (err) {
      console.error(`[MeshTransport] Error handling answer from ${message.from}:`, err);
    }
  }

  private async handleIceCandidate(message: SignalMessage): Promise<void> {
    const pc = this.peers.get(message.from);
    if (!pc) {
      console.warn(`[MeshTransport] Received ICE from unknown peer ${message.from}`);
      return;
    }

    const candidate = message.payload as RTCIceCandidateInit;
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error(`[MeshTransport] Error adding ICE candidate from ${message.from}:`, err);
    }
  }

  private async restartIce(remoteUuid: string, pc: RTCPeerConnection): Promise<void> {
    try {
      // ICE restart: create offer with ICE restart flag
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      this.sendSignal({
        type: 'offer',
        from: this.myUuid,
        to: remoteUuid,
        payload: offer,
      });
    } catch (err) {
      console.error(`[MeshTransport] ICE restart failed for ${remoteUuid}:`, err);
    }
  }

  private isPolitePeer(remoteUuid: string): boolean {
    return this.myUuid.localeCompare(remoteUuid) < 0;
  }

  // -----------------------------------------------------------
  // Bandwidth adaptation — cap video bitrate as participant
  // count grows to preserve bandwidth on residential uploads.
  // -----------------------------------------------------------

  /**
   * Calculate the max video bitrate per peer based on participant count.
   *
   *  2 participants → 2.5 Mbps  (unconstrained HD)
   *  3-4           → 1.0 Mbps  (good quality, shared bandwidth)
   *  5-6           →  600 Kbps (balanced)
   *  7-8           →  400 Kbps (minimal but watchable)
   */
  private getMaxBitrateKbps(): number {
    const count = this.peers.size + 1; // +1 for self
    if (count <= 2) return 2500;
    if (count <= 4) return 1000;
    if (count <= 6) return 600;
    return 400;
  }

  /**
   * Apply bandwidth limit to all outbound video tracks.
   * Uses RTCRtpSender.setParameters() to set the max bitrate.
   * Called after addPeer() and removePeer().
   */
  private applyBandwidthLimit(): void {
    const maxBitrateKbps = this.getMaxBitrateKbps();
    console.log(`[MeshTransport] Applying bandwidth limit: ${maxBitrateKbps} Kbps (${this.peers.size + 1} participants)`);

    for (const [remoteUuid, pc] of this.peers) {
      const videoSender = pc.getSenders().find((s) => s.track?.kind === 'video');
      if (!videoSender) continue;

      const params = videoSender.getParameters();
      if (!params.encodings) {
        params.encodings = [{}];
      }

      // Set max bitrate for each encoding
      for (const encoding of params.encodings) {
        encoding.maxBitrate = maxBitrateKbps * 1000;
      }

      videoSender.setParameters(params).catch((err) => {
        console.warn(`[MeshTransport] Failed to set bandwidth for ${remoteUuid}:`, err);
      });
    }
  }

  private sendSignal(message: SignalMessage): void {
    const eventMap: Record<string, string> = {
      offer: SocketEvents.SIGNAL_OFFER,
      answer: SocketEvents.SIGNAL_ANSWER,
      'ice-candidate': SocketEvents.SIGNAL_ICE,
    };
    this.socket.emit(eventMap[message.type]!, message);
  }

  private setupSignalingListeners(): void {
    this.socket.on(SocketEvents.SIGNAL_OFFER, this.onSignalOffer);
    this.socket.on(SocketEvents.SIGNAL_ANSWER, this.onSignalAnswer);
    this.socket.on(SocketEvents.SIGNAL_ICE, this.onSignalIce);
  }

  private removeSignalingListeners(): void {
    this.socket.off(SocketEvents.SIGNAL_OFFER, this.onSignalOffer);
    this.socket.off(SocketEvents.SIGNAL_ANSWER, this.onSignalAnswer);
    this.socket.off(SocketEvents.SIGNAL_ICE, this.onSignalIce);
  }

  private onSignalOffer = (message: SignalMessage): void => {
    this.handleOffer(message);
  };

  private onSignalAnswer = (message: SignalMessage): void => {
    this.handleAnswer(message);
  };

  private onSignalIce = (message: SignalMessage): void => {
    this.handleIceCandidate(message);
  };

  private emit(event: TransportEvent, ...args: any[]): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        handler(...args);
      }
    }
  }

  // -----------------------------------------------------------
  // Background effect (Phase 13)
  // -----------------------------------------------------------

  async setBackgroundEffect(effect: BackgroundEffect, imageId?: BackgroundImagePresetId): Promise<void> {
    // Clean up previous processor
    if (this.backgroundProcessor) {
      this.backgroundProcessor.destroy();
      this.backgroundProcessor = null;
    }

    if (effect === 'none') {
      // Restore original camera track if we replaced it
      if (this.originalVideoTrack && this.localStream) {
        const currentTrack = this.localStream.getVideoTracks()[0];
        if (currentTrack && currentTrack !== this.originalVideoTrack) {
          currentTrack.stop();
          this.localStream.removeTrack(currentTrack);
          this.localStream.addTrack(this.originalVideoTrack);

          // Replace in all peer connections
          for (const pc of this.peers.values()) {
            const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
            if (sender) {
              await sender.replaceTrack(this.originalVideoTrack).catch(() => {});
            }
          }
        }
      }
      return;
    }

    if (!this.localStream) return;

    // Save original track if not already saved
    if (!this.originalVideoTrack) {
      const videoTrack = this.localStream.getVideoTracks()[0];
      if (videoTrack) {
        this.originalVideoTrack = videoTrack.clone(); // Clone so original can keep running
      }
    }

    // Create processor with current stream
    const processor = new BackgroundProcessor(this.localStream);
    await processor.init();

    if (effect === 'image' && imageId) {
      this.backgroundImageId = imageId;
    }
    processor.setEffect(effect, imageId);

    this.backgroundProcessor = processor;

    // Replace the video track in the local stream with the processed one
    const outputStream = processor.getOutputStream();
    if (!outputStream) return;

    const processedTrack = outputStream.getVideoTracks()[0];
    if (!processedTrack) return;

    const currentTrack = this.localStream.getVideoTracks()[0];
    if (currentTrack) {
      this.localStream.removeTrack(currentTrack);
      currentTrack.stop();
    }
    this.localStream.addTrack(processedTrack);

    // Replace in all peer connections
    for (const pc of this.peers.values()) {
      const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) {
        await sender.replaceTrack(processedTrack).catch(() => {});
      }
    }
  }

  // -----------------------------------------------------------
  // Active speaker detection
  // -----------------------------------------------------------

  private initSpeakerDetection(remoteUuid: string, stream: MediaStream): void {
    // Skip if no audio track
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) return;

    // Create audio context on first use
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }

    // Skip if already tracking this peer
    if (this.speakerAnalysers.has(remoteUuid)) return;

    try {
      const source = this.audioContext.createMediaStreamSource(stream);
      const analyser = this.audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
      this.speakerAnalysers.set(remoteUuid, { analyser, source, dataArray });

      // Start polling if not already running
      if (!this.speakerDetectionTimer) {
        this.speakerDetectionTimer = setInterval(() => {
          this.checkSpeakerLevels();
        }, this.SPEAKER_CHECK_INTERVAL);
      }
    } catch (err) {
      console.warn(`[MeshTransport] Could not init speaker detection for ${remoteUuid}:`, err);
    }
  }

  private removeSpeakerDetection(remoteUuid: string): void {
    const entry = this.speakerAnalysers.get(remoteUuid);
    if (entry) {
      entry.source.disconnect();
      this.speakerAnalysers.delete(remoteUuid);
    }
    this.speakingStates.delete(remoteUuid);

    // Stop timer if no more peers
    if (this.speakerAnalysers.size === 0 && this.speakerDetectionTimer) {
      clearInterval(this.speakerDetectionTimer);
      this.speakerDetectionTimer = null;
    }
  }

  private stopSpeakerDetection(): void {
    if (this.speakerDetectionTimer) {
      clearInterval(this.speakerDetectionTimer);
      this.speakerDetectionTimer = null;
    }
    this.speakerAnalysers.clear();
    this.speakingStates.clear();
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }

  private checkSpeakerLevels(): void {
    for (const [uuid, { analyser, dataArray }] of this.speakerAnalysers) {
      analyser.getByteTimeDomainData(dataArray as Uint8Array<ArrayBuffer>);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const value = (dataArray[i]! - 128) / 128;
        sum += value * value;
      }
      const rms = Math.sqrt(sum / dataArray.length);
      const speaking = rms > this.SPEAKER_THRESHOLD;

      const prevState = this.speakingStates.get(uuid) ?? false;
      if (speaking !== prevState) {
        this.speakingStates.set(uuid, speaking);
        this.emit('speaking-changed', uuid, speaking);
      }
    }
  }
}
