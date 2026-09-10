'use client';

/**
 * Auth Modal — Sign up, sign in, and magic link UI.
 * Renders as a centered overlay modal.
 */

import { useState, useCallback, type FormEvent } from 'react';
import { useAuth } from '@/context/AuthContext';

export function AuthModal() {
  const {
    authModal,
    closeAuthModal,
    signin,
    signup,
    requestMagicLink,
  } = useAuth();

  const [mode, setMode] = useState<'signin' | 'signup' | 'magic-link'>(authModal === 'signup' ? 'signup' : 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    if (!email.trim()) {
      setError('Email is required.');
      return;
    }

    setLoading(true);

    try {
      if (mode === 'magic-link') {
        const err = await requestMagicLink(email.trim());
        if (err) {
          setError(err);
        } else {
          setSuccessMessage('Check the server logs for your magic link (dev mode).');
        }
      } else if (mode === 'signup') {
        if (!displayName.trim()) {
          setError('Display name is required.');
          setLoading(false);
          return;
        }
        if (password.length < 8) {
          setError('Password must be at least 8 characters.');
          setLoading(false);
          return;
        }
        const err = await signup(email.trim(), password, displayName.trim());
        if (err) setError(err);
      } else {
        if (!password) {
          setError('Password is required.');
          setLoading(false);
          return;
        }
        const err = await signin(email.trim(), password);
        if (err) setError(err);
      }
    } catch {
      setError('An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  }, [mode, email, password, displayName, signin, signup, requestMagicLink]);

  // Sync mode with authModal prop
  if (authModal === 'none') return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={closeAuthModal}>
      <div
        className="mx-4 w-full max-w-md animate-fade-in rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-800"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
            {mode === 'signup' ? 'Create Account' : mode === 'magic-link' ? 'Sign in with Email' : 'Sign In'}
          </h2>
          <button
            onClick={closeAuthModal}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
              <path fillRule="evenodd" d="M5.47 5.47a.75.75 0 011.06 0L12 10.94l5.47-5.47a.75.75 0 111.06 1.06L13.06 12l5.47 5.47a.75.75 0 11-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 01-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 010-1.06z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {/* Error message */}
        {error && (
          <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Success message (magic link) */}
        {successMessage && (
          <div className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
            {successMessage}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'signup' && (
            <div>
              <label htmlFor="auth-name" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Display name
              </label>
              <input
                id="auth-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your display name"
                className="input-field"
                maxLength={40}
                autoFocus={mode === 'signup'}
              />
            </div>
          )}

          <div>
            <label htmlFor="auth-email" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Email
            </label>
            <input
              id="auth-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="input-field"
              autoFocus={mode !== 'signup'}
            />
          </div>

          {mode !== 'magic-link' && (
            <div>
              <label htmlFor="auth-password" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Password
              </label>
              <input
                id="auth-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
                className="input-field"
                minLength={8}
              />
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full py-2.5 text-sm"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {mode === 'signup' ? 'Creating account...' : mode === 'magic-link' ? 'Sending link...' : 'Signing in...'}
              </span>
            ) : (
              mode === 'signup' ? 'Create Account' : mode === 'magic-link' ? 'Send Magic Link' : 'Sign In'
            )}
          </button>
        </form>

        {/* Mode switcher */}
        <div className="mt-4 space-y-2 text-center text-xs text-slate-500 dark:text-slate-400">
          {mode === 'signin' && (
            <>
              <button onClick={() => { setMode('magic-link'); setError(null); setSuccessMessage(null); }} className="text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300">
                Sign in with magic link instead
              </button>
              <div>
                Don&apos;t have an account?{' '}
                <button onClick={() => { setMode('signup'); setError(null); setSuccessMessage(null); }} className="font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300">
                  Sign up
                </button>
              </div>
            </>
          )}
          {mode === 'signup' && (
            <div>
              Already have an account?{' '}
              <button onClick={() => { setMode('signin'); setError(null); setSuccessMessage(null); }} className="font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300">
                Sign in
              </button>
            </div>
          )}
          {mode === 'magic-link' && (
            <button onClick={() => { setMode('signin'); setError(null); setSuccessMessage(null); }} className="text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300">
              Sign in with password instead
            </button>
          )}
        </div>

        {/* Guest disclaimer */}
        <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-500 dark:bg-slate-700/50 dark:text-slate-400">
          <strong>No account needed to join meetings.</strong> Accounts are optional and provide meeting history, scheduled meetings, and file sharing.
        </div>
      </div>
    </div>
  );
}
