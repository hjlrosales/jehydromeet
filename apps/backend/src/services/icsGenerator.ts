/**
 * ICS (iCalendar) Generator
 *
 * Generates .ics file content for scheduled meetings so users can
 * add them to Google Calendar, Outlook, Apple Calendar, etc.
 *
 * Format: RFC 5545 iCalendar
 */

/**
 * Generate an ICS file string for a scheduled meeting.
 */
export function generateIcsFile(data: {
  title: string;
  description: string | null;
  roomId: string;
  hostName: string;
  scheduledAt: Date;
  durationMin: number;
}): string {
  const now = formatDate(new Date());
  const start = formatDate(data.scheduledAt);
  const end = formatDate(new Date(data.scheduledAt.getTime() + data.durationMin * 60 * 1000));

  const meetingUrl = `${process.env.CORS_ORIGIN ?? 'https://jehydro.com'}/meet/${data.roomId}`;
  const desc = data.description
    ? `${data.description}\\n\\nJoin link: ${meetingUrl}`
    : `Join link: ${meetingUrl}`;

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Jehydro Meet//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${data.roomId}@jehydro.com`,
    `DTSTAMP:${now}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${escapeText(data.title)}`,
    `DESCRIPTION:${escapeText(desc)}`,
    `LOCATION:${meetingUrl}`,
    `ORGANIZER;CN=${escapeText(data.hostName)}:mailto:noreply@jehydro.com`,
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'BEGIN:VALARM',
    'TRIGGER:-PT15M',
    'ACTION:DISPLAY',
    `DESCRIPTION:Reminder: ${escapeText(data.title)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

/**
 * Format a Date object to ICS-compatible datetime string (UTC).
 * Format: YYYYMMDDTHHMMSSZ
 */
function formatDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Escape special characters for ICS text fields.
 */
function escapeText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}
