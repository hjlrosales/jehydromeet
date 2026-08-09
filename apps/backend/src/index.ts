import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { roomRouter } from './routes/rooms';
import { turnRouter } from './routes/turn';
import { livekitRouter } from './routes/livekit';
import { recordingRouter } from './routes/recordings';
import { authRouter } from './routes/auth';
import { meetingRouter } from './routes/meetings';
import { uploadRouter } from './routes/uploads';
import { setupSignaling } from './signaling';
import { RoomManager } from './rooms';
import { verifyToken } from './services/auth';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:3000';

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: '1mb' }));

// -----------------------------------------------------------
// Health endpoint
// -----------------------------------------------------------
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// -----------------------------------------------------------
// TURN credentials endpoint
// Issues short-lived HMAC-based TURN credentials. No auth required
// because credentials are self-contained and time-limited.
// -----------------------------------------------------------
app.use('/api/turn', turnRouter);

// -----------------------------------------------------------
// LiveKit token endpoint (SFU mode)
// -----------------------------------------------------------
app.use('/api/livekit', livekitRouter);

// -----------------------------------------------------------
// Recording endpoints (list/download recordings)
// -----------------------------------------------------------
app.use('/api/recordings', recordingRouter);

// -----------------------------------------------------------
// Auth endpoints (Phase 15 — accounts)
// -----------------------------------------------------------
app.use('/api/auth', authRouter);

// -----------------------------------------------------------
// Meeting history + scheduled meetings (Phase 15)
// -----------------------------------------------------------
app.use('/api/meetings', meetingRouter);

// -----------------------------------------------------------
// File uploads (Phase 15 — file sharing in chat)
// -----------------------------------------------------------
app.use('/api/uploads', uploadRouter);

// -----------------------------------------------------------
// Room management REST endpoints (future use)
// -----------------------------------------------------------
app.use('/api/rooms', roomRouter);

// -----------------------------------------------------------
// HTTP server + Socket.IO
// -----------------------------------------------------------
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: CORS_ORIGIN,
    methods: ['GET', 'POST'],
  },
  // Connection throttling — 1 MB max per message
  maxHttpBufferSize: 1e6,
  // Ping interval for connection health
  pingInterval: 25000,
  pingTimeout: 20000,
});

// Initialize room manager (in-memory state)
const roomManager = new RoomManager();

// Attach client IP to socket for rate limiting, and JWT auth for meeting history
io.use((socket, next) => {
  const clientIp =
    (socket.handshake.headers['x-forwarded-for'] as string | undefined)
      ?.split(',')[0]
      ?.trim() ??
    socket.handshake.address;
  (socket as any)._clientIp = clientIp;

  // Extract JWT from socket auth option (passed from frontend)
  const token = socket.handshake.auth?.token as string | undefined;
  if (token) {
    const payload = verifyToken(token);
    if (payload) {
      (socket as any)._user = payload;
    }
  }

  next();
});

// Set up Socket.IO event handlers (includes rate limiting)
setupSignaling(io, roomManager);

server.listen(PORT, () => {
  console.log(`[backend] Jehydro Meet signaling server running on http://localhost:${PORT}`);
  console.log(`[backend] CORS origin: ${CORS_ORIGIN}`);
  console.log(`[backend] TURN credentials: http://localhost:${PORT}/api/turn/credentials`);
  console.log(`[backend] Auth endpoints: http://localhost:${PORT}/api/auth`);
  console.log(`[backend] Meeting history: http://localhost:${PORT}/api/meetings`);
  console.log(`[backend] File uploads: http://localhost:${PORT}/api/uploads`);
  console.log(`[backend] Health check: http://localhost:${PORT}/health`);
  console.log(`[backend] PostgreSQL (Phase 15): ${process.env.DATABASE_URL ? 'configured' : 'NOT configured — no persistence'}`);
});
