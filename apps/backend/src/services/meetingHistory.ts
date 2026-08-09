/**
 * Meeting History Service
 *
 * Tracks rooms that signed-in users create and join.
 * Also manages scheduled meetings.
 *
 * History is written after a meeting ends (when the user leaves).
 */

import crypto from 'crypto';
import prisma from './db';

// -----------------------------------------------------------
// Meeting History
// -----------------------------------------------------------

export interface MeetingHistoryEntry {
  id: string;
  roomId: string;
  role: 'host' | 'participant';
  mediaMode: string;
  participantCount: number;
  durationMs: number | null;
  joinedAt: Date;
  leftAt: Date | null;
}

/**
 * Record a meeting join for a signed-in user.
 */
export async function recordMeetingJoin(
  userId: string,
  roomId: string,
  role: 'host' | 'participant',
  mediaMode: string,
  participantCount: number
): Promise<string> {
  try {
    const entry = await prisma.meetingHistory.create({
      data: {
        userId,
        roomId,
        role,
        mediaMode,
        participantCount,
        joinedAt: new Date(),
      },
    });
    return entry.id;
  } catch (err) {
    console.error('[meetingHistory] Error recording join:', err);
    return '';
  }
}

/**
 * Record a meeting leave (updates duration).
 */
export async function recordMeetingLeave(
  historyId: string
): Promise<void> {
  try {
    if (!historyId) return;
    await prisma.meetingHistory.update({
      where: { id: historyId },
      data: { leftAt: new Date() },
    });
  } catch (err) {
    console.error('[meetingHistory] Error recording leave:', err);
  }
}

/**
 * Get meeting history for a user.
 */
export async function getUserMeetingHistory(
  userId: string,
  limit: number = 20,
  offset: number = 0
): Promise<MeetingHistoryEntry[]> {
  try {
    const entries = await prisma.meetingHistory.findMany({
      where: { userId },
      orderBy: { joinedAt: 'desc' },
      take: limit,
      skip: offset,
    });

    return entries.map((e) => ({
      id: e.id,
      roomId: e.roomId,
      role: e.role as 'host' | 'participant',
      mediaMode: e.mediaMode,
      participantCount: e.participantCount,
      durationMs: e.durationMs ?? null,
      joinedAt: e.joinedAt,
      leftAt: e.leftAt ?? null,
    }));
  } catch (err) {
    console.error('[meetingHistory] Error fetching history:', err);
    return [];
  }
}

// -----------------------------------------------------------
// Scheduled Meetings
// -----------------------------------------------------------

export interface ScheduledMeetingData {
  id: string;
  roomId: string;
  title: string;
  description: string | null;
  mediaMode: string;
  scheduledAt: Date;
  durationMin: number | null;
  icsToken: string | null;
}

/**
 * Create a scheduled meeting.
 */
export async function createScheduledMeeting(
  userId: string,
  data: {
    roomId: string;
    title: string;
    description?: string;
    mediaMode?: string;
    scheduledAt: Date;
    durationMin?: number;
  }
): Promise<ScheduledMeetingData | null> {
  try {
    const meeting = await prisma.scheduledMeeting.create({
      data: {
        userId,
        roomId: data.roomId,
        title: data.title,
        description: data.description ?? null,
        mediaMode: data.mediaMode ?? 'mesh',
        scheduledAt: data.scheduledAt,
        durationMin: data.durationMin ?? 60,
        icsToken: cryptoRandomToken(), // generated for ICS download
      },
    });

    return {
      id: meeting.id,
      roomId: meeting.roomId,
      title: meeting.title,
      description: meeting.description,
      mediaMode: meeting.mediaMode,
      scheduledAt: meeting.scheduledAt,
      durationMin: meeting.durationMin,
      icsToken: meeting.icsToken,
    };
  } catch (err) {
    console.error('[meetingHistory] Error creating scheduled meeting:', err);
    return null;
  }
}

/**
 * Get upcoming scheduled meetings for a user.
 */
export async function getUpcomingMeetings(
  userId: string,
  limit: number = 10
): Promise<ScheduledMeetingData[]> {
  try {
    const meetings = await prisma.scheduledMeeting.findMany({
      where: {
        userId,
        scheduledAt: { gte: new Date() },
      },
      orderBy: { scheduledAt: 'asc' },
      take: limit,
    });

    return meetings.map((m) => ({
      id: m.id,
      roomId: m.roomId,
      title: m.title,
      description: m.description,
      mediaMode: m.mediaMode,
      scheduledAt: m.scheduledAt,
      durationMin: m.durationMin,
      icsToken: m.icsToken,
    }));
  } catch (err) {
    console.error('[meetingHistory] Error fetching upcoming meetings:', err);
    return [];
  }
}

/**
 * Delete a scheduled meeting.
 */
export async function deleteScheduledMeeting(
  meetingId: string,
  userId: string
): Promise<boolean> {
  try {
    const meeting = await prisma.scheduledMeeting.findFirst({
      where: { id: meetingId, userId },
    });
    if (!meeting) return false;

    await prisma.scheduledMeeting.delete({ where: { id: meetingId } });
    return true;
  } catch (err) {
    console.error('[meetingHistory] Error deleting scheduled meeting:', err);
    return false;
  }
}

/**
 * Get a scheduled meeting by ICS token (public, no auth needed).
 */
export async function getMeetingByIcsToken(
  icsToken: string
): Promise<ScheduledMeetingData | null> {
  try {
    const meeting = await prisma.scheduledMeeting.findUnique({
      where: { icsToken },
    });
    if (!meeting) return null;

    return {
      id: meeting.id,
      roomId: meeting.roomId,
      title: meeting.title,
      description: meeting.description,
      mediaMode: meeting.mediaMode,
      scheduledAt: meeting.scheduledAt,
      durationMin: meeting.durationMin,
      icsToken: meeting.icsToken,
    };
  } catch (err) {
    console.error('[meetingHistory] Error getting meeting by ICS token:', err);
    return null;
  }
}

/**
 * Generate a cryptographically random token for ICS download URLs.
 */
function cryptoRandomToken(): string {
  return crypto.randomBytes(24).toString('hex');
}
