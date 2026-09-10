'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ThemeToggle } from '@/components/ThemeToggle';
import { CreateMeetingForm } from '@/components/CreateMeetingForm';
import { JoinMeetingForm } from '@/components/JoinMeetingForm';
import { UserMenu } from '@/components/UserMenu';
import { AppLogo } from '@/components/AppLogo';

export default function HomePage() {
  const router = useRouter();
  const [view, setView] = useState<'home' | 'create' | 'join'>('home');

  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700 sm:px-6">
        <div className="flex items-center gap-2">
          <AppLogo className="h-8 w-8" />
          <span className="text-lg font-semibold text-slate-900 dark:text-white">Jehydro Meet</span>
        </div>
        <div className="flex items-center gap-3">
          <UserMenu />
          <ThemeToggle />
        </div>
      </header>

      {/* Main Content */}
      <main className="flex flex-1 items-center justify-center px-4 py-12 sm:px-6">
        {view === 'home' && (
          <div className="w-full max-w-md animate-fade-in">
            {/* Hero */}
            <div className="mb-8 text-center">
              <AppLogo className="mx-auto mb-4 h-16 w-16 drop-shadow-lg" />
              <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-4xl">
                Video meetings, <br />
                <span className="text-brand-600 dark:text-brand-400">instantly</span>
              </h1>
              <p className="mt-3 text-base text-slate-500 dark:text-slate-400">
                No accounts. No installs. Just share a link and meet.
              </p>
            </div>

            {/* Action Buttons */}
            <div className="space-y-3">
              <button onClick={() => setView('create')} className="btn-primary w-full py-3 text-base">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="mr-2 h-5 w-5"
                >
                  <path
                    fillRule="evenodd"
                    d="M12 3.75a.75.75 0 01.75.75v6.75h6.75a.75.75 0 010 1.5h-6.75v6.75a.75.75 0 01-1.5 0v-6.75H5.25a.75.75 0 010-1.5h6.75V4.5a.75.75 0 01.75-.75z"
                    clipRule="evenodd"
                  />
                </svg>
                Create Meeting
              </button>
              <button
                onClick={() => setView('join')}
                className="btn-secondary w-full py-3 text-base"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="mr-2 h-5 w-5"
                >
                  <path
                    fillRule="evenodd"
                    d="M12.97 3.97a.75.75 0 011.06 0l7.5 7.5a.75.75 0 010 1.06l-7.5 7.5a.75.75 0 11-1.06-1.06l6.22-6.22H3a.75.75 0 010-1.5h16.19l-6.22-6.22a.75.75 0 010-1.06z"
                    clipRule="evenodd"
                  />
                </svg>
                Join a Meeting
              </button>
            </div>
          </div>
        )}

        {view === 'create' && (
          <div className="w-full max-w-md animate-slide-up">
            <button
              onClick={() => setView('home')}
              className="btn-ghost mb-4 -ml-2 text-sm text-slate-500 dark:text-slate-400"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="mr-1 h-4 w-4"
              >
                <path
                  fillRule="evenodd"
                  d="M7.72 12.53a.75.75 0 010-1.06l7.5-7.5a.75.75 0 111.06 1.06L9.31 12l6.97 6.97a.75.75 0 11-1.06 1.06l-7.5-7.5z"
                  clipRule="evenodd"
                />
              </svg>
              Back
            </button>
            <CreateMeetingForm onCreated={(roomId) => router.push(`/meet/${roomId}`)} />
          </div>
        )}

        {view === 'join' && (
          <div className="w-full max-w-md animate-slide-up">
            <button
              onClick={() => setView('home')}
              className="btn-ghost mb-4 -ml-2 text-sm text-slate-500 dark:text-slate-400"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="mr-1 h-4 w-4"
              >
                <path
                  fillRule="evenodd"
                  d="M7.72 12.53a.75.75 0 010-1.06l7.5-7.5a.75.75 0 111.06 1.06L9.31 12l6.97 6.97a.75.75 0 11-1.06 1.06l-7.5-7.5z"
                  clipRule="evenodd"
                />
              </svg>
              Back
            </button>
            <JoinMeetingForm />
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 px-4 py-4 text-center text-xs text-slate-400 dark:border-slate-700 dark:text-slate-500">
        Jehydro Meet &mdash; Open source video conferencing
      </footer>
    </div>
  );
}
