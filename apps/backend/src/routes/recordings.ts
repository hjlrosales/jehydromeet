/**
 * Recording Routes
 *
 * REST endpoints for listing and downloading meeting recordings.
 * Files are stored locally and served through the backend.
 *
 * GET    /api/recordings/my             — List user's recordings (auth)
 * GET    /api/recordings/:roomId       — List all recordings for a room
 * GET    /api/recordings/:roomId/:id   — Download a specific recording file
 * GET    /api/recordings/storage       — Get storage usage info
 */

import { Router, type Request, type Response } from 'express';
import { getRecordings, getStorageInfo } from '../services/recordingService';
import { requireAuth } from '../middleware/auth';
import prisma from '../services/db';
import fs from 'fs';

export const recordingRouter: Router = Router();

/**
 * GET /api/recordings/storage
 * Get recording storage usage info.
 */
recordingRouter.get('/storage', (_req: Request, res: Response) => {
  res.json(getStorageInfo());
});

/**
 * GET /api/recordings/my
 * Get user's recordings (auth required).
 */
recordingRouter.get('/my', requireAuth, async (req: Request, res: Response) => {
  try {
    const recordings = await prisma.recording.findMany({
      where: { userId: req.user!.userId },
      orderBy: { startedAt: 'desc' },
      take: 50,
    });
    res.json({ recordings });
  } catch (err) {
    console.error('[recordings] Error fetching user recordings:', err);
    res.status(500).json({ error: 'Failed to fetch recordings.' });
  }
});

/**
 * GET /api/recordings/:roomId
 * List all recordings for a room (completed only, not currently recording).
 */
recordingRouter.get('/:roomId', async (req: Request, res: Response) => {
  const { roomId } = req.params;
  if (!roomId) {
    res.status(400).json({ error: 'Room ID is required.' });
    return;
  }

  const recordings = (await getRecordings(roomId)).filter((r) => r.status !== 'recording');
  res.json({ roomId, recordings });
});

/**
 * GET /api/recordings/:roomId/download/:id
 * Download a specific recording file by its egress ID.
 */
recordingRouter.get('/:roomId/download/:id', async (req: Request, res: Response) => {
  const { roomId, id } = req.params;
  if (!roomId || !id) {
    res.status(400).json({ error: 'Room ID and recording ID are required.' });
    return;
  }

  const recordings = await getRecordings(roomId);
  const recording = recordings.find((r) => r.id === id);

  if (!recording) {
    res.status(404).json({ error: 'Recording not found' });
    return;
  }

  if (!recording.filePath) {
    res.status(404).json({ error: 'Recording file not available' });
    return;
  }

  // Check if file exists
  if (!fs.existsSync(recording.filePath)) {
    res.status(404).json({ error: 'Recording file has been deleted or expired' });
    return;
  }

  // Stream the file
  const fileName = `meeting-${roomId}-${new Date(recording.startedAt).toISOString().split('T')[0]}.mp4`;
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('Content-Type', 'video/mp4');
  
  const stream = fs.createReadStream(recording.filePath);
  stream.pipe(res);
});
