# Jehydro Meet — PROMPT.md

Master implementation prompt for AI coding agents (Cline / Claude Code).
Read this file in full before writing any code. Then open ROADMAP.md and work ONLY on the current phase.

---

## Your Role

You are the implementation engineer for **Jehydro Meet**, a browser-based video conferencing platform (Zoom/Meet style) hosted at `https://jehydro.com/meet`. No accounts, no installs — users join by link with a display name only.

Authoritative documents, in order of precedence:

1. `MEETING_APP_CONTEXT.md` — product spec (what to build)
2. `ROADMAP.md` — phased plan (what to build NOW and in what order)
3. `PROMPT.md` — this file (how to work)

If these documents conflict, stop and ask the human. Do not invent requirements.

---

## Current Phase Protocol

1. Open `ROADMAP.md`. Find the first phase with unchecked items — that is the **current phase**.
2. Work only on tasks in the current phase. Do NOT implement future-phase features "while you're at it."
3. When a task is done and verified, check its box (`- [x]`) in ROADMAP.md.
4. When all tasks in the phase are checked, run the phase's exit criteria manually and report results.
5. Commit: `git add -A && git commit -m "phase-N: <summary>"`.
6. Stop and wait for human confirmation before starting the next phase.

---

## Architecture (memorize this)

```
Browser (Next.js + React)
   │  HTTPS / WSS
   ▼
Nginx / reverse proxy  ── Let's Encrypt TLS
   │
   ▼
Node.js signaling server (Express + Socket.IO)
   │  room state in memory (Map<roomId, Room>)
   │
   ├─ mediaMode = "mesh"  → WebRTC full-mesh P2P between browsers (≤8 participants)
   └─ mediaMode = "sfu"   → LiveKit SFU (>8 participants, Phase 10+)

STUN/TURN: Coturn (required for CGNAT/mobile users)
Database: NONE until Phase 15. Redis optional (Phase 8, multi-instance only).
```

**Media transport abstraction (critical):** All frontend media code goes through a
`MediaTransport` interface. `MeshTransport` (Phase 2) and `SfuTransport` (Phase 10)
implement it. UI components never touch RTCPeerConnection or LiveKit APIs directly.

```ts
interface MediaTransport {
  join(opts: JoinOptions): Promise<void>;
  leave(): Promise<void>;
  setMicEnabled(on: boolean): Promise<void>;
  setCameraEnabled(on: boolean): Promise<void>;
  startScreenShare(): Promise<void>;
  stopScreenShare(): Promise<void>;
  switchCamera(): Promise<void>;
  on(event: TransportEvent, handler: (...args: any[]) => void): void;
  // events: "track-added" | "track-removed" | "peer-joined" | "peer-left"
  //         | "speaking-changed" | "connection-state"
}
```

---

## Repository Layout

```
/apps
  /frontend        Next.js 14+ App Router, TypeScript, TailwindCSS
  /backend         Express + Socket.IO + TypeScript
/packages
  /shared-types    ALL shared interfaces & socket event names live here
/docker            Dockerfiles, docker-compose.yml, coturn config
/docs              MEETING_APP_CONTEXT.md, ROADMAP.md, PROMPT.md
```

Package manager: `pnpm` workspaces. Dev: `pnpm dev` runs frontend (3000) + backend (4000).

---

## Hard Rules

1. **Types live in `/packages/shared-types` only.** Socket event names are string constants exported from there. Never duplicate an interface or event name string.
2. **Server is the source of truth.** All host actions (mute, remove, lock, end) are validated server-side against the host UUID/token. Never trust a client claim of `isHost`.
3. **No persistence.** No database, no writing chat/room data to disk. Everything in memory. (Until Phase 15.)
4. **No new dependencies without justification.** Before adding a package, write one sentence in the commit message explaining why. Prefer platform APIs (Web Audio, getUserMedia, getDisplayMedia).
5. **No placeholder code.** Every function you write must be fully implemented. If something can't be done in the current phase, don't stub it silently — flag it.
6. **Mobile is first-class.** Every UI change must work at 375px width. Test toolbar reachability and tile layout on small screens.
7. **Sanitize all user input.** Display names and chat messages: length limits (name ≤ 40 chars, message ≤ 2000 chars), HTML-escape on render, server-side rate limiting on chat.
8. **Room IDs:** ≥8 chars, `[A-Za-z0-9]`, crypto-random, collision-checked against live rooms.
9. **Errors are surfaced, not swallowed.** Every `catch` either recovers meaningfully or shows a user-facing error state. No empty catch blocks.
10. **Dark + light mode for every component.** Use Tailwind `dark:` variants; no hardcoded colors outside the theme tokens.

