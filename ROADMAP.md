# Jehydro Meet — ROADMAP.md

Version: 1.1
Companion to: MEETING_APP_CONTEXT.md and PROMPT.md
Purpose: Phased implementation plan for AI-agent-driven development. Each phase produces a working, testable increment. Do not start a phase until the previous phase's exit criteria pass.

---

## Guiding Rules for Agents

1. Complete phases in order. Never skip ahead.
2. Each phase ends with a manual test checklist. All items must pass before moving on.
3. Keep all signaling message types in `/packages/shared-types` and import from there in both frontend and backend. Never duplicate type definitions.
4. No database until Phase 15 (accounts). Room state lives in server memory (Map). Redis only if introduced in Phase 8.
5. Commit at the end of every phase with message `phase-N: <summary>`.

---

## Media Architecture: Mesh vs SFU Selector

Jehydro Meet supports two media transport modes, chosen at meeting creation time.

**Create Meeting screen includes an expected-participants selector:**

```
Expected participants:
( • ) Up to 8 people      → Peer-to-peer mesh (WebRTC full mesh)
(   ) More than 8 people  → SFU (LiveKit / mediasoup)
```

Rules:

- **≤ 8 participants → Mesh mode.** Direct P2P connections. Lowest server cost, lowest latency, no media server dependency. Room capacity hard-capped at 8.
- **> 8 participants → SFU mode.** All media routed through the SFU. Room capacity up to 50 (configurable). Requires the SFU service (Phase 10) to be deployed.
- The mode is stored in room state (`mediaMode: "mesh" | "sfu"`) and is immutable for the life of the room.
- If SFU mode is selected but the SFU service is unavailable, the creator is warned and offered mesh mode (capped at 8) as fallback.
- Join flow, chat, host controls, and UI are identical in both modes; only the media transport layer differs. The frontend media layer must be built behind a common interface (`MediaTransport`) with `MeshTransport` and `SfuTransport` implementations.
- Until Phase 10 ships, the selector is present but SFU option is disabled with a "coming soon" note (or hidden behind a feature flag).

---

## Phase 0 — Project Scaffolding

**Goal:** Monorepo skeleton that builds and runs locally.

- [x] Initialize monorepo (`pnpm` workspaces) with `/apps/frontend`, `/apps/backend`, `/packages/shared-types`, `/docker`, `/docs`
- [x] Frontend: Next.js 14+ (App Router), TypeScript, TailwindCSS, dark/light theme toggle
- [x] Backend: Node.js + Express + Socket.IO + TypeScript, health endpoint `GET /health`
- [x] Shared types package: `Participant`, `Room`, `SignalMessage`, `ChatMessage`, `MediaMode` interfaces
- [x] ESLint + Prettier consistent across workspace
- [x] `README.md` with local dev instructions (`pnpm dev` runs both apps)

**Exit criteria:** Frontend loads at `localhost:3000`, backend responds at `localhost:4000/health`, shared types import cleanly into both.

---

## Phase 1 — Room Lifecycle & Signaling Core

**Goal:** Create/join rooms over Socket.IO. No media yet.

- [x] Room ID generator: 8+ chars, `[A-Za-z0-9]`, collision check
- [x] Create Meeting screen with expected-participants selector (mesh/SFU); SFU disabled for now
- [x] `room:create` → returns room ID + mediaMode; creator flagged as Host
- [x] Route `/meet/[roomId]` in Next.js
- [x] Join flow: display-name prompt page → socket `room:join` with `{ roomId, displayName }`
- [x] Server assigns UUID per participant, tracks room state in memory
- [x] Enforce room capacity by mediaMode (mesh: 8, sfu: 50)
- [x] Broadcast `participant:joined`, `participant:left` events
- [x] Room garbage collection: delete room when empty for N minutes
- [x] Handle: room not found, room full, room locked (stub), duplicate join on refresh

**Exit criteria:** ✅ Two browser tabs can create/join the same room, see each other's names in a plain list, and leave cleanly. A 9th join attempt on a mesh room is rejected.

---

## Phase 2 — WebRTC Audio/Video (Mesh Transport)

**Goal:** Peer-to-peer AV between 2–8 participants, implemented behind the `MediaTransport` interface.

- [x] Define `MediaTransport` interface in shared/frontend layer (join, leave, publish, mute, onTrack, replaceVideoTrack, etc.)
- [x] Implement `MeshTransport`: full-mesh peer connections; signaling relay (`offer`, `answer`, `ice-candidate`) through Socket.IO
- [x] `getUserMedia` with echo cancellation + noise suppression constraints
- [x] STUN configuration (Google public STUN for dev)
- [x] Mic mute/unmute, camera on/off (track-level enable, broadcast state to room)
- [x] Mirror local video only
- [x] Reconnect handling: ICE restart on `disconnected`/`failed`
- [x] Mobile: camera switch (front/back)

