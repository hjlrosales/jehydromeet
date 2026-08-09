/**
 * Recording Service — LiveKit Egress Management
 *
 * Manages composite room recording via LiveKit Egress API.
 * - Starts/stops composite recordings for SFU rooms
 * - Tracks recording metadata in memory (fast cache) AND in PostgreSQL
 * - Manages retention (auto-delete after configured days)
 * - Monitors storage capacity
 *
 * Requirements:
 *   LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL must be configured.
 *   RECORDING_STORAGE_PATH (directory for recording files)
 *   RECORDING_RETENTION_DAYS (default 7)
 *   RECORDING_MAX_STORAGE_GB (default 10)
 */

import { EgressClient, EncodedFileType, AudioCodec } from 'livekit-server-sdk';
import type { Recording } from '@jehydro/shared-types';
import fs from 'fs';
import path from 'path';
import prisma from './db';

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY ?? '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET ?? '';
const LIVEKIT_URL = process.env.LIVEKIT_URL ?? '';

const RECORDING_STORAGE_PATH = process.env.RECORDING_STORAGE_PATH ?? './recordings';
const RECORDING_RETENTION_DAYS = parseInt(process.env.RECORDING_RETENTION_DAYS ?? '7', 10);
const RECORDING_MAX_STORAGE_GB = parseInt(process.env.RECORDING_MAX_STORAGE_GB ?? '10', 10);
const MAX_STORAGE_BYTES = RECORDING_MAX_STORAGE_GB * 1024 * 1024 * 1024;

// In-memory recording metadata cache (roomId -> Recording[])
// Fast lookup for currently active recordings — DB is the source of truth for completed ones
const recordingStore = new Map<string, Recording[]>();

// Map egressId -> roomId for callback lookup
const egressToRoom = new Map<string, string>();

// Egress client singleton
let egressClient: EgressClient | null = null;

function getEgressClient(): EgressClient | null {
  if (egressClient) return egressClient;
  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_URL) {
    console.warn('[recording] LiveKit not configured — recording unavailable');
    return null;
  }
  egressClient = new EgressClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
  return egressClient;
}

// -----------------------------------------------------------
// Recording Management
// -----------------------------------------------------------

/**
 * Start a composite recording for a LiveKit room.
 * Returns the Recording object with egress ID, or null on failure.
 */
export async function startRecording(roomId: string): Promise<Recording | null> {
  const client = getEgressClient();
  if (!client) return null;

  // Check storage capacity
  const storageUsed = getStorageUsedBytes();
  if (storageUsed >= MAX_STORAGE_BYTES) {
    console.error(`[recording] Storage full: ${(storageUsed / 1e9).toFixed(1)}GB / ${RECORDING_MAX_STORAGE_GB}GB`);
    return null;
  }

  // Check if already recording
  const existingRecordings = recordingStore.get(roomId) ?? [];
  const activeRecording = existingRecordings.find((r) => r.status === 'recording');
  if (activeRecording) {
    console.warn(`[recording] Room ${roomId} is already recording (egress: ${activeRecording.id})`);
    return activeRecording;
  }

  try {
    // Build file output path
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-');
    const fileName = `meeting-${roomId}-${timestamp}.mp4`;
    const filePath = path.join(RECORDING_STORAGE_PATH, fileName);

    // Ensure storage directory exists
    fs.mkdirSync(RECORDING_STORAGE_PATH, { recursive: true });

    const result = await client.startRoomCompositeEgress(
      roomId,
      {
        fileType: EncodedFileType.MP4,
        filepath: filePath,
        disableManifest: true,
      },
      {
        layout: 'grid',
        audioCodec: AudioCodec.OPUS,
      }
    );

    const recording: Recording = {
      id: result.egressId,
      roomId,
      startedAt: Date.now(),
      status: 'recording',
    };

    // Track the recording
    existingRecordings.push(recording);
    recordingStore.set(roomId, existingRecordings);
    egressToRoom.set(result.egressId, roomId);

    console.log(`[recording] Started recording ${result.egressId} for room ${roomId} → ${fileName}`);
    return recording;
  } catch (err) {
    console.error(`[recording] Failed to start recording for room ${roomId}:`, err);
    return null;
  }
}

