/**
 * Optional JWT Authentication Middleware
 *
 * This middleware optionally authenticates requests by checking for a
 * JWT token in the Authorization header. If the token is valid, the
 * user payload is attached to `req.user`. If invalid or missing, the
 * request still proceeds without a user — making auth optional.
 *
 * This allows guests to access public endpoints without a token while
 * signed-in users get personalized responses.
 *
 * Usage:
 *   router.use(optionalAuth);
 *   // In handler: req.user?.userId
 *
 * For endpoints that REQUIRE auth, use requireAuth after this.
 */

import { type Request, type Response, type NextFunction } from 'express';
import { verifyToken } from '../services/auth';

// Augment Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        email: string;
        displayName: string;
      };
    }
  }
}

/**
 * Extract JWT from Authorization header (Bearer scheme) or cookie.
 */
function extractToken(req: Request): string | null {
  // Check Authorization header first
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  // Check cookie fallback (for browser-based requests)
  const tokenCookie = req.headers.cookie
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('jwt='));
  if (tokenCookie) {
    return tokenCookie.slice(4);
  }
  return null;
}

/**
 * Optional auth middleware — attaches user if token present, otherwise continues.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (token) {
    const payload = verifyToken(token);
    if (payload) {
      req.user = payload;
    }
  }
  next();
}

/**
 * Require auth middleware — rejects request if no valid token found.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired token.' });
    return;
  }
  req.user = payload;
  next();
}
