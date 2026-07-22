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

- [ ] Define `MediaTransport` interface in shared/frontend layer (join, leave, publish, mute, onTrack, replaceVideoTrack, etc.)
- [ ] Implement `MeshTransport`: full-mesh peer connections; signaling relay (`offer`, `answer`, `ice-candidate`) through Socket.IO
- [ ] `getUserMedia` with echo cancellation + noise suppression constraints
- [ ] STUN configuration (Google public STUN for dev)
- [ ] Mic mute/unmute, camera on/off (track-level enable, broadcast state to room)
- [ ] Mirror local video only
- [ ] Reconnect handling: ICE restart on `disconnected`/`failed`
- [ ] Mobile: camera switch (front/back)

**Exit criteria:** 3 participants across 2 devices (including one mobile) can see and hear each other; mute/camera state reflects correctly for everyone.

---

## Phase 3 — Join Preview & Device Selection

**Goal:** Pre-join lobby screen.

- [ ] Camera preview before joining
- [ ] Mic level meter (Web Audio API `AnalyserNode`)
- [ ] Device pickers: microphone, speaker (where supported), camera — persist choice in `localStorage`
- [ ] Camera/mic toggles carried into the meeting
- [ ] Graceful handling of denied permissions and missing devices

**Exit criteria:** User can select devices, see preview, toggle mic/cam, then join with those settings applied.

---

## Phase 4 — Meeting UI & Layout

**Goal:** Production-quality meeting room interface.

- [ ] Bottom toolbar: mic, camera, share screen, chat, participants, leave
- [ ] Adaptive layout: 2 = side-by-side, 3–4 = grid, 5–9 = responsive grid, 10+ = scrollable grid
- [ ] Active speaker detection (audio level analysis) with highlighted border
- [ ] Participants panel: name, mic/cam status, host badge, sharing badge, speaking indicator
- [ ] Toast notifications: joined, left, sharing started, meeting locked
- [ ] Responsive: desktop / tablet / mobile; dark + light mode
- [ ] Name/avatar placeholder tile when camera off

**Exit criteria:** Layout adapts correctly at 2, 4, 6, and 10 simulated participants; active speaker highlight follows the loudest audio.

---

## Phase 5 — Screen Sharing

**Goal:** Share screen/window/tab to all participants.

- [ ] `getDisplayMedia` share flow; replace/add video track on existing peer connections (`replaceTrack`, avoid renegotiation storms)
- [ ] Shared content becomes the primary tile; camera thumbnails shrink
- [ ] Only one sharer at a time; server enforces
- [ ] Stop sharing via button or browser-native stop
- [ ] Host permission gate: allow/deny screen sharing per room

**Exit criteria:** One participant shares a tab, everyone sees it full-size; a second share attempt is blocked; host can disable sharing room-wide.

---

## Phase 6 — Chat

**Goal:** In-meeting ephemeral chat.

- [ ] Send/receive via Socket.IO, in-memory only
- [ ] Timestamps, sender name, emoji support, auto-scroll
- [ ] Unread badge on chat button when panel closed
- [ ] Host can disable chat
- [ ] Basic sanitization (escape HTML, message length limit, simple rate limit)

**Exit criteria:** Messages deliver <200ms locally; disabled chat blocks sends server-side.

---

## Phase 7 — Host Controls

**Goal:** Full host toolset with server-side enforcement.

- [ ] Lock/unlock meeting (locked rooms reject new joins)
- [ ] End meeting for all (room destroyed, everyone redirected)
- [ ] Remove participant (server disconnects; removed user cannot auto-rejoin for N seconds)
- [ ] Mute participant / Mute all (participant may unmute themselves — Meet-style)
- [ ] Host token in sessionStorage so a refresh reclaims host role
- [ ] Host migration: if host disconnects, transfer to longest-present participant
- [ ] All host actions validated server-side by host UUID/token, never by client claim

**Exit criteria:** Non-host cannot trigger any host action (verify by crafting a raw socket event); host refresh keeps host role; host disconnect promotes another participant.

---

## Phase 8 — Production Deployment (Mesh V1)

**Goal:** Live at https://jehydro.com/meet behind existing infrastructure.

- [ ] Dockerfiles for frontend and backend; `docker-compose.yml`
- [ ] Coturn TURN server (shared-secret REST auth), TLS on 443/5349 fallback
- [ ] Nginx (or existing IIS reverse-proxy chain) config: HTTPS, WSS upgrade headers, sticky routing if scaled
- [ ] Let's Encrypt certificates for meet endpoints and TURN
- [ ] Environment configuration (STUN/TURN URLs, origins, ports)
- [ ] Optional: Redis adapter for Socket.IO if running >1 backend instance
- [ ] Load test: 8-participant mesh meeting over the public internet, including at least one participant on mobile data behind CGNAT (forces TURN)
- [ ] Abuse guardrails: max rooms per IP per hour, room capacity caps

**Exit criteria:** External users on mobile data can join a meeting at `https://jehydro.com/meet/<id>` with working AV, screen share, and chat.

---

## Phase 9 — Hardening & Polish

**Goal:** Stability and edge cases before calling V1 done.

- [ ] Bandwidth adaptation: cap video bitrate/resolution as participant count grows
- [ ] Tab close / network drop cleanup (heartbeat + timeout removal)
- [ ] Rejoin-after-refresh restores the same room seamlessly
- [ ] Error surfaces: permission denied, TURN unreachable, room full
- [ ] Cross-browser pass: Chrome, Edge, Firefox, Safari, Mobile Safari, Chrome Android
- [ ] V1 deliverables checklist in MEETING_APP_CONTEXT.md fully green