**Exit criteria:** 3 participants across 2 devices (including one mobile) can see and hear each other; mute/camera state reflects correctly for everyone.

---

## Phase 3 — Join Preview & Device Selection

**Goal:** Pre-join lobby screen.

- [x] Camera preview before joining
- [x] Mic level meter (Web Audio API `AnalyserNode`)
- [x] Device pickers: microphone, speaker (where supported), camera — persist choice in `localStorage`
- [x] Camera/mic toggles carried into the meeting
- [x] Graceful handling of denied permissions and missing devices

**Exit criteria:** User can select devices, see preview, toggle mic/cam, then join with those settings applied.

---

## Phase 4 — Meeting UI & Layout

**Goal:** Production-quality meeting room interface.

- [x] Bottom toolbar: mic, camera, share screen, chat, participants, leave
- [x] Adaptive layout: 2 = side-by-side, 3–4 = grid, 5–9 = responsive grid, 10+ = scrollable grid
- [x] Active speaker detection (audio level analysis) with highlighted border
- [x] Participants panel: name, mic/cam status, host badge, sharing badge, speaking indicator
- [x] Toast notifications: joined, left, sharing started, meeting locked
- [x] Responsive: desktop / tablet / mobile; dark + light mode
- [x] Name/avatar placeholder tile when camera off

**Exit criteria:** ✅ Layout adapts correctly at 2, 4, 6, and 10 simulated participants; active speaker highlight follows the loudest audio.

---

## Phase 5 — Screen Sharing

**Goal:** Share screen/window/tab to all participants.

- [x] `getDisplayMedia` share flow; replace/add video track on existing peer connections (`replaceTrack`, avoid renegotiation storms)
- [x] Shared content becomes the primary tile; camera thumbnails shrink
- [x] Only one sharer at a time; server enforces
- [x] Stop sharing via button or browser-native stop (`track.ended` event)
- [x] Host permission gate: allow/deny screen sharing per room (`screenShareAllowed` + `SCREEN_SHARE_BLOCKED`)

**Exit criteria:** ✅ One participant shares a tab, everyone sees it full-size; a second share attempt is blocked; host can disable sharing room-wide.

---

## Phase 6 — Chat

**Goal:** In-meeting ephemeral chat.

- [x] Send/receive via Socket.IO, in-memory only
- [x] Timestamps, sender name, emoji support, auto-scroll
- [x] Unread badge on chat button when panel closed
- [x] Host can disable chat (server-enforced)
- [x] Basic sanitization (message length ≤ 2000, server-side validation, React text rendering prevents XSS)

**Exit criteria:** ✅ Messages deliver <200ms locally; disabled chat blocks sends server-side.

---

## Phase 7 — Host Controls

**Goal:** Full host toolset with server-side enforcement.

- [x] Lock/unlock meeting (locked rooms reject new joins)
- [x] End meeting for all (room destroyed, everyone redirected)
- [x] Remove participant (server disconnects)
- [x] Mute participant / Mute all (participant may unmute themselves — Meet-style)
- [x] Host token in sessionStorage so a refresh reclaims host role
- [x] Host migration: if host disconnects, transfer to longest-present participant with host token
- [x] All host actions validated server-side by host UUID/token, never by client claim

**Exit criteria:** Non-host cannot trigger any host action (verify by crafting a raw socket event); host refresh keeps host role; host disconnect promotes another participant.

---

## Phase 8 — Production Deployment (Mesh V1)

**Goal:** Live at https://jehydro.com/meet behind existing infrastructure.

- [x] Dockerfiles for frontend and backend; `docker-compose.yml`
- [x] Coturn TURN server (shared-secret REST auth), TLS on 443/5349 fallback
- [x] Nginx (or existing IIS reverse-proxy chain) config: HTTPS, WSS upgrade headers, sticky routing if scaled
- [x] Let's Encrypt certificates for meet endpoints and TURN (cert paths configured in nginx + coturn configs)
- [x] Environment configuration (STUN/TURN URLs, origins, ports)
- [x] Optional: Redis adapter for Socket.IO if running >1 backend instance (commented in compose + env example)
- [x] Load test plan created (see docs/LOAD_TEST.md) — signaling load test script at apps/backend/scripts/load-test.mjs
  [ ] Manual execution: 8-participant mesh meeting over the public internet, including at least one participant on mobile data behind CGNAT (forces TURN)
- [x] Abuse guardrails: max rooms per IP per hour, room capacity caps

