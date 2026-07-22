// ============================================================
// Device utilities — enumerate devices, persist preferences in
// localStorage, and build getUserMedia constraints from saved
// selections.
// ============================================================

const STORAGE_KEY = 'jehydro-devices';

export interface DevicePreferences {
  audioInput: string;   // deviceId
  audioOutput: string;  // deviceId
  videoInput: string;   // deviceId
}

/**
 * Enumerate all media devices.
 * Returns separate arrays for audio inputs, audio outputs, and video inputs.
 */
export async function enumerateDevices(): Promise<{
  audioInputs: MediaDeviceInfo[];
  audioOutputs: MediaDeviceInfo[];
  videoInputs: MediaDeviceInfo[];
}> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return {
    audioInputs: devices.filter((d) => d.kind === 'audioinput'),
    audioOutputs: devices.filter((d) => d.kind === 'audiooutput'),
    videoInputs: devices.filter((d) => d.kind === 'videoinput'),
  };
}

/**
 * Load saved device preferences from localStorage.
 */
export function loadDevicePreferences(): DevicePreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DevicePreferences>;
      return {
        audioInput: parsed.audioInput ?? '',
        audioOutput: parsed.audioOutput ?? '',
        videoInput: parsed.videoInput ?? '',
      };
    }
  } catch {
    // fall through
  }
  return { audioInput: '', audioOutput: '', videoInput: '' };
}

/**
 * Save device preferences to localStorage.
 */
export function saveDevicePreferences(prefs: DevicePreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage not available
  }
}

/**
 * Build getUserMedia constraints from device preferences.
 * Falls back to default devices when deviceId is empty or device not found.
 */
export function buildMediaConstraints(prefs: DevicePreferences): MediaStreamConstraints {
  const constraints: MediaStreamConstraints = {
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

  if (prefs.audioInput) {
    (constraints.audio as MediaTrackConstraints).deviceId = { exact: prefs.audioInput };
  }

  if (prefs.videoInput) {
    (constraints.video as MediaTrackConstraints).deviceId = { exact: prefs.videoInput };
  }

  return constraints;
}

/**
 * Start a preview media stream using saved preferences.
 * Returns the stream, or null if permission denied / no devices.
 */
export async function startPreviewStream(
  prefs: DevicePreferences
): Promise<MediaStream | null> {
  try {
    return await navigator.mediaDevices.getUserMedia(buildMediaConstraints(prefs));
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotAllowedError') {
      console.warn('[deviceUtils] Camera/mic permission denied');
      return null;
    }
    if (err instanceof DOMException && err.name === 'NotFoundError') {
      console.warn('[deviceUtils] No camera/mic found');
      return null;
    }
    console.warn('[deviceUtils] getUserMedia failed:', err);
    return null;
  }
}


