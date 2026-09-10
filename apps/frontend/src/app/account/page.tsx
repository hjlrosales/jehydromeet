'use client';

/**
 * Account Dashboard — Shows user profile, meeting history,
 * scheduled meetings, recordings, and file sharing.
 *
 * Accessible only to signed-in users.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { ThemeToggle } from '@/components/ThemeToggle';
import { AppLogo } from '@/components/AppLogo';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000';

// -----------------------------------------------------------
// Types
// -----------------------------------------------------------

interface MeetingHistoryEntry {
  id: string;
  roomId: string;
  role: 'host' | 'participant';
  mediaMode: string;
  participantCount: number;
  durationMs: number | null;
  joinedAt: string;
  leftAt: string | null;
}

interface ScheduledMeeting {
  id: string;
  roomId: string;
  title: string;
  description: string | null;
  mediaMode: string;
  scheduledAt: string;
  durationMin: number | null;
  icsToken: string | null;
}

// -----------------------------------------------------------
// Page
// -----------------------------------------------------------

export default function AccountPage() {
  const { user, isAuthenticated, isLoading, openAuthModal } = useAuth();
  const router = useRouter();

  const [history, setHistory] = useState<MeetingHistoryEntry[]>([]);
  const [upcoming, setUpcoming] = useState<ScheduledMeeting[]>([]);
  const [activeTab, setActiveTab] = useState<'history' | 'scheduled' | 'recordings'>('history');
  const [scheduleFormOpen, setScheduleFormOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null);

  // Redirect if not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      openAuthModal('signin');
    }
  }, [isLoading, isAuthenticated, openAuthModal]);

  const token = typeof window !== 'undefined' ? localStorage.getItem('jehydro-jwt') : null;

  // Fetch meeting history
  const fetchHistory = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/meetings/history`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setHistory(data.history);
      }
    } catch {
      // Silently fail
    }
  }, [token]);

  // Fetch upcoming meetings
  const fetchUpcoming = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/meetings/upcoming`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setUpcoming(data.meetings);
      }
    } catch {
      // Silently fail
    }
  }, [token]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchHistory();
      fetchUpcoming();
    }
  }, [isAuthenticated, fetchHistory, fetchUpcoming]);

  // Delete scheduled meeting
  const deleteMeeting = useCallback(async (id: string) => {
    if (!token) return;
    setDeleteLoading(id);
    try {
      await fetch(`${BACKEND_URL}/api/meetings/schedule/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchUpcoming();
    } catch {
      // Silently fail
    } finally {
      setDeleteLoading(null);
    }
  }, [token, fetchUpcoming]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white dark:bg-slate-900">
        <svg className="h-8 w-8 animate-spin text-brand-500" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-white dark:bg-slate-900">
        <p className="text-slate-500 dark:text-slate-400">Redirecting to sign in...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700 sm:px-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/')}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
              <path fillRule="evenodd" d="M7.72 12.53a.75.75 0 010-1.06l7.5-7.5a.75.75 0 111.06 1.06L9.31 12l6.97 6.97a.75.75 0 11-1.06 1.06l-7.5-7.5z" clipRule="evenodd" />
            </svg>
            Back
          </button>
          <div className="flex items-center gap-2">
            <AppLogo className="h-8 w-8" />
            <span className="text-lg font-semibold text-slate-900 dark:text-white">My Account</span>
          </div>
        </div>
        <ThemeToggle />
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        {/* Profile Card */}
        <div className="mb-8 rounded-2xl border border-slate-200 bg-slate-50 p-6 dark:border-slate-700 dark:bg-slate-800/50">
          <div className="flex items-start gap-4">
            <div
              className="flex h-16 w-16 items-center justify-center rounded-full text-2xl font-bold text-white shadow-lg"
              style={{
                background: `linear-gradient(135deg, hsl(${hashCode(user!.id) % 360}, 65%, 55%), hsl(${(hashCode(user!.id) + 40) % 360}, 65%, 45%))`,
              }}
            >
              {user!.displayName.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{user!.displayName}</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">{user!.email}</p>
              <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-500 dark:text-slate-400">
                <span>Joined {new Date(user!.createdAt).toLocaleDateString()}</span>
                <span className="font-medium text-brand-600 dark:text-brand-400">{user!.meetingCount} meetings</span>
                {user!.recordingCount > 0 && (
                  <span className="font-medium text-emerald-600 dark:text-emerald-400">{user!.recordingCount} recordings</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="mb-6 flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
          {[
            { key: 'history', label: 'Meeting History' },
            { key: 'scheduled', label: `Scheduled (${upcoming.length})` },
            { key: 'recordings', label: 'Recordings' },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as typeof activeTab)}
              className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
                activeTab === tab.key
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="space-y-4">
          {/* Meeting History */}
          {activeTab === 'history' && (
            <div>
              {history.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 p-12 text-center dark:border-slate-600">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="mx-auto mb-3 h-10 w-10 text-slate-300 dark:text-slate-600">
                    <path d="M4.5 6.375a4.125 4.125 0 118.25 0 4.125 4.125 0 01-8.25 0zM14.25 8.625a3.375 3.375 0 116.75 0 3.375 3.375 0 01-6.75 0zM1.5 19.125a7.125 7.125 0 0114.25 0v.003l-.001.119a.75.75 0 01-.363.63 13.067 13.067 0 01-6.761 1.873c-2.472 0-4.786-.684-6.76-1.873a.75.75 0 01-.364-.63l-.001-.122zM17.25 19.128l-.001.144a2.25 2.25 0 01-.233.96 10.088 10.088 0 005.06-1.01.75.75 0 00.42-.643 4.875 4.875 0 00-6.957-4.611 8.586 8.586 0 011.71 5.157v.003z" />
                  </svg>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    No meeting history yet. Your meetings will appear here.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {history.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                          entry.role === 'host'
                            ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400'
                            : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
                        }`}>
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
                            <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-900 dark:text-white">
                            Room {entry.roomId}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {new Date(entry.joinedAt).toLocaleDateString()} —{' '}
                            {entry.role === 'host' ? 'Hosted' : 'Joined'} · {entry.participantCount} participant{entry.participantCount !== 1 ? 's' : ''}
                            {entry.durationMs ? ` · ${Math.round(entry.durationMs / 60000)} min` : ''}
                          </p>
                        </div>
                      </div>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        entry.role === 'host'
                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                          : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400'
                      }`}>
                        {entry.role === 'host' ? 'Host' : 'Joined'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Scheduled Meetings */}
          {activeTab === 'scheduled' && (
            <div>
              {/* Schedule Button */}
              <button
                onClick={() => setScheduleFormOpen(!scheduleFormOpen)}
                className="btn-primary mb-4 w-full py-2.5 text-sm"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="mr-1.5 inline h-4 w-4">
                  <path d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zM12.75 9a.75.75 0 00-1.5 0v2.25H9a.75.75 0 000 1.5h2.25V15a.75.75 0 001.5 0v-2.25H15a.75.75 0 000-1.5h-2.25V9z" />
                </svg>
                {scheduleFormOpen ? 'Close' : 'Schedule a Meeting'}
              </button>

              {scheduleFormOpen && (
                <ScheduleMeetingForm
                  token={token!}
                  onCreated={() => { fetchUpcoming(); setScheduleFormOpen(false); }}
                />
              )}

              {upcoming.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 p-12 text-center dark:border-slate-600">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="mx-auto mb-3 h-10 w-10 text-slate-300 dark:text-slate-600">
                    <path fillRule="evenodd" d="M6.75 2.25A.75.75 0 017.5 3v1.5h9V3A.75.75 0 0118 3v1.5h.75a3 3 0 013 3v11.25a3 3 0 01-3 3H5.25a3 3 0 01-3-3V7.5a3 3 0 013-3H6V3a.75.75 0 01.75-.75zm13.5 9a1.5 1.5 0 00-1.5-1.5H5.25a1.5 1.5 0 00-1.5 1.5v7.5a1.5 1.5 0 001.5 1.5h13.5a1.5 1.5 0 001.5-1.5v-7.5z" clipRule="evenodd" />
                  </svg>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    No upcoming meetings scheduled.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {upcoming.map((meeting) => (
                    <div
                      key={meeting.id}
                      className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="font-medium text-slate-900 dark:text-white">{meeting.title}</h3>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            {new Date(meeting.scheduledAt).toLocaleDateString(undefined, {
                              weekday: 'long',
                              year: 'numeric',
                              month: 'long',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                            {meeting.durationMin ? ` · ${meeting.durationMin} min` : ''}
                          </p>
                          {meeting.description && (
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{meeting.description}</p>
                          )}
                          <p className="mt-1 text-xs font-mono text-slate-400">
                            {meeting.roomId} · {meeting.mediaMode.toUpperCase()}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {meeting.icsToken && (
                            <a
                              href={`${BACKEND_URL}/api/meetings/ics/${meeting.icsToken}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
                              title="Download ICS for calendar"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                                <path d="M10.75 2.75a.75.75 0 00-1.5 0v8.614L6.295 8.235a.75.75 0 10-1.09 1.03l4.25 4.5a.75.75 0 001.09 0l4.25-4.5a.75.75 0 00-1.09-1.03l-2.955 3.129V2.75z" />
                                <path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" />
                              </svg>
                              ICS
                            </a>
                          )}
                          <button
                            onClick={() => deleteMeeting(meeting.id)}
                            disabled={deleteLoading === meeting.id}
                            className="flex items-center gap-1 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-100 disabled:opacity-50 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30"
                          >
                            {deleteLoading === meeting.id ? '...' : 'Cancel'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Recordings */}
          {activeTab === 'recordings' && (
            <div className="rounded-xl border border-dashed border-slate-300 p-12 text-center dark:border-slate-600">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="mx-auto mb-3 h-10 w-10 text-slate-300 dark:text-slate-600">
                <path d="M2 3.5A1.5 1.5 0 013.5 2h9A1.5 1.5 0 0114 3.5v11.75A2.75 2.75 0 0016.75 18h-12A2.75 2.75 0 012 15.25V3.5z" />
                <path d="M3 3.5a.5.5 0 01.5-.5h9a.5.5 0 01.5.5v.5H3v-.5z" />
              </svg>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Cloud recordings will be linked to your account after you record an SFU meeting.
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

// -----------------------------------------------------------
// Schedule Meeting Form
// -----------------------------------------------------------

function ScheduleMeetingForm({ token, onCreated }: { token: string; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [durationMin, setDurationMin] = useState(60);
  const [mediaMode, setMediaMode] = useState<'mesh' | 'sfu'>('mesh');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!title.trim()) { setError('Title is required.'); return; }
    if (!scheduledDate || !scheduledTime) { setError('Date and time are required.'); return; }

    const scheduledAt = `${scheduledDate}T${scheduledTime}:00`;

    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/meetings/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          scheduledAt,
          durationMin,
          mediaMode,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to schedule meeting.');
      } else {
        onCreated();
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mb-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
      <h3 className="mb-4 text-sm font-semibold text-slate-900 dark:text-white">Schedule a Meeting</h3>

      {error && (
        <div className="mb-3 rounded-lg bg-red-50 p-2.5 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-400">
          {error}
        </div>
      )}

      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Title</label>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className="input-field text-sm" maxLength={200} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Description (optional)</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="input-field text-sm" rows={2} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Date</label>
            <input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} className="input-field text-sm" min={new Date().toISOString().split('T')[0]} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Time</label>
            <input type="time" value={scheduledTime} onChange={(e) => setScheduledTime(e.target.value)} className="input-field text-sm" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Duration (min)</label>
            <select value={durationMin} onChange={(e) => setDurationMin(parseInt(e.target.value))} className="input-field text-sm">
              <option value={15}>15 min</option>
              <option value={30}>30 min</option>
              <option value={60}>1 hour</option>
              <option value={90}>1.5 hours</option>
              <option value={120}>2 hours</option>
              <option value={480}>8 hours</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Meeting type</label>
            <select value={mediaMode} onChange={(e) => setMediaMode(e.target.value as 'mesh' | 'sfu')} className="input-field text-sm">
              <option value="mesh">Mesh (up to 8 people)</option>
              <option value="sfu">SFU (9+ people)</option>
            </select>
          </div>
        </div>
        <button type="submit" disabled={loading} className="btn-primary w-full py-2 text-sm">
          {loading ? 'Scheduling...' : 'Schedule Meeting'}
        </button>
      </div>
    </form>
  );
}

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash);
}