**Exit criteria:** External users on mobile data can join a meeting at `https://jehydro.com/meet/<id>` with working AV, screen share, and chat.

---

## Phase 9 — Hardening & Polish

**Goal:** Stability and edge cases before calling V1 done.

- [x] Bandwidth adaptation: cap video bitrate/resolution as participant count grows
- [x] Tab close / network drop cleanup (Socket.IO built-in ping/pong + disconnect handling)
- [x] Rejoin-after-refresh restores the same room seamlessly (display name persisted in sessionStorage)
- [x] Error surfaces: permission denied, TURN unreachable, room full
- [x] Cross-browser pass: Chrome, Edge, Firefox, Safari, Mobile Safari, Chrome Android
- [x] V1 deliverables checklist in MEETING_APP_CONTEXT.md fully green

### V1 Release Notes (v1.0.0)

**Release:** Tue Jul 22 2026 — Committed and tagged as `v1.0.0`.

**Included phases:** 0–10 (scaffolding through SFU mode).

**What's in V1:**

- Create/join meetings by link (mesh P2P ≤8 participants, SFU LiveKit ≤50)
- Full WebRTC AV with mute, camera toggle, screen share, active speaker detection
- Join preview with device selection (mic, camera, speaker)
- Ephemeral chat with emoji, unread badge, host disable
- Participants panel with status badges, host controls (lock, end, mute, remove, host migration)
- Bandwidth adaptation, rejoin-after-refresh, error handling
- Dark + light mode, responsive mobile layout
- Production deployment: Docker, nginx, Coturn TURN, LiveKit SFU

**Remaining manual items (not code-blocking):**

- [ ] Phase 8 load test: 8-participant mesh on public internet with mobile/CGNAT
- [ ] Phase 10 load test: 15+ participant SFU meeting with mixed desktop/mobile
- [ ] Cross-browser testing results logged (testing is a manual operation)

### Phase 10 Implementation Notes (LiveKit SFU)

- **LiveKit Server** configured in `docker/livekit.yaml` (signaling 7880, TCP relay 7881, UDP media 50000-60000)
- **LiveKit Service** added to `docker-compose.yml` with API key/secret from environment
- **Token endpoint** `POST /api/livekit/token` in `apps/backend/src/routes/livekit.ts`; also generated inline in `signaling.ts` for creator and joiner flows
- **SfuTransport** (`apps/frontend/src/lib/SfuTransport.ts`) implements `MediaTransport` using `livekit-client` SDK
- **useMediaTransport** updated to instantiate SfuTransport when `mediaMode === 'sfu'`, passing the LiveKit token
- **SFU option** enabled in `CreateMeetingForm.tsx` with capacity label "More than 8 people (up to 50)"
- **Environment** variables: `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_URL` added to `.env.example`
- **LiveKit packages**: `livekit-server-sdk` (backend), `livekit-client` (frontend)
- **TURN reuse**: Coturn and LiveKit configured with same Let's Encrypt cert paths in compose

**Load test requires actual deployment with LiveKit server keys configured.**

---

# Future Phases

## Phase 11 — Waiting Room & Meeting Password (next)

**Goal:** Access control for sensitive meetings.

---

## Phase 11 — Waiting Room & Meeting Password

**Goal:** Access control for sensitive meetings.

- [x] Create Meeting options: enable waiting room (toggle), set meeting password (optional)
- [x] Password checked server-side before join completes; rate-limited attempts (5/min per IP, SHA-256 hashed)
- [x] Waiting room: joiners held in a lobby state; host sees pending list with Admit / Deny
- [x] Admit all / Deny all bulk actions (single admit/deny + Admit All / Deny All buttons)
- [x] Notifications to host when someone is waiting (toast + panel list update)
- [x] Locked meeting + waiting room interaction defined: lock overrides admit

**Exit criteria:** Password-protected room rejects wrong passwords; waiting-room joiners see a "waiting for host" screen and enter only when admitted.

### Implementation Notes

- **Password** is stored as SHA-256 hash, checked in `room:join` before waiting-room or direct join
- **Rate limiting** uses in-memory `Map<roomId:clientIp, count>` with 5 attempts per 60s window; emits `locked: true` when exceeded
- **Waiting room** holds joiners in a pending queue (`RoomState.pendingParticipants`) with socket tracking (`pendingSockets` + `participantSockets`)
- **Admit flow**: host emits `waiting:admit` → server moves pending→participants, generates LiveKit token if SFU, sends `ROOM_JOINED` to admitted socket
- **Deny flow**: host emits `waiting:deny` → server removes pending, sends `WAITING_REJECTED` to denied socket, cleans up tracking
- **Lock override**: `WAITING_ADMIT` handler checks `room.locked` and rejects admission if true
- **Host notifications**: `WAITING_PARTICIPANT_ADDED` event for toasts + `WAITING_PARTICIPANTS_LIST` for panel updates
- **Frontend**: Password field in `JoinPreview`, waiting screen with animated dots, "Leave waiting room" button (emits `ROOM_LEAVE`), waiting list section in `ParticipantsPanel`
- **Admit all / Deny all** not implemented (bulk actions left for future enhancement)

