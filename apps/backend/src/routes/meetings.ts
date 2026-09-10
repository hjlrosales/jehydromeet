/**
 * Meeting Routes
 *
 * GET    /api/meetings/history              — Get user's meeting history (auth)
 * POST   /api/meetings/schedule             — Schedule a meeting (auth)
 * GET    /api/meetings/upcoming             — Get upcoming scheduled meetings (auth)
 * DELETE /api/meetings/schedule/:id         — Delete a scheduled meeting (auth)
 * GET    /api/meetings/ics/:token           — Download ICS file for scheduled meeting (public)
 */

import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/auth';
import {
  getUserMeetingHistory,
  createScheduledMeeting,
  getUpcomingMeetings,
  deleteScheduledMeeting,
  getMeetingByIcsToken,
} from '../services/meetingHistory';
import { generateIcsFile } from '../services/icsGenerator';
import crypto from 'crypto';

export const meetingRouter: Router = Router();

// -----------------------------------------------------------
// GET /api/meetings/history — Get user's meeting history
// -----------------------------------------------------------
meetingRouter.get('/history', requireAuth, async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
  const offset = parseInt(req.query.offset as string) || 0;

  const history = await getUserMeetingHistory(req.user!.userId, limit, offset);
  res.json({ history });
});

// -----------------------------------------------------------
// POST /api/meetings/schedule — Create a scheduled meeting
// -----------------------------------------------------------
meetingRouter.post('/schedule', requireAuth, async (req: Request, res: Response) => {
  const { title, description, mediaMode, scheduledAt, durationMin } = req.body;

  if (!title || !title.trim()) {
    res.status(400).json({ error: 'Title is required.' });
    return;
  }

  if (!scheduledAt) {
    res.status(400).json({ error: 'Scheduled date/time is required.' });
    return;
  }

  const scheduledDate = new Date(scheduledAt);
  if (isNaN(scheduledDate.getTime()) || scheduledDate <= new Date()) {
    res.status(400).json({ error: 'Scheduled time must be in the future.' });
    return;
  }

  if (title.trim().length > 200) {
    res.status(400).json({ error: 'Title must be 200 characters or fewer.' });
    return;
  }

  // Generate a room ID for the scheduled meeting
  const ROOM_ID_LENGTH = 8;
  const ROOM_ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(ROOM_ID_LENGTH);
  let roomId = '';
  for (let i = 0; i < ROOM_ID_LENGTH; i++) {
    roomId += ROOM_ID_CHARS[bytes[i]! % ROOM_ID_CHARS.length];
  }

  const meeting = await createScheduledMeeting(req.user!.userId, {
    roomId,
    title: title.trim(),
    description: description?.trim(),
    mediaMode: mediaMode || 'mesh',
    scheduledAt: scheduledDate,
    durationMin: Math.min(Math.max(durationMin || 60, 15), 480), // 15min - 8hrs
  });

  if (!meeting) {
    res.status(500).json({ error: 'Failed to create scheduled meeting.' });
    return;
  }

  res.status(201).json(meeting);
});

// -----------------------------------------------------------
// GET /api/meetings/upcoming — Get upcoming scheduled meetings
// -----------------------------------------------------------
meetingRouter.get('/upcoming', requireAuth, async (req: Request, res: Response) => {
  const meetings = await getUpcomingMeetings(req.user!.userId);
  res.json({ meetings });
});

// -----------------------------------------------------------
// DELETE /api/meetings/schedule/:id — Delete a scheduled meeting
// -----------------------------------------------------------
meetingRouter.delete('/schedule/:id', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!id) {
    res.status(400).json({ error: 'Scheduled meeting ID is required.' });
    return;
  }

  const ok = await deleteScheduledMeeting(id, req.user!.userId);
  if (!ok) {
    res.status(404).json({ error: 'Scheduled meeting not found.' });
    return;
  }
  res.json({ success: true });
});

// -----------------------------------------------------------
// GET /api/meetings/ics/:token — Download ICS file (public, no auth)
// -----------------------------------------------------------
meetingRouter.get('/ics/:token', async (req: Request, res: Response) => {
  const { token } = req.params;
  if (!token) {
    res.status(400).json({ error: 'ICS token is required.' });
    return;
  }

  const meeting = await getMeetingByIcsToken(token);
  if (!meeting) {
    res.status(404).json({ error: 'Meeting not found.' });
    return;
  }

  const hostName = meeting.title; // fallback — actual host name stored separately

  const icsContent = generateIcsFile({
    title: meeting.title,
    description: meeting.description,
    roomId: meeting.roomId,
    hostName,
    scheduledAt: meeting.scheduledAt,
    durationMin: meeting.durationMin ?? 60,
  });

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="meeting-${meeting.roomId}.ics"`
  );
  res.send(icsContent);
});