/**
 * Stop an active recording for a room.
 * Returns the final Recording object, or null if no active recording.
 * Also persists the recording metadata to PostgreSQL for historical tracking.
 */
export async function stopRecording(roomId: string, userId?: string): Promise<Recording | null> {
  const client = getEgressClient();
  if (!client) return null;

  const existingRecordings = recordingStore.get(roomId) ?? [];
  const activeRecordingIdx = existingRecordings.findIndex((r) => r.status === 'recording');
  if (activeRecordingIdx === -1) {
    console.warn(`[recording] No active recording found for room ${roomId}`);
    return null;
  }

  const recording = existingRecordings[activeRecordingIdx]!;

  try {
    await client.stopEgress(recording.id);

    // Update recording state
    recording.status = 'completed';
    recording.stoppedAt = Date.now();
    recording.durationMs = recording.stoppedAt - recording.startedAt;

    // Try to get file info from the egress result
    try {
      const egressInfo = await client.listEgress({ roomName: roomId });
      const completed = egressInfo.find((e) => e.egressId === recording.id);
      if (completed?.file?.length) {
        recording.filePath = completed.file[0]?.filename ?? recording.filePath;
        recording.fileSize = completed.file[0]?.size;
      }
    } catch {
      // Non-critical — file info is best-effort
    }

    existingRecordings[activeRecordingIdx] = recording;
    recordingStore.set(roomId, existingRecordings);
    egressToRoom.delete(recording.id);

    // Persist to PostgreSQL for cross-session history
    try {
      await saveRecordingToDatabase(recording, userId);
    } catch (dbErr) {
      console.error('[recording] Failed to persist recording to database (non-fatal):', dbErr);
    }

    console.log(`[recording] Stopped recording ${recording.id} for room ${roomId} (duration: ${recording.durationMs}ms)`);
    return recording;
  } catch (err) {
    console.error(`[recording] Failed to stop recording for room ${roomId}:`, err);
    // Mark as failed but still stop
    recording.status = 'failed';
    recording.stoppedAt = Date.now();
    existingRecordings[activeRecordingIdx] = recording;
    recordingStore.set(roomId, existingRecordings);
    
    // Persist failed recording state too
    try {
      await saveRecordingToDatabase(recording, userId);
    } catch { /* ignore */ }
    
    return recording;
  }
}

/**
 * Get all recordings for a room.
 * Merges in-memory (active) recordings with database (historical) recordings.
 */
export async function getRecordings(roomId: string): Promise<Recording[]> {
  // Get in-memory recordings (active/completed this session)
  const memoryRecordings = recordingStore.get(roomId) ?? [];

  // Also fetch from database for persisted history
  try {
    const dbRecordings = await prisma.recording.findMany({
      where: { roomId },
      orderBy: { startedAt: 'desc' },
    });

    // Merge: prefer in-memory for active recordings (more up-to-date),
    // but include DB records that might not be in memory (from previous sessions)
    const memoryIds = new Set(memoryRecordings.map((r) => r.id));
    const merged = [...memoryRecordings];

    for (const dbRec of dbRecordings) {
      if (!memoryIds.has(dbRec.id)) {
        merged.push({
          id: dbRec.id,
          roomId: dbRec.roomId,
          startedAt: dbRec.startedAt.getTime(),
          stoppedAt: dbRec.stoppedAt?.getTime(),
          durationMs: dbRec.durationMs ?? undefined,
          filePath: dbRec.filePath ?? undefined,
          fileSize: dbRec.fileSize ?? undefined,
          status: dbRec.status as Recording['status'],
        });
      }
    }

    return merged;
  } catch {
    // Fall back to in-memory only if DB is unavailable
    return memoryRecordings;
  }
}

/**
 * Save recording metadata to PostgreSQL.
 */
