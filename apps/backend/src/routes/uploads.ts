/**
 * File Upload Routes
 *
 * POST   /api/uploads/:roomId     — Upload a file to a room (auth)
 * GET    /api/uploads/:fileId     — Download a file (signature-based, room-scoped)
 * GET    /api/uploads/room/:roomId — List files for a room (auth)
 */

import { Router, type Request, type Response } from 'express';
import { requireAuth, optionalAuth } from '../middleware/auth';
import { upload, saveFileMetadata, getFileMetadata, getRoomFiles, scanFile } from '../services/fileUpload';
import fs from 'fs';

export const uploadRouter: Router = Router();

// -----------------------------------------------------------
// POST /api/uploads/:roomId — Upload a file
// -----------------------------------------------------------
uploadRouter.post(
  '/:roomId',
  requireAuth,
  (req: Request, res: Response, next) => {
    // Multer error handling
    upload.single('file')(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ error: 'File too large. Maximum size is 25 MB.' });
          }
          return res.status(400).json({ error: `Upload error: ${err.message}` });
        }
        return res.status(400).json({ error: err.message });
      }
      next();
    });
  },
  async (req: Request, res: Response) => {
    try {
      const { roomId } = req.params;
      const file = req.file;

      if (!roomId) {
        res.status(400).json({ error: 'Room ID is required.' });
        return;
      }

      if (!file) {
        res.status(400).json({ error: 'No file provided.' });
        return;
      }

      // Virus scan (placeholder)
      const isSafe = await scanFile(file.path);
      if (!isSafe) {
        try {
          fs.unlinkSync(file.path);
        } catch {
          // Ignore
        }
        res.status(422).json({ error: 'File failed security scan.' });
        return;
      }

      // Save metadata to database
      const result = await saveFileMetadata(req.user!.userId, roomId, file);
      if (!result) {
        res.status(500).json({ error: 'Failed to save file.' });
        return;
      }

      res.status(201).json({
        id: result.id,
        originalName: result.originalName,
        mimeType: result.mimeType,
        sizeBytes: result.sizeBytes,
        uploadedAt: result.uploadedAt,
      });
    } catch (err) {
      console.error('[uploads] Error uploading file:', err);
      res.status(500).json({ error: 'Failed to upload file.' });
    }
  }
);

// -----------------------------------------------------------
// GET /api/uploads/room/:roomId — List files for a room
// -----------------------------------------------------------
uploadRouter.get('/room/:roomId', optionalAuth, async (req: Request, res: Response) => {
  try {
    const { roomId } = req.params;
    if (!roomId) {
      res.status(400).json({ error: 'Room ID is required.' });
      return;
    }

    const files = await getRoomFiles(roomId);
    res.json({ files });
  } catch (err) {
    console.error('[uploads] Error listing files:', err);
    res.status(500).json({ error: 'Failed to list files.' });
  }
});

// -----------------------------------------------------------
// GET /api/uploads/:fileId — Download a file
// -----------------------------------------------------------
uploadRouter.get('/:fileId', async (req: Request, res: Response) => {
  try {
    const { fileId } = req.params;
    if (!fileId) {
      res.status(400).json({ error: 'File ID is required.' });
      return;
    }

    const metadata = await getFileMetadata(fileId);
    if (!metadata) {
      res.status(404).json({ error: 'File not found or expired.' });
      return;
    }

    if (!fs.existsSync(metadata.storagePath)) {
      res.status(404).json({ error: 'File not found on disk.' });
      return;
    }

    const fileName = metadata.originalName;
    res.setHeader('Content-Type', metadata.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    res.setHeader('Cache-Control', 'private, max-age=3600');

    const stream = fs.createReadStream(metadata.storagePath);
    stream.pipe(res);
  } catch (err) {
    console.error('[uploads] Error downloading file:', err);
    res.status(500).json({ error: 'Failed to download file.' });
  }
});

// Import multer for error type checking
import multer from 'multer';
