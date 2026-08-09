'use client';

/**
 * Auth Context — Provides authentication state across the app.
 *
 * Stores the JWT token in localStorage and provides:
 * - user: current user profile or null
 * - isAuthenticated: boolean
 * - signin, signup, logout functions
 * - AuthModal open/control
 */

import { createContext, useContext, useCallback, useEffect, useState, type ReactNode } from 'react';

// -----------------------------------------------------------
// Types
// -----------------------------------------------------------

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: string;
  signedInAt: string | null;
  meetingCount: number;
  recordingCount: number;
}

interface AuthContextValue {
  user: UserProfile | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  authModal: 'none' | 'signin' | 'signup' | 'magic-link';
  openAuthModal: (mode?: 'signin' | 'signup' | 'magic-link') => void;
  closeAuthModal: () => void;
  signin: (email: string, password: string) => Promise<string | null>;
  signup: (email: string, password: string, displayName: string) => Promise<string | null>;
  requestMagicLink: (email: string) => Promise<string | null>;
  verifyMagicLink: (token: string) => Promise<string | null>;
  logout: () => void;
  refreshProfile: () => Promise<void>;
}

// -----------------------------------------------------------
// Context
// -----------------------------------------------------------

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000';

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

// -----------------------------------------------------------
// Provider
// -----------------------------------------------------------

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authModal, setAuthModal] = useState<'none' | 'signin' | 'signup' | 'magic-link'>('none');

  // Load user from stored token on mount
  useEffect(() => {
    const token = localStorage.getItem('jehydro-jwt');
    if (token) {
      fetchProfile(token).then((profile) => {
        if (profile) {
          setUser(profile);
        } else {
          localStorage.removeItem('jehydro-jwt');
        }
        setIsLoading(false);
      });
    } else {
      setIsLoading(false);
    }
  }, []);

  // Fetch user profile
  async function fetchProfile(token: string): Promise<UserProfile | null> {
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data.authenticated) return null;
      return data.user;
    } catch {
      return null;
    }
  }

  // Store JWT and fetch profile
  function handleAuthSuccess(token: string) {
    localStorage.setItem('jehydro-jwt', token);
    fetchProfile(token).then((profile) => {
      if (profile) setUser(profile);
    });
    setAuthModal('none');
  }

  // Sign in
  const signin = useCallback(async (email: string, password: string): Promise<string | null> => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) return data.error ?? 'Sign in failed';
      handleAuthSuccess(data.token);
      return null;
    } catch {
      return 'Network error. Please try again.';
    }
  }, []);

  // Sign up
  const signup = useCallback(async (email: string, password: string, displayName: string): Promise<string | null> => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, displayName }),
      });
      const data = await res.json();
      if (!res.ok) return data.error ?? 'Sign up failed';
      handleAuthSuccess(data.token);
      return null;
    } catch {
      return 'Network error. Please try again.';
    }
  }, []);

  // Request magic link
  const requestMagicLink = useCallback(async (email: string): Promise<string | null> => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/magic-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) return data.error ?? 'Failed to send magic link';
      return null;
    } catch {
      return 'Network error. Please try again.';
    }
  }, []);

  // Verify magic link
  const verifyMagicLink = useCallback(async (token: string): Promise<string | null> => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) return data.error ?? 'Verification failed';
      handleAuthSuccess(data.token);
      return null;
    } catch {
      return 'Network error. Please try again.';
    }
  }, []);

  // Logout
  const logout = useCallback(() => {
    localStorage.removeItem('jehydro-jwt');
    setUser(null);
    setAuthModal('none');
  }, []);

  // Refresh profile
  const refreshProfile = useCallback(async () => {
    const token = localStorage.getItem('jehydro-jwt');
    if (!token) return;
    const profile = await fetchProfile(token);
    if (profile) setUser(profile);
  }, []);

  // Open auth modal
  const openAuthModal = useCallback((mode: 'signin' | 'signup' | 'magic-link' = 'signin') => {
    setAuthModal(mode);
  }, []);

  const closeAuthModal = useCallback(() => {
    setAuthModal('none');
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        authModal,
        openAuthModal,
        closeAuthModal,
        signin,
        signup,
        requestMagicLink,
        verifyMagicLink,
        logout,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
