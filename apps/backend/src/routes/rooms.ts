import { Router, type Request, type Response } from 'express';

export const roomRouter: Router = Router();

/**
 * GET /api/rooms/:id
 * Returns basic room info if it exists.
 */
roomRouter.get('/:id', (req: Request, res: Response) => {
  // Placeholder — room state is managed via Socket.IO
  res.json({ roomId: req.params.id, info: 'Room info available via WebSocket' });
});
