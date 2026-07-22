/**
 * TURN Credentials Endpoint
 *
 * Issues short-lived TURN credentials to authenticated clients using
 * HMAC-SHA1 shared-secret auth (Coturn REST API style).
 *
 * The client calls GET /api/turn-credentials and receives:
 *   {
 *     username: "<timestamp>:<uuid>",
 *     credential: "<base64-hmac-sha1>",
 *     urls: ["turn:turn.jehydro.com:3478", "turns:turn.jehydro.com:5349"],
 *     ttl: 86400
 *   }
 *
 * These credentials are valid for 24 hours and can be used immediately
 * with the RTCPeerConnection ICE configuration.
 *
 * Reference: https://github.com/coturn/coturn/wiki/turnserver#turn-rest-api
 */

import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';

const TURN_SECRET = process.env.TURN_SECRET ?? '';
const TURN_URLS_RAW = process.env.TURN_URLS ?? 'turn:turn.jehydro.com:3478';
const TURN_CREDENTIAL_TTL = 86400; // 24 hours in seconds

export const turnRouter: Router = Router();

/**
 * GET /api/turn-credentials
 *
 * Returns time-limited TURN credentials using HMAC-SHA1 shared-secret auth.
 * No authentication required — the credentials are self-contained and
 * short-lived, so the security impact of unauthenticated access is limited
 * to TURN relay bandwidth consumption.
 */
turnRouter.get('/credentials', (_req: Request, res: Response) => {
  try {
    if (!TURN_SECRET) {
      res.status(500).json({
        error: 'TURN_SECRET not configured',
        message: 'The TURN server secret is not set on the server.',
      });
      return;
    }

    const timestamp = Math.floor(Date.now() / 1000) + TURN_CREDENTIAL_TTL;
    const username = `${timestamp}:${crypto.randomUUID()}`;

    // HMAC-SHA1 of the username using the shared secret
    const hmac = crypto.createHmac('sha1', TURN_SECRET);
    hmac.update(username);
    const credential = hmac.digest('base64');

    const urls = TURN_URLS_RAW.split(',').map((s) => s.trim()).filter(Boolean);

    res.json({
      username,
      credential,
      urls,
      ttl: TURN_CREDENTIAL_TTL,
    });
  } catch (err) {
    console.error('[turn] Error generating credentials:', err);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Failed to generate TURN credentials.',
    });
  }
});