async function saveRecordingToDatabase(recording: Recording, userId?: string): Promise<void> {
  // If no userId provided, we can't link to an account — skip DB persistence
  if (!userId) {
    console.log('[recording] No userId — recording saved in-memory only');
    return;
  }

  await prisma.recording.upsert({
    where: { id: recording.id },
    update: {
      status: recording.status,
      filePath: recording.filePath ?? null,
      fileSize: recording.fileSize ?? null,
      durationMs: recording.durationMs ?? null,
      stoppedAt: recording.stoppedAt ? new Date(recording.stoppedAt) : null,
    },
    create: {
      id: recording.id,
      roomId: recording.roomId,
      userId,
      fileName: path.basename(recording.filePath ?? `meeting-${recording.roomId}.mp4`),
      filePath: recording.filePath ?? null,
      fileSize: recording.fileSize ?? null,
      durationMs: recording.durationMs ?? null,
      startedAt: new Date(recording.startedAt),
      stoppedAt: recording.stoppedAt ? new Date(recording.stoppedAt) : null,
      status: recording.status,
    },
  });

  console.log(`[recording] Persisted recording ${recording.id} to database`);
}

/**
 * Check if a room is currently recording.
 */
export function isRecording(roomId: string): boolean {
  const recordings = recordingStore.get(roomId) ?? [];
  return recordings.some((r) => r.status === 'recording');
}

/**
 * Get a recording by its egress ID.
 */
export function getRecordingByEgressId(egressId: string): Recording | null {
  const roomId = egressToRoom.get(egressId);
  if (!roomId) return null;
  const recordings = recordingStore.get(roomId) ?? [];
  return recordings.find((r) => r.id === egressId) ?? null;
}

// -----------------------------------------------------------
// Storage Management
// -----------------------------------------------------------

/**
 * Get total bytes used by recordings.
 */
function getStorageUsedBytes(): number {
  try {
    if (!fs.existsSync(RECORDING_STORAGE_PATH)) return 0;
    const files = fs.readdirSync(RECORDING_STORAGE_PATH);
    let total = 0;
    for (const file of files) {
      const filePath = path.join(RECORDING_STORAGE_PATH, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.isFile()) total += stat.size;
      } catch {
        // Skip files we can't stat
      }
    }
    return total;
  } catch {
    return 0;
  }
}

/**
 * Get storage usage info.
 */
export function getStorageInfo(): { usedGB: number; maxGB: number; usedPercent: number } {
  const usedBytes = getStorageUsedBytes();
  const usedGB = usedBytes / 1e9;
  return {
    usedGB: Math.round(usedGB * 100) / 100,
    maxGB: RECORDING_MAX_STORAGE_GB,
    usedPercent: Math.round((usedBytes / MAX_STORAGE_BYTES) * 100),
  };
}

// -----------------------------------------------------------
// Retention & Cleanup
// -----------------------------------------------------------

/**
 * Delete recording files that have expired beyond the retention period.
 * Runs on startup and periodically.
 */
function cleanupExpiredRecordings(): void {
  const now = Date.now();
  const retentionMs = RECORDING_RETENTION_DAYS * 24 * 60 * 60 * 1000;

  console.log(`[recording] Running retention cleanup (retention: ${RECORDING_RETENTION_DAYS} days)...`);
  let deletedCount = 0;

  for (const [roomId, recordings] of recordingStore) {
    const remaining = recordings.filter((r) => {
      if (r.status === 'recording') return true; // Don't clean active recordings
      if (r.stoppedAt && (now - r.stoppedAt) < retentionMs) return true; // Still within retention

      // Expired — delete file if exists
      if (r.filePath) {
        try {
          if (fs.existsSync(r.filePath)) {
            fs.unlinkSync(r.filePath);
            deletedCount++;
          }
        } catch (err) {
          console.warn(`[recording] Failed to delete expired recording ${r.id}:`, err);
        }
      }
      return false;
    });

    if (remaining.length !== recordings.length) {
      recordingStore.set(roomId, remaining);
    }
  }

  if (deletedCount > 0) {
    console.log(`[recording] Cleaned up ${deletedCount} expired recording(s)`);
  }
}

// Run cleanup on startup
cleanupExpiredRecordings();

// Run cleanup every hour
setInterval(cleanupExpiredRecordings, 60 * 60 * 1000).unref();