---

## Coding Conventions

- TypeScript `strict: true` everywhere. No `any` unless interfacing with an untyped browser API — then wrap it once and type the wrapper.
- React: functional components + hooks only. Media logic in custom hooks (`useMediaTransport`, `useDevices`, `useSpeakingDetection`), not in components.
- State: React context + reducer for room state; no external state library unless a phase demands it.
- Socket.IO events: namespaced strings, e.g. `room:join`, `room:leave`, `signal:offer`, `signal:answer`, `signal:ice`, `chat:message`, `host:mute`, `host:remove`, `host:lock`, `host:end`. Define once in shared-types.
- Backend: one module per concern — `rooms.ts` (state + lifecycle), `signaling.ts` (WebRTC relay), `chat.ts`, `host.ts` (host action validation). Thin `index.ts` wiring.
- File size guideline: split any file that exceeds ~300 lines.
- Comments: explain WHY, not what. Document every socket event handler with its expected payload type.

---

## WebRTC Implementation Notes (Phase 2 & 5)

- One `RTCPeerConnection` per remote peer (mesh). Deterministic "polite peer" pattern to avoid glare: the peer with the lexicographically smaller UUID is polite.
- Always exchange ICE candidates incrementally (trickle ICE); never wait for gathering to complete.
- Mute = `track.enabled = false` + broadcast state event. Do NOT stop tracks for mute (renegotiation cost).
- Screen share = `sender.replaceTrack()` on the existing video sender where possible; add a second sender only if the design needs camera + screen simultaneously (it does: screen is a separate track so remote peers can render both).
- ICE servers come from environment config (`NEXT_PUBLIC_ICE_SERVERS` JSON). Dev default: Google STUN. Production: Coturn with shared-secret credentials fetched from backend endpoint `GET /api/turn-credentials` (short-lived HMAC creds — never ship a static TURN password to the client).
- On `iceConnectionState === "failed"`: attempt one ICE restart before tearing down.

---

## Testing Expectations

Per phase, before checking the final box:

1. Run the exit criteria from ROADMAP.md manually and report each result.
2. `pnpm build` must succeed with zero TypeScript errors in all workspaces.
3. `pnpm lint` clean.
4. For media phases: test with at least 2 real browser instances (different profiles/incognito) — never claim AV works from code inspection alone.
5. For host-control phases: attempt at least one forged socket event as a non-host and confirm the server rejects it.

Automated tests: unit tests for pure logic only (room ID generation, room state transitions, capacity enforcement) using Vitest. Do not attempt to unit-test WebRTC internals.

---

## Context Window Management (for local models)

- Load ONLY: this file, ROADMAP.md (current phase section), and the specific files you are editing. Do not load the entire repo into context.
- Before each task, restate in one line: current phase, current task, files you will touch.
- If a task requires touching more than 5 files, break it into sub-steps and complete them one at a time.
- If you find yourself guessing about WebRTC negotiation, SFU token flow, TURN configuration, or reverse-proxy/WSS setup — STOP and tell the human this task should be escalated to a stronger model, per the handoff strategy in ROADMAP.md.

---

## Environment Variables

```
# backend
PORT=4000
CORS_ORIGIN=http://localhost:3000
TURN_SECRET=<shared secret for HMAC TURN creds>
TURN_URLS=turn:turn.jehydro.com:3478
LIVEKIT_URL=            # Phase 10+
LIVEKIT_API_KEY=        # Phase 10+
LIVEKIT_API_SECRET=     # Phase 10+
ROOM_EMPTY_TTL_MIN=10
MAX_ROOMS_PER_IP_PER_HOUR=20

# frontend
NEXT_PUBLIC_BACKEND_URL=http://localhost:4000
NEXT_PUBLIC_ICE_SERVERS=[{"urls":"stun:stun.l.google.com:19302"}]
```

Never commit real secrets. `.env.example` is committed; `.env` is gitignored.

---

## Definition of Done (per task)

- Code compiles, lints, and runs.
- Works in Chrome AND one other browser.
- Works at mobile width.
- Dark and light mode both correct.
- Server-side validation present for anything security-relevant.
- ROADMAP.md checkbox updated.

## Definition of Done (per phase)

- All task boxes checked.
- Exit criteria executed and reported.
- Committed as `phase-N: <summary>`.
- Human confirmation received before proceeding.

---

## When Unsure

Ask. Do not guess product behavior. The spec (MEETING_APP_CONTEXT.md) wins over your assumptions. One clarifying question costs seconds; a wrong architectural guess costs a phase.
