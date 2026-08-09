/**
 * Authentication Routes
 *
 * POST /api/auth/signup        — Create account with email + password
 * POST /api/auth/signin        — Sign in with email + password
 * POST /api/auth/magic-link    — Request magic link email
 * POST /api/auth/verify        — Verify magic link token
 * GET  /api/auth/me            — Get current user profile (requires auth)
 * PATCH /api/auth/profile      — Update profile (requires auth)
 */

import { Router, type Request, type Response } from 'express';
import { requireAuth, optionalAuth } from '../middleware/auth';
import {
  signup,
  signin,
  generateMagicLink,
  verifyMagicLink,
  getUserProfile,
  updateProfile,
} from '../services/auth';

export const authRouter: Router = Router();

// -----------------------------------------------------------
// POST /api/auth/signup — Create account
// -----------------------------------------------------------
authRouter.post('/signup', async (req: Request, res: Response) => {
  const { email, password, displayName } = req.body;

  if (!email || !password || !displayName) {
    res.status(400).json({ error: 'Email, password, and display name are required.' });
    return;
  }

  const result = await signup(email, password, displayName);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }

  res.status(201).json(result.data);
});

// -----------------------------------------------------------
// POST /api/auth/signin — Sign in with email + password
// -----------------------------------------------------------
authRouter.post('/signin', async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required.' });
    return;
  }

  const result = await signin(email, password);
  if (!result.ok) {
    res.status(401).json({ error: result.error });
    return;
  }

  res.json(result.data);
});

// -----------------------------------------------------------
// POST /api/auth/magic-link — Request magic link
// -----------------------------------------------------------
authRouter.post('/magic-link', async (req: Request, res: Response) => {
  const { email } = req.body;

  if (!email) {
    res.status(400).json({ error: 'Email is required.' });
    return;
  }

  const result = await generateMagicLink(email);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }

  res.json({ message: result.message });
});

// -----------------------------------------------------------
// POST /api/auth/verify — Verify magic link token
// -----------------------------------------------------------
authRouter.post('/verify', async (req: Request, res: Response) => {
  const { token } = req.body;

  if (!token) {
    res.status(400).json({ error: 'Token is required.' });
    return;
  }

  const result = await verifyMagicLink(token);
  if (!result.ok) {
    res.status(401).json({ error: result.error });
    return;
  }

  res.json(result.data);
});

// -----------------------------------------------------------
// GET /api/auth/me — Get current user profile
// -----------------------------------------------------------
authRouter.get('/me', optionalAuth, async (req: Request, res: Response) => {
  if (!req.user) {
    res.json({ authenticated: false });
    return;
  }

  const profile = await getUserProfile(req.user.userId);
  if (!profile) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }

  res.json({ authenticated: true, user: profile });
});

// -----------------------------------------------------------
// PATCH /api/auth/profile — Update profile
// -----------------------------------------------------------
authRouter.patch('/profile', requireAuth, async (req: Request, res: Response) => {
  const { displayName, avatarUrl } = req.body;

  const result = await updateProfile(req.user!.userId, { displayName, avatarUrl });
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }

  res.json(result.data);
});
