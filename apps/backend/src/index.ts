import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { roomRouter } from './routes/rooms';
import { turnRouter } from './routes/turn';
import { livekitRouter } from './routes/livekit';
import { setupSignaling } from './signaling';
import { RoomManager } from './rooms';

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

// Attach client IP to socket for rate limiting in event handlers
io.use((socket, next) => {
  const clientIp =
    (socket.handshake.headers['x-forwarded-for'] as string | undefined)
      ?.split(',')[0]
      ?.trim() ??
    socket.handshake.address;
  (socket as any)._clientIp = clientIp;
  next();
});

// Set up Socket.IO event handlers (includes rate limiting)
setupSignaling(io, roomManager);

server.listen(PORT, () => {
  console.log(`[backend] Jehydro Meet signaling server running on http://localhost:${PORT}`);
  console.log(`[backend] CORS origin: ${CORS_ORIGIN}`);
  console.log(`[backend] TURN credentials: http://localhost:${PORT}/api/turn/credentials`);
  console.log(`[backend] Health check: http://localhost:${PORT}/health`);
});
