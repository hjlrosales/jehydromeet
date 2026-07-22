# Jehydro Meet

Browser-based video conferencing platform (Zoom/Google Meet style). No accounts, no installs — just share a link and meet.

## Architecture

```
Browser (Next.js + React)  ─── HTTPS/WSS ───>  Node.js signaling server (Express + Socket.IO)
                                                         │
                                                    room state in memory
                                                         │
                                              ┌──────────┴──────────┐
                                              │                     │
                                         Mesh mode           SFU mode (Phase 10+)
                                     (P2P WebRTC, ≤8)     (LiveKit, ≤50 participants)
```

## Tech Stack

- **Frontend:** Next.js 14+ (App Router), React, TypeScript, TailwindCSS, Socket.IO Client
- **Backend:** Node.js, Express, Socket.IO, TypeScript
- **Media:** WebRTC (mesh), LiveKit SFU (Phase 10+)
- **TURN:** Coturn (Phase 8+)
- **Package Manager:** pnpm workspaces

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm 8+

### Install & Run

```bash
# Install dependencies
pnpm install

# Start both frontend (localhost:3000) and backend (localhost:4000)
pnpm dev
```

### Development URLs

| Service       | URL                          |
|---------------|------------------------------|
| Frontend      | http://localhost:3000         |
| Backend       | http://localhost:4000         |
| Health check  | http://localhost:4000/health  |

## Project Structure

```
/
├── apps/
│   ├── frontend/       Next.js 14 App Router, TailwindCSS
│   └── backend/        Express + Socket.IO signaling server
├── packages/
│   └── shared-types/   Shared TypeScript interfaces & socket events
├── docker/             Dockerfiles, docker-compose, coturn config
└── docs/               MEETING_APP_CONTEXT.md, ROADMAP.md, PROMPT.md
```

## Phase Progress

See [ROADMAP.md](docs/ROADMAP.md) for the full phased development plan.

## License

MIT
