import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { roomRouter } from './routes/rooms';
import { setupSignaling } from './signaling';
import { RoomManager } from './rooms';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:3000';

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

// Health endpoint
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Room management REST endpoints (future use)
app.use('/api/rooms', roomRouter);

// HTTP server + Socket.IO
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: CORS_ORIGIN,
    methods: ['GET', 'POST'],
  },
  // Connection throttling
  maxHttpBufferSize: 1e6, // 1 MB
});

// Initialize room manager (in-memory state)
const roomManager = new RoomManager();

// Set up Socket.IO event handlers
setupSignaling(io, roomManager);

server.listen(PORT, () => {
  console.log(`[backend] Jehydro Meet signaling server running on http://localhost:${PORT}`);
  console.log(`[backend] CORS origin: ${CORS_ORIGIN}`);
  console.log(`[backend] Health check: http://localhost:${PORT}/health`);
});
