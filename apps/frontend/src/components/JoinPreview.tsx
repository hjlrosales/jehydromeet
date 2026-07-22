'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ThemeToggle } from '@/components/ThemeToggle';
import {
  enumerateDevices,
  loadDevicePreferences,
  saveDevicePreferences,
  startPreviewStream,
  type DevicePreferences,
} from '@/lib/deviceUtils';

interface JoinPreviewProps {
  roomId: string;
  displayName: string;
  onJoin: (stream: MediaStream | null, micEnabled: boolean, cameraEnabled: boolean) => void;
  onBack: () => void;
}

export function JoinPreview({ roomId, displayName, onJoin, onBack }: JoinPreviewProps) {
  const [devices, setDevices] = useState<{
    audioInputs: MediaDeviceInfo[];
    audioOutputs: MediaDeviceInfo[];
    videoInputs: MediaDeviceInfo[];
  }>({ audioInputs: [], audioOutputs: [], videoInputs: [] });

  const [prefs, setPrefs] = useState<DevicePreferences>(loadDevicePreferences);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [audioLevel, setAudioLevel] = useState(0); // 0–1
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);

  // Keep streamRef in sync with state
  useEffect(() => {
    streamRef.current = stream;
  }, [stream]);

  // -----------------------------------------------------------
  // On mount: enumerate devices + start preview
  // -----------------------------------------------------------
  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        // Enumerate devices
        const devs = await enumerateDevices();
        setDevices(devs);

        // Auto-select first devices if no saved preferences
        const saved = loadDevicePreferences();
        if (!saved.audioInput && devs.audioInputs.length > 0) {
          saved.audioInput = devs.audioInputs[0]!.deviceId;
        }
        if (!saved.videoInput && devs.videoInputs.length > 0) {
          saved.videoInput = devs.videoInputs[0]!.deviceId;
        }
        setPrefs(saved);

        // Start preview stream
        const previewStream = await startPreviewStream(saved);
        setStream(previewStream);
      } catch (err) {
        console.error('[JoinPreview] Init error:', err);
        setError('Could not access camera or microphone. Please check your permissions and device connections.');
      } finally {
        setLoading(false);
      }
    };
    init();

    return () => {
      // Cleanup stream on unmount — use ref to avoid stale closure
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      cancelAnimationFrame(animFrameRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -----------------------------------------------------------
  // Attach stream to video element
  // -----------------------------------------------------------
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  // -----------------------------------------------------------
  // Audio level meter via Web Audio API AnalyserNode
  // -----------------------------------------------------------
  useEffect(() => {
    if (!stream || !micEnabled) {
      setAudioLevel(0);
      return;
    }

    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack || !audioTrack.enabled) {
      setAudioLevel(0);
      return;
    }

    const audioCtx = new AudioContext();
    audioContextRef.current = audioCtx;
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      analyser.getByteTimeDomainData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const value = (dataArray[i]! - 128) / 128;
        sum += value * value;
      }
      const rms = Math.sqrt(sum / dataArray.length);
      setAudioLevel(Math.min(rms * 3, 1)); // Amplify for better visual
      animFrameRef.current = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      audioCtx.close();
      audioContextRef.current = null;
    };
  }, [stream, micEnabled]);

  // -----------------------------------------------------------
  // Switch devices during preview
  // -----------------------------------------------------------
  const updateDevice = useCallback(
    async (kind: 'audioInput' | 'videoInput', deviceId: string) => {
      const newPrefs = { ...prefs, [kind]: deviceId };
      setPrefs(newPrefs);
      saveDevicePreferences(newPrefs);

      // Stop old stream
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
        setStream(null);
      }

      // Start new stream
      const newStream = await startPreviewStream(newPrefs);
      setStream(newStream);
    },
    [prefs, stream]
  );

  const toggleMic = useCallback(() => {
    const newState = !micEnabled;
    setMicEnabled(newState);
    if (stream) {
      stream.getAudioTracks().forEach((t) => {
        t.enabled = newState;
      });
    }
  }, [micEnabled, stream]);

  const toggleCamera = useCallback(() => {
    const newState = !cameraEnabled;
    setCameraEnabled(newState);
    if (stream) {
      stream.getVideoTracks().forEach((t) => {
        t.enabled = newState;
      });
    }
  }, [cameraEnabled, stream]);

  const handleJoin = useCallback(() => {
    // Null the ref so the unmount cleanup doesn't stop the stream we're handing off
    streamRef.current = null;
    onJoin(stream, micEnabled, cameraEnabled);
  }, [onJoin, stream, micEnabled, cameraEnabled]);

  // -----------------------------------------------------------
  // Loading state
  // -----------------------------------------------------------
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900">
        <div className="text-center">
          <svg className="mx-auto mb-4 h-8 w-8 animate-spin text-brand-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <p className="text-sm text-slate-400">Setting up your devices...</p>
        </div>
      </div>
    );
  }

  // -----------------------------------------------------------
  // Error state
  // -----------------------------------------------------------
  if (error) {
    return (
      <div className="flex min-h-screen flex-col bg-slate-900">
        <header className="flex items-center justify-between border-b border-slate-700 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" className="h-5 w-5">
                <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <span className="text-lg font-semibold text-white">Jehydro Meet</span>
          </div>
          <ThemeToggle />
        </header>
        <main className="flex flex-1 items-center justify-center px-4 py-12">
          <div className="w-full max-w-md text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-900/30">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-8 w-8 text-red-400">
                <path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zm-1.72 6.97a.75.75 0 10-1.06 1.06L10.94 12l-1.72 1.72a.75.75 0 101.06 1.06L12 13.06l1.72 1.72a.75.75 0 101.06-1.06L13.06 12l1.72-1.72a.75.75 0 10-1.06-1.06L12 10.94l-1.72-1.72z" clipRule="evenodd" />
              </svg>
            </div>
            <h2 className="mb-2 text-lg font-semibold text-white">Device Setup Issue</h2>
            <p className="mb-6 text-sm text-slate-400">{error}</p>
            <div className="space-y-3">
              <p className="text-xs text-slate-500">
                You can still join without camera/microphone. Toggle them once inside the meeting, or grant permissions in your browser settings.
              </p>
              <button onClick={handleJoin} className="btn-primary w-full py-3 text-base">
                Join Without Camera/Mic
              </button>
              <button onClick={onBack} className="btn-secondary w-full py-3 text-base">
                Go Back
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // -----------------------------------------------------------
  // Preview state
  // -----------------------------------------------------------
  return (
    <div className="flex min-h-screen flex-col bg-slate-900">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-slate-700 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" className="h-5 w-5">
              <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </div>
          <span className="text-lg font-semibold text-white">Jehydro Meet</span>
        </div>
        <ThemeToggle />
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-8 lg:flex-row lg:items-start">
        {/* Left: Camera preview */}
        <div className="w-full max-w-lg lg:w-1/2">
          <div className="relative overflow-hidden rounded-xl bg-slate-800">
            {/* Video preview (mirrored) */}
            <div className="aspect-video">
              {stream && cameraEnabled ? (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="h-full w-full scale-x-[-1] object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <div className="flex h-20 w-20 items-center justify-center rounded-full bg-slate-700">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-10 w-10 text-slate-500">
                      <path fillRule="evenodd" d="M7.5 6a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM3.751 20.105a8.25 8.25 0 0116.498 0 .75.75 0 01-.437.695A18.683 18.683 0 0112 22.5c-4.773 0-8.94-1.837-12.062-4.605a.75.75 0 01-.187-.79z" clipRule="evenodd" />
                    </svg>
                  </div>
                </div>
              )}
            </div>

            {/* Mic/Camera toggles on preview */}
            <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-3">
              <button
                onClick={toggleMic}
                className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all ${
                  micEnabled
                    ? 'bg-white/20 text-white hover:bg-white/30'
                    : 'bg-red-600 text-white hover:bg-red-700'
                }`}
                title={micEnabled ? 'Mute microphone' : 'Unmute microphone'}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
                  {micEnabled ? (
                    <path d="M8.25 4.5a3.75 3.75 0 117.5 0v8.25a3.75 3.75 0 11-7.5 0V4.5z" />
                  ) : (
                    <>
                      <path d="M13.5 4.5a3.75 3.75 0 117.5 0v8.25a3.75 3.75 0 11-7.5 0V4.5z" />
                      <path d="M12 16.5a6.75 6.75 0 006.75-6.75v-1.5a.75.75 0 011.5 0v1.5a8.251 8.251 0 01-7.5 8.209v2.291h3a.75.75 0 010 1.5h-8.5a.75.75 0 010-1.5h3v-2.291a8.251 8.251 0 01-7.5-8.209v-1.5a.75.75 0 011.5 0v1.5A6.75 6.75 0 0012 16.5z" />
                      <line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" strokeWidth="2" />
                    </>
                  )}
                </svg>
              </button>
              <button
                onClick={toggleCamera}
                className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all ${
                  cameraEnabled
                    ? 'bg-white/20 text-white hover:bg-white/30'
                    : 'bg-red-600 text-white hover:bg-red-700'
                }`}
                title={cameraEnabled ? 'Turn off camera' : 'Turn on camera'}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
                  {cameraEnabled ? (
                    <path d="M4.5 4.5a3 3 0 00-3 3v9a3 3 0 003 3h8.25a3 3 0 003-3v-9a3 3 0 00-3-3H4.5zM19.94 18.75l-2.69-2.69V7.94l2.69-2.69c.944-.945 2.56-.276 2.56 1.06v11.38c0 1.336-1.616 2.005-2.56 1.06z" />
                  ) : (
                    <>
                      <path d="M4.5 4.5a3 3 0 00-3 3v9a3 3 0 003 3h8.25a3 3 0 003-3v-9a3 3 0 00-3-3H4.5z" />
                      <line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" strokeWidth="2" />
                    </>
                  )}
                </svg>
              </button>
            </div>

            {/* Camera off badge */}
            {!cameraEnabled && (
              <div className="absolute left-3 top-3 rounded bg-yellow-600/80 px-2 py-1 text-xs text-white">
                Camera off
              </div>
            )}
          </div>

          {/* Mic level meter */}
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
              <span>Microphone {!micEnabled && '(muted)'}</span>
              <span>{Math.round(audioLevel * 100)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-700">
              <div
                className="h-full rounded-full transition-all duration-75"
                style={{
                  width: `${Math.max(audioLevel * 100, 4)}%`,
                  backgroundColor:
                    audioLevel > 0.7 ? '#ef4444' : audioLevel > 0.3 ? '#f59e0b' : '#22c55e',
                }}
              />
            </div>
          </div>
        </div>

        {/* Right: Device selection + Join */}
        <div className="w-full max-w-sm lg:w-1/3">
          <div className="rounded-xl bg-slate-800 p-5">
            <h2 className="mb-1 text-lg font-semibold text-white">Ready to join?</h2>
            <p className="mb-5 text-sm text-slate-400">
              Room: <span className="font-mono text-slate-300">{roomId}</span>
              <br />
              Name: <span className="text-slate-300">{displayName}</span>
            </p>

            {/* Camera selector */}
            <div className="mb-3">
              <label className="mb-1 block text-xs font-medium text-slate-400">Camera</label>
              <select
                value={prefs.videoInput}
                onChange={(e) => updateDevice('videoInput', e.target.value)}
                className="input-field text-sm"
                disabled={devices.videoInputs.length === 0}
              >
                {devices.videoInputs.length === 0 && <option value="">No camera found</option>}
                {devices.videoInputs.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Camera ${d.deviceId.slice(0, 8)}`}
                  </option>
                ))}
              </select>
            </div>

            {/* Microphone selector */}
            <div className="mb-3">
              <label className="mb-1 block text-xs font-medium text-slate-400">Microphone</label>
              <select
                value={prefs.audioInput}
                onChange={(e) => updateDevice('audioInput', e.target.value)}
                className="input-field text-sm"
                disabled={devices.audioInputs.length === 0}
              >
                {devices.audioInputs.length === 0 && <option value="">No mic found</option>}
                {devices.audioInputs.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Microphone ${d.deviceId.slice(0, 8)}`}
                  </option>
                ))}
              </select>
            </div>

            {/* Speaker selector (where supported) */}
            {devices.audioOutputs.length > 1 && (
              <div className="mb-5">
                <label className="mb-1 block text-xs font-medium text-slate-400">Speaker</label>
                <select
                  value={prefs.audioOutput}
                  onChange={(e) => {
                    const newPrefs = { ...prefs, audioOutput: e.target.value };
                    setPrefs(newPrefs);
                    saveDevicePreferences(newPrefs);
                  }}
                  className="input-field text-sm"
                >
                  {devices.audioOutputs.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Speaker ${d.deviceId.slice(0, 8)}`}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-500">
                  Speaker selection may not be supported in all browsers.
                </p>
              </div>
            )}

            {/* Action buttons */}
            <div className="space-y-2">
              <button onClick={handleJoin} className="btn-primary w-full py-3 text-base">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="mr-2 h-5 w-5">
                  <path fillRule="evenodd" d="M12.97 3.97a.75.75 0 011.06 0l7.5 7.5a.75.75 0 010 1.06l-7.5 7.5a.75.75 0 11-1.06-1.06l6.22-6.22H3a.75.75 0 010-1.5h16.19l-6.22-6.22a.75.75 0 010-1.06z" clipRule="evenodd" />
                </svg>
                Join Now
              </button>
              <button onClick={onBack} className="btn-secondary w-full py-3 text-base">
                Back
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
