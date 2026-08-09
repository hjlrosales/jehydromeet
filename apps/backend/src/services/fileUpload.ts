/**
 * File Upload Service
 *
 * Manages file uploads for chat file sharing:
 * - Uploaded files are stored on local disk
 * - Size limits enforced (default 25 MB)
 * - Files auto-expire after configurable TTL (default 24 hours)
 * - Expired files cleaned up periodically
 * - Virus scan hook (placeholder — integrate with ClamAV in production)
 */

import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import prisma from './db';

// -----------------------------------------------------------
// Configuration
// -----------------------------------------------------------

const UPLOAD_DIR = process.env.FILE_UPLOAD_PATH ?? './uploads';
const MAX_FILE_SIZE = (parseInt(process.env.FILE_MAX_SIZE_MB ?? '25', 10)) * 1024 * 1024;
const FILE_EXPIRY_MS = (parseInt(process.env.FILE_EXPIRY_HOURS ?? '24', 10)) * 60 * 60 * 1000;
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/json',
  'application/zip',
  'application/x-zip-compressed',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];

// Ensure upload directory exists
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// -----------------------------------------------------------
// Multer storage configuration
// -----------------------------------------------------------

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    // Generate a unique filename: uuid + original extension
    const uniqueName = crypto.randomUUID();
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uniqueName}${ext}`);
  },
});

// -----------------------------------------------------------
// Multer middleware instance
// -----------------------------------------------------------

export const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const allowed = ALLOWED_MIME_TYPES.includes(file.mimetype);
    if (!allowed) {
      cb(new Error(`File type '${file.mimetype}' is not allowed. Allowed types: images, PDF, text, CSV, JSON, ZIP, and Office documents.`));
      return;
    }
    cb(null, true);
  },
});

// -----------------------------------------------------------
// Types
// -----------------------------------------------------------

export interface FileUploadResult {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  uploadedAt: Date;
  expiresAt: Date;
}

// -----------------------------------------------------------
// Save file metadata to database
// -----------------------------------------------------------

export async function saveFileMetadata(
  userId: string,
  roomId: string,
  file: Express.Multer.File
): Promise<FileUploadResult | null> {
  try {
    const expiresAt = new Date(Date.now() + FILE_EXPIRY_MS);

    const record = await prisma.uploadedFile.create({
      data: {
        userId,
        roomId,
        originalName: file.originalname,
        storagePath: file.path,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        expiresAt,
      },
    });

    return {
      id: record.id,
      originalName: record.originalName,
      mimeType: record.mimeType,
      sizeBytes: record.sizeBytes,
      storagePath: record.storagePath,
      uploadedAt: record.uploadedAt,
      expiresAt: record.expiresAt,
    };
  } catch (err) {
    console.error('[fileUpload] Error saving file metadata:', err);
    // Clean up the uploaded file if DB save fails
    try {
      fs.unlinkSync(file.path);
    } catch {
      // Ignore cleanup errors
    }
    return null;
  }
}

// -----------------------------------------------------------
// Get file metadata
// -----------------------------------------------------------

export async function getFileMetadata(fileId: string): Promise<FileUploadResult | null> {
  try {
    const record = await prisma.uploadedFile.findUnique({ where: { id: fileId } });
    if (!record) return null;

    // Check if expired
    if (new Date() > record.expiresAt) {
      // Delete expired record
      await prisma.uploadedFile.delete({ where: { id: fileId } });
      try {
        if (fs.existsSync(record.storagePath)) {
          fs.unlinkSync(record.storagePath);
        }
      } catch {
        // Ignore cleanup errors
      }
      return null;
    }

    return {
      id: record.id,
      originalName: record.originalName,
      mimeType: record.mimeType,
      sizeBytes: record.sizeBytes,
      storagePath: record.storagePath,
      uploadedAt: record.uploadedAt,
      expiresAt: record.expiresAt,
    };
  } catch (err) {
    console.error('[fileUpload] Error getting file metadata:', err);
    return null;
  }
}

// -----------------------------------------------------------
// Get files for a room
// -----------------------------------------------------------

export async function getRoomFiles(roomId: string): Promise<FileUploadResult[]> {
  try {
    const records = await prisma.uploadedFile.findMany({
      where: {
        roomId,
        expiresAt: { gt: new Date() },
      },
      orderBy: { uploadedAt: 'desc' },
      take: 50,
    });

    return records.map((r) => ({
      id: r.id,
      originalName: r.originalName,
      mimeType: r.mimeType,
      sizeBytes: r.sizeBytes,
      storagePath: r.storagePath,
      uploadedAt: r.uploadedAt,
      expiresAt: r.expiresAt,
    }));
  } catch (err) {
    console.error('[fileUpload] Error getting room files:', err);
    return [];
  }
}

// -----------------------------------------------------------
// Cleanup expired files (runs on interval)
// -----------------------------------------------------------

export function startFileCleanup(): void {
  console.log('[fileUpload] Starting file cleanup scheduler...');

  const cleanup = async () => {
    try {
      const expired = await prisma.uploadedFile.findMany({
        where: { expiresAt: { lte: new Date() } },
      });

      for (const file of expired) {
        // Delete file from disk
        try {
          if (fs.existsSync(file.storagePath)) {
            fs.unlinkSync(file.storagePath);
          }
        } catch {
          // Ignore errors
        }

        // Delete from database
        await prisma.uploadedFile.delete({ where: { id: file.id } });
      }

      if (expired.length > 0) {
        console.log(`[fileUpload] Cleaned up ${expired.length} expired file(s)`);
      }
    } catch (err) {
      console.error('[fileUpload] Cleanup error:', err);
    }
  };

  // Run every 15 minutes
  setInterval(cleanup, 15 * 60 * 1000).unref();

  // Run once on startup
  cleanup();
}

// -----------------------------------------------------------
// Virus scan hook (placeholder)
// -----------------------------------------------------------

export function scanFile(filePath: string): Promise<boolean> {
  // Placeholder: In production, integrate with ClamAV or similar.
  // Return true to indicate file is safe.
  console.log(`[fileUpload] Virus scan placeholder for: ${filePath}`);
  return Promise.resolve(true);
}