**Exit criteria:** ✅ **V1 RELEASE**

---

# Post-V1 Phases

## Phase 10 — SFU Mode (>8 Participants)

**Goal:** Enable the SFU option in the participants selector.

- [ ] Deploy LiveKit (self-hosted, Docker) alongside existing stack — preferred over raw mediasoup for lower implementation risk
- [ ] Backend issues LiveKit access tokens on `room:join` when `mediaMode === "sfu"`
- [ ] Implement `SfuTransport` (LiveKit client SDK) behind the existing `MediaTransport` interface
- [ ] Simulcast enabled; subscribers receive quality tiers based on tile size
- [ ] Screen share, active speaker, mute state mapped through LiveKit events to existing UI
- [ ] Enable SFU option in Create Meeting selector; capacity 50
- [ ] TURN reuse: LiveKit configured with the same Coturn deployment
- [ ] Load test: 15+ participants, mixed desktop/mobile

**Exit criteria:** A 12-participant SFU meeting works with the same UI/UX as a mesh meeting; mesh rooms unaffected.

---

## Phase 11 — Waiting Room & Meeting Password

**Goal:** Access control for sensitive meetings.

- [ ] Create Meeting options: enable waiting room (toggle), set meeting password (optional)
- [ ] Password checked server-side before join completes; rate-limited attempts
- [ ] Waiting room: joiners held in a lobby state; host sees pending list with Admit / Deny
- [ ] Admit all / Deny all bulk actions
- [ ] Notifications to host when someone is waiting
- [ ] Locked meeting + waiting room interaction defined: lock overrides admit

**Exit criteria:** Password-protected room rejects wrong passwords; waiting-room joiners see a "waiting for host" screen and enter only when admitted.

---

## Phase 12 — Recording

**Goal:** Host-initiated meeting recording.

- [ ] SFU rooms: LiveKit Egress for composite recording (grid + active speaker layouts)
- [ ] Mesh rooms: either (a) restrict recording to SFU rooms, or (b) local host-side recording via `MediaRecorder` of a composited canvas — decide (a) for simplicity
- [ ] "Recording started/stopped" notification to all participants (consent requirement)
- [ ] Recordings written to server storage with retention policy (e.g., auto-delete after 7 days)
- [ ] Download link shown to host at meeting end
- [ ] Storage capacity monitoring/alerting

**Exit criteria:** Host records an SFU meeting, all participants see the indicator, host downloads an MP4 afterward.

---

## Phase 13 — Virtual Background & Blur

**Goal:** Camera background effects.

- [ ] MediaPipe Selfie Segmentation (WASM) in a Web Worker
- [ ] Blur background option
- [ ] Virtual background from a small preset image library
- [ ] Effects applied to the outgoing track via canvas capture, works in both mesh and SFU modes
- [ ] Auto-disable on low-end devices (frame-rate watchdog)
- [ ] Toggle available in join preview and in-meeting

**Exit criteria:** Blur runs at ≥20fps on a mid-range Android phone; disabling restores the raw camera track.

---

## Phase 14 — Collaboration: Whiteboard, Polls, Breakout Rooms

**Goal:** In-meeting collaboration tools.

- [ ] Whiteboard: shared canvas (tldraw or Excalidraw embed) synced via Socket.IO/Yjs; host can clear/lock
- [ ] Polls: host creates single/multi-choice polls; live results; anonymous voting
- [ ] Breakout rooms: host creates N sub-rooms, assigns participants (manual or auto-split); participants moved between rooms; host broadcast message to all rooms; close breakouts returns everyone to main room
- [ ] All three features work in mesh and SFU modes

**Exit criteria:** Host splits 6 participants into 2 breakout rooms and brings them back; a poll collects votes from all participants; whiteboard strokes sync <300ms.

---

## Phase 15 — Accounts, Meeting History & Persistence

**Goal:** Optional user accounts (first introduction of a database).

- [ ] PostgreSQL added to stack (Docker); Prisma or Drizzle ORM
- [ ] Optional sign-up/sign-in (email + password, or magic link); guests still fully supported — accounts are never required to join
- [ ] Signed-in users: persistent display name, meeting history (rooms created/joined, timestamps, duration)
- [ ] Scheduled meetings: create a room in advance with a future start time
- [ ] Calendar integration: ICS file download for scheduled meetings (Google/Outlook add via ICS)
- [ ] Cloud recording tie-in: recordings from Phase 12 linked to the host's account
- [ ] File sharing in chat: uploads stored with size limits + expiry, virus-scan hook

**Exit criteria:** A signed-in user schedules a meeting, downloads the ICS, hosts it, and sees it in their history; anonymous guests join without friction.

---

## Suggested Agent Handoff Strategy

- Phases 0, 1, 3, 6, 11: suitable for local model (Cline + Qwen3) — well-bounded CRUD/UI work
- Phases 2, 5, 7, 8, 10, 12: hand off to a stronger model — WebRTC negotiation, track replacement, security enforcement, TURN/SFU/proxy config are failure-prone for smaller models
- Phases 4, 9, 13, 14, 15: mixed; scaffolding local, media pipelines / CRDT sync / auth with stronger model
