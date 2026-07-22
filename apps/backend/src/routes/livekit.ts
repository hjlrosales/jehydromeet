/**
 * LiveKit Token Endpoint
 *
 * Issues LiveKit access tokens for SFU room participants.
 * Tokens are generated using the LiveKit Server SDK with
 * API key/secret configured in environment variables.
 *
 * GET /api/livekit/token?room=myroom&identity=user123
 *   Returns: { token: "eyJ..." }
 *
 * POST /api/livekit/token
 *   Body: { room: string, identity: string, name?: string, canPublish?: boolean }
 *   Returns: { token: "eyJ..." }
 */

import { Router, type Request, type Response } from 'express';
import { AccessToken } from 'livekit-server-sdk';

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY ?? '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET ?? '';

export const livekitRouter: Router = Router();

/**
 * POST /api/livekit/token
 * Generate a LiveKit access token for a participant.
 */
livekitRouter.post('/token', (req: Request, res: Response) => {
  try {
    const { room, identity, name, canPublish } = req.body;

    if (!room || !identity) {
      res.status(400).json({ error: 'Missing required fields: room, identity' });
      return;
    }

    if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
      res.status(500).json({
        error: 'LIVEKIT_NOT_CONFIGURED',
        message: 'LiveKit server credentials are not configured.',
      });
      return;
    }

    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity,
      name: name ?? identity,
      ttl: '12h',
    });

    at.addGrant({
      roomJoin: true,
      room,
      canPublish: canPublish !== false,
      canSubscribe: true,
      canPublishData: true,
    });

    const token = at.toJwt();
    res.json({ token });
  } catch (err) {
    console.error('[livekit] Error generating token:', err);
    res.status(500).json({ error: 'Failed to generate LiveKit token.' });
  }
});

/**
 * GET /api/livekit/status
 * Check if LiveKit is configured.
 */
livekitRouter.get('/status', (_req: Request, res: Response) => {
  res.json({
    configured: !!(LIVEKIT_API_KEY && LIVEKIT_API_SECRET),
    url: process.env.LIVEKIT_URL ?? null,
  });
});