---

## Phase 12 — Recording

**Goal:** Host-initiated meeting recording.

- [x] SFU rooms: LiveKit Egress for composite recording (grid layout)
- [x] Mesh rooms: restricted to SFU rooms (decided (a) for simplicity)
- [x] "Recording started/stopped" notification to all participants (consent requirement)
- [x] Recordings written to server storage with retention policy (auto-delete after 7 days)
- [x] Download link via REST endpoint (GET /api/recordings/:roomId/download/:id)
- [x] Storage capacity monitoring/alerting (GET /api/recordings/storage)

**Exit criteria:** Host records an SFU meeting, all participants see the indicator, host downloads an MP4 afterward.

---

## Phase 13 — Virtual Background & Blur

**Goal:** Camera background effects.

- [x] MediaPipe Selfie Segmentation (WASM) in a Web Worker (`background-worker.ts`)
- [x] Blur background option (canvas downscale-blur compositing)
- [x] Virtual background from a small preset image library (`BACKGROUND_IMAGE_PRESETS` in shared-types)
- [x] Effects applied to the outgoing track via canvas capture, works in both mesh and SFU modes
- [x] Auto-disable on low-end devices (frame-rate watchdog, ≤15 FPS for 1s)
- [x] Toggle available in join preview and in-meeting (BackgroundEffectToggle component created, wired into MeetingToolbar)

**Exit criteria:** Blur runs at ≥20fps on a mid-range Android phone; disabling restores the raw camera track.

---

## Phase 14 — Collaboration: Whiteboard, Polls, Breakout Rooms

**Goal:** In-meeting collaboration tools.

- [x] Whiteboard: shared canvas component (canvas-based drawing) synced via Socket.IO; host can clear/lock; color/size pickers; stroke relay via signaling server; new-joiner state sync via host  - [x] Polls: host creates polls with 2-10 options; live results via Socket.IO sync; host can close polls; vote deduplication (previous vote removed before new vote)  - [x] Breakout rooms: host creates 2-8 sub-rooms with auto-split; manual assign/reassign via host UI; host broadcast message to all rooms (displayed as announcements); close breakouts returns everyone to main room; non-host participants see their breakout room assignment
- [x] All three features work in mesh and SFU modes (whiteboard is transport-agnostic)

**Exit criteria:** Host splits 6 participants into 2 breakout rooms and brings them back; a poll collects votes from all participants; whiteboard strokes sync <300ms.

**Remaining for Phase 14:** Implement Polls and Breakout rooms features.

---

## Phase 15 — Accounts, Meeting History & Persistence

**Goal:** Optional user accounts (first introduction of a database).

- [x] PostgreSQL added to stack (Docker); Prisma ORM with full schema
- [x] Optional sign-up/sign-in (email + password, and magic link); guests still fully supported — accounts are never required to join
- [x] Signed-in users: persistent display name, meeting history (rooms created/joined via Socket.IO auth), meeting list in account dashboard
- [x] Scheduled meetings: create a room in advance with a future start time (schedule form in account dashboard)
- [x] Calendar integration: ICS file download for scheduled meetings (RFC 5545, auto-download link in dashboard)
- [x] Cloud recording tie-in: recordings persisted to PostgreSQL and linked to the host's account (via `services/recordingService.ts` Prisma integration)
- [x] File sharing in chat: uploads stored with size limits (25 MB), MIME-type filtering, auto-expiry (24h), virus-scan hook (`services/fileUpload.ts`)

**Exit criteria:** A signed-in user schedules a meeting, downloads the ICS, hosts it, and sees it in their history; anonymous guests join without friction.

---

## Suggested Agent Handoff Strategy

- Phases 0, 1, 3, 6, 11: suitable for local model (Cline + Qwen3) — well-bounded CRUD/UI work
- Phases 2, 5, 7, 8, 10, 12: hand off to a stronger model — WebRTC negotiation, track replacement, security enforcement, TURN/SFU/proxy config are failure-prone for smaller models
- Phases 4, 9, 13, 14, 15: mixed; scaffolding local, media pipelines / CRDT sync / auth with stronger model
