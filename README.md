# Jehydro Meet

[![CI](https://github.com/hjlrosales/jehydromeet/actions/workflows/ci.yml/badge.svg)](https://github.com/hjlrosales/jehydromeet/actions/workflows/ci.yml)
[![E2E — Waiting Room](https://github.com/hjlrosales/jehydromeet/actions/workflows/e2e.yml/badge.svg)](https://github.com/hjlrosales/jehydromeet/actions/workflows/e2e.yml)
[![E2E Report — Pages](https://github.com/hjlrosales/jehydromeet/actions/workflows/e2e-report.yml/badge.svg)](https://hjlrosales.github.io/jehydromeet/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Browser-based video conferencing platform (Zoom / Google Meet style). No installs — share a link and meet. Accounts are optional: guests can create and join meetings with nothing but a display name, while signed-in users get meeting history, scheduling, and cloud recordings.

## Features

- **Instant meetings** — create a room and share the link; join with just a display name, no account required
- **Two media transports, chosen automatically:**
  - **Mesh (WebRTC P2P)** for up to 8 participants — lowest latency, no media server
  - **SFU (LiveKit)** for up to 50 participants — routed through a media server
- **In-meeting toolset:** mute/camera toggle, screen sharing, active-speaker detection, adaptive grid layout, dark/light mode, mobile support
- **Chat** — ephemeral, in-memory, host can disable
- **Host controls** — lock meeting, end for all, remove/mute participants, mute all, host migration on disconnect
- **Waiting room & meeting password** — optional access control with host admit/deny
- **Recording** — host-initiated, composited via LiveKit Egress, downloadable afterward, auto-expiring storage
- **Virtual backgrounds & blur** — on-device segmentation (MediaPipe) in a Web Worker, auto-disables on low-end devices
- **Collaboration tools** — shared whiteboard, live polls, breakout rooms
- **Accounts (optional)** — email/password or magic-link sign-in, meeting history, scheduled meetings with `.ics` calendar download, in-chat file sharing
- **Production-ready networking** — Coturn TURN server for NAT traversal/CGNAT, Docker Compose deployment, Nginx-ready

See [ROADMAP.md](ROADMAP.md) for the full phase-by-phase build history.

## Architecture

```
Browser (Next.js + React)  ─── HTTPS/WSS ───>  Node.js signaling server (Express + Socket.IO)
                                                         │
                                              room state in memory
                                              PostgreSQL for accounts, history, recordings
                                                         │
                                              ┌──────────┴──────────┐
                                              │                     │
                                         Mesh mode           SFU mode
                                     (P2P WebRTC, ≤8)     (LiveKit, ≤50 participants)
```

The frontend talks to two backing services:

1. **Signaling server** (Express + Socket.IO) — room lifecycle, chat, host actions, waiting room, whiteboard/poll/breakout sync, and WebRTC offer/answer/ICE relay for mesh mode.
2. **LiveKit SFU** — media routing for rooms with more than 8 expected participants, plus composite recording via LiveKit Egress.

Both media transports implement a shared `MediaTransport` interface (`MeshTransport` / `SfuTransport`) so the rest of the UI is transport-agnostic.

## Tech Stack

| Layer          | Technology |
|----------------|------------|
| Frontend       | Next.js 14 (App Router), React 18, TypeScript, TailwindCSS, Socket.IO Client, LiveKit Client SDK |
| Backend        | Node.js, Express, Socket.IO, TypeScript, Prisma ORM |
| Database       | PostgreSQL (accounts, meeting history, recordings, file metadata) |
| Media          | WebRTC (mesh), LiveKit SFU + Egress (recording) |
| NAT traversal  | Coturn (TURN, shared-secret auth) |
| Auth           | JWT (email/password + magic link), bcrypt |
| Background FX  | MediaPipe Selfie Segmentation (WASM, Web Worker) |
| Testing        | Playwright (E2E, multi-browser) |
| Package Manager| pnpm workspaces |
| Deployment     | Docker / Docker Compose |

## Project Structure

```
/
├── apps/
│   ├── frontend/              Next.js 14 App Router, TailwindCSS
│   │   ├── src/app/           Pages (home, /meet/[roomId], /account)
│   │   ├── src/components/    UI components (toolbar, panels, whiteboard, polls, breakout, auth)
│   │   ├── src/hooks/         useSocket, useMediaTransport
│   │   ├── src/lib/           MeshTransport, SfuTransport, BackgroundProcessor
│   │   └── e2e/                Playwright end-to-end tests
│   └── backend/                Express + Socket.IO signaling server
│       ├── src/routes/         REST: auth, meetings, recordings, uploads
│       ├── src/middleware/     Auth middleware (JWT)
│       ├── src/services/       Recording, file-upload services
│       ├── prisma/             Database schema & migrations
│       └── scripts/             DB setup, load test
├── packages/
│   └── shared-types/            Shared TypeScript interfaces & socket event contracts
├── docker/                      Dockerfiles, docker-compose.yml, coturn & livekit config
├── docs/                        Architecture notes, roadmap, test plans, audit
└── scripts/                     Repo-level scripts (env validation, report merging)
```

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm 8+
- PostgreSQL (only required for account features — see [Database Setup](#database-setup-optional))
- Docker (optional, for TURN/LiveKit/production-style local setup)

### Install & Run

```bash
# Install dependencies
pnpm install

# Start both frontend (localhost:3000) and backend (localhost:4000)
pnpm dev
```

### Development URLs

| Service       | URL                           |
|---------------|--------------------------------|
| Frontend      | http://localhost:3000          |
| Backend       | http://localhost:4000          |
| Health check  | http://localhost:4000/health   |

### Environment Variables

Copy the example file and fill in what you need — most variables are optional and only required for the corresponding feature (TURN, SFU, recording, accounts):

```bash
cp .env.example .env
```

See [.env.example](.env.example) for the full annotated list (base server config, TURN, LiveKit SFU, recording, database, JWT auth, file uploads, and frontend public vars).

### Database Setup (optional)

Account features (sign-up/sign-in, meeting history, scheduling, file sharing, recording persistence) require PostgreSQL:

```bash
# Set DATABASE_URL and JWT_SECRET in .env, then:
./apps/backend/scripts/setup-db.sh
```

Guests can always create and join meetings without a database or account — this step is only needed for persistence features.

## Available Scripts

Run from the repo root (pnpm workspaces):

| Command                | Description |
|-------------------------|--------------|
| `pnpm dev`               | Run frontend + backend concurrently |
| `pnpm build`              | Build all workspace packages |
| `pnpm lint`               | Lint all workspace packages |
| `pnpm typecheck`          | Type-check all workspace packages |
| `pnpm format` / `format:check` | Prettier write / check across the repo |
| `pnpm validate:env`       | Validate required environment variables are set |

## Testing

Playwright drives multi-browser end-to-end tests and generates an HTML report with screenshots, traces, console logs, and timing.

```bash
cd apps/frontend

# Chromium only (fastest)
pnpm test:e2e

# All three browsers
npx playwright test e2e/waiting-room.spec.ts --project=chromium --project=firefox --project=webkit
```

### Viewing the HTML Report Locally

```bash
cd apps/frontend
pnpm report:open
# or open manually:
open playwright-report/index.html         # macOS
xdg-open playwright-report/index.html     # Linux
start playwright-report/index.html        # Windows
```

On every push to `main`, the full multi-browser report is deployed to GitHub Pages — see the **E2E Report** badge above.

## Production Deployment

Docker Compose brings up the full stack: frontend, backend, PostgreSQL, Coturn (TURN), and LiveKit (SFU + Egress).

```bash
cd docker
docker compose up -d
```

Key pieces:

- **Coturn** — shared-secret REST auth, TLS on 443/5349 fallback, required for participants behind NAT/CGNAT
- **LiveKit** — signaling on 7880, TCP relay on 7881, UDP media on 50000–60000; used for SFU mode and recording (Egress)
- **Nginx** (or your existing reverse proxy) — terminate HTTPS, upgrade WebSocket connections for Socket.IO, add sticky routing if scaling the backend horizontally
- **Redis** — optional Socket.IO adapter if running more than one backend instance (see `docker-compose.yml` and `.env.example`)

See [docs/LOAD_TEST.md](docs/LOAD_TEST.md) and [docs/CROSS_BROWSER_TEST_PLAN.md](docs/CROSS_BROWSER_TEST_PLAN.md) for pre-launch validation plans.

## Documentation

- [ROADMAP.md](ROADMAP.md) — full phased development plan and implementation notes
- [docs/LOAD_TEST.md](docs/LOAD_TEST.md) — load testing plan for mesh and SFU modes
- [docs/CROSS_BROWSER_TEST_PLAN.md](docs/CROSS_BROWSER_TEST_PLAN.md) — manual cross-browser test matrix
- [docs/AUDIT.md](docs/AUDIT.md) — implementation audit notes

## Contributing

Issues and pull requests are welcome. Please run `pnpm lint`, `pnpm typecheck`, and the relevant Playwright tests before opening a PR.

## License

MIT — see [LICENSE](LICENSE).
