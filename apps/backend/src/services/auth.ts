/**
 * Authentication Service
 *
 * Handles:
 * - Email + password signup/signin (bcrypt-hashed)
 * - Magic link signin (token emailed, verified via endpoint)
 * - JWT token generation and verification
 * - Guest users (no auth required to join meetings)
 *
 * JWT payload: { userId, email, displayName, iat, exp }
 * Magic link tokens are stored in the AuthToken table with TTL.
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import prisma from './db';

// -----------------------------------------------------------
// Constants
// -----------------------------------------------------------

const JWT_SECRET = process.env.JWT_SECRET ?? crypto.randomBytes(64).toString('hex');
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? '30d';
const MAGIC_LINK_TTL_MS = 15 * 60 * 1000; // 15 minutes
const BCRYPT_ROUNDS = 12;

// -----------------------------------------------------------
// Types
// -----------------------------------------------------------

export interface AuthResult {
  user: {
    id: string;
    email: string;
    displayName: string;
    avatarUrl: string | null;
  };
  token: string;
}

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: Date;
  signedInAt: Date | null;
  meetingCount: number;
  recordingCount: number;
}

// -----------------------------------------------------------
// Helper: generate JWT
// -----------------------------------------------------------

function generateJwt(user: { id: string; email: string; displayName: string }): string {
  return jwt.sign(
    { userId: user.id, email: user.email, displayName: user.displayName },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

// -----------------------------------------------------------
// Signup with email + password
// -----------------------------------------------------------

export async function signup(
  email: string,
  password: string,
  displayName: string
): Promise<{ ok: false; error: string } | { ok: true; data: AuthResult }> {
  try {
    // Validate inputs
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      return { ok: false, error: 'Invalid email address.' };
    }
    if (!password || password.length < 8) {
      return { ok: false, error: 'Password must be at least 8 characters.' };
    }
    const trimmedName = displayName.trim();
    if (!trimmedName || trimmedName.length > 40) {
      return { ok: false, error: 'Display name must be between 1 and 40 characters.' };
    }

    // Check if email already exists
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      return { ok: false, error: 'An account with this email already exists.' };
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        displayName: trimmedName,
        passwordHash,
        signedInAt: new Date(),
      },
    });

    const token = generateJwt(user);
    return {
      ok: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
        },
        token,
      },
    };
  } catch (err) {
    console.error('[auth] Signup error:', err);
    return { ok: false, error: 'Failed to create account. Please try again.' };
  }
}

// -----------------------------------------------------------
// Signin with email + password
// -----------------------------------------------------------

export async function signin(
  email: string,
  password: string
): Promise<{ ok: false; error: string } | { ok: true; data: AuthResult }> {
  try {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      return { ok: false, error: 'Email is required.' };
    }

    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user || !user.passwordHash) {
      return { ok: false, error: 'Invalid email or password.' };
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return { ok: false, error: 'Invalid email or password.' };
    }

    // Update last sign-in
    await prisma.user.update({
      where: { id: user.id },
      data: { signedInAt: new Date() },
    });

    const token = generateJwt(user);
    return {
      ok: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
        },
        token,
      },
    };
  } catch (err) {
    console.error('[auth] Signin error:', err);
    return { ok: false, error: 'Failed to sign in. Please try again.' };
  }
}

// -----------------------------------------------------------
// Generate magic link token
// -----------------------------------------------------------

export async function generateMagicLink(
  email: string,
  displayName?: string
): Promise<{ ok: false; error: string } | { ok: true; message: string }> {
  try {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      return { ok: false, error: 'Invalid email address.' };
    }

    // Find or create user by email
    let user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) {
      // Auto-create account on magic link request
      user = await prisma.user.create({
        data: {
          email: normalizedEmail,
          displayName: displayName?.trim() ?? normalizedEmail.split('@')[0] ?? normalizedEmail,
        },
      });
    }

    // Generate a unique token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MS);

    await prisma.authToken.create({
      data: {
        userId: user.id,
        token,
        type: 'magic_link',
        expiresAt,
      },
    });

    // In production, this would send an email via a transactional email service.
    // For now, we log the link for development.
    const magicLink = `${process.env.CORS_ORIGIN ?? 'http://localhost:3000'}/auth/verify?token=${token}`;
    console.log(`[auth] Magic link for ${normalizedEmail}: ${magicLink}`);

    return {
      ok: true,
      message: `If an account exists with this email, a sign-in link has been sent. In development, check the server logs.`,
    };
  } catch (err) {
    console.error('[auth] Magic link error:', err);
    return { ok: false, error: 'Failed to generate magic link. Please try again.' };
  }
}

// -----------------------------------------------------------
// Verify magic link token
// -----------------------------------------------------------

export async function verifyMagicLink(
  token: string
): Promise<{ ok: false; error: string } | { ok: true; data: AuthResult }> {
  try {
    const authToken = await prisma.authToken.findUnique({ where: { token } });

    if (!authToken) {
      return { ok: false, error: 'Invalid or expired link.' };
    }

    if (authToken.type !== 'magic_link') {
      return { ok: false, error: 'Invalid token type.' };
    }

    if (authToken.usedAt) {
      return { ok: false, error: 'This link has already been used. Please request a new one.' };
    }

    if (new Date() > authToken.expiresAt) {
      await prisma.authToken.delete({ where: { id: authToken.id } });
      return { ok: false, error: 'This link has expired. Please request a new one.' };
    }

    // Mark token as used
    await prisma.authToken.update({
      where: { id: authToken.id },
      data: { usedAt: new Date() },
    });

    const user = await prisma.user.findUnique({ where: { id: authToken.userId } });
    if (!user) {
      return { ok: false, error: 'User not found.' };
    }

    // Update last sign-in
    await prisma.user.update({
      where: { id: user.id },
      data: { signedInAt: new Date() },
    });

    const jwtToken = generateJwt(user);
    return {
      ok: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
        },
        token: jwtToken,
      },
    };
  } catch (err) {
    console.error('[auth] Verify magic link error:', err);
    return { ok: false, error: 'Failed to verify link. Please try again.' };
  }
}

// -----------------------------------------------------------
// Get user profile (with stats)
// -----------------------------------------------------------

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        _count: {
          select: {
            meetingHistory: true,
            recordings: true,
          },
        },
      },
    });

    if (!user) return null;

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt,
      signedInAt: user.signedInAt,
      meetingCount: user._count.meetingHistory,
      recordingCount: user._count.recordings,
    };
  } catch (err) {
    console.error('[auth] Get profile error:', err);
    return null;
  }
}

// -----------------------------------------------------------
// Update user profile
// -----------------------------------------------------------

export async function updateProfile(
  userId: string,
  data: { displayName?: string; avatarUrl?: string }
): Promise<{ ok: false; error: string } | { ok: true; data: UserProfile }> {
  try {
    const updateData: Record<string, unknown> = {};
    if (data.displayName !== undefined) {
      const trimmed = data.displayName.trim();
      if (!trimmed || trimmed.length > 40) {
        return { ok: false, error: 'Display name must be between 1 and 40 characters.' };
      }
      updateData.displayName = trimmed;
    }
    if (data.avatarUrl !== undefined) {
      updateData.avatarUrl = data.avatarUrl;
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: updateData,
    });

    const profile = await getUserProfile(userId);
    if (!profile) return { ok: false, error: 'Failed to update profile.' };

    return { ok: true, data: profile };
  } catch (err) {
    console.error('[auth] Update profile error:', err);
    return { ok: false, error: 'Failed to update profile.' };
  }
}

// -----------------------------------------------------------
// JWT verification (for middleware)
// -----------------------------------------------------------

export function verifyToken(token: string): {
  userId: string;
  email: string;
  displayName: string;
} | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as {
      userId: string;
      email: string;
      displayName: string;
    };
    return decoded;
  } catch {
    return null;
  }
}
