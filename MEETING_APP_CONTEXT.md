# Jehydro Meet — MEETING_APP_CONTEXT.md

Version: 1.1
Status: Approved
Project Type: Web-based Video Meeting Platform
Companion documents: ROADMAP.md (phased plan), PROMPT.md (agent working rules)

This is the authoritative product specification. If ROADMAP.md or PROMPT.md conflict with this document, this document wins — but flag the conflict to the human instead of silently resolving it.

---

# 1. Project Overview

Jehydro Meet is a browser-based video conferencing application similar to Zoom or Google Meet, hosted at:

```
https://jehydro.com/meet
```

Core principles:

- **No installation.** Runs entirely in the browser.
- **No accounts.** No login, registration, or passwords. Participants provide only a display name. (Optional accounts arrive in Post-V1 Phase 15 and are never required to join.)
- **Instant.** Starting a meeting should take less than 10 seconds from opening the website.
- **Ephemeral.** No meeting data is stored permanently. Chat and room state vanish when the meeting ends.

---

# 2. Main Workflow

## 2.1 Create Meeting

1. User opens https://jehydro.com/meet and clicks **Create Meeting**.
2. User selects the expected meeting size (see §3, Media Architecture):

```
Expected participants:
( • ) Up to 8 people        → peer-to-peer (mesh)
(   ) More than 8 people    → media server (SFU)   [disabled until Phase 10]
```

3. System generates a unique Meeting ID and room URL, e.g.:

```
https://jehydro.com/meet/6Fh82KsQ
```

4. The creator lands in the join preview (§6.9), then enters the meeting as **Host**.

## 2.2 Join Meeting

1. A visitor opens the meeting link.
2. The app shows the join preview with a display-name field:

```
--------------------------
Join Meeting

Name:  [ John Smith ]

        Join
--------------------------
```

3. After entering a name (and choosing devices), the participant joins.

## 2.3 Target Flow

```
Open Website → Create Meeting → Copy Link → Send Link
→ Others Open Link → Enter Name → Join → Meeting Starts
```

Total time to start a meeting: **< 10 seconds**.

---

# 3. Media Architecture: Mesh vs SFU

The room's media transport mode is chosen at creation time and is immutable for the life of the room. It is stored in room state as:

```
mediaMode: "mesh" | "sfu"
```

| | Mesh | SFU |
|---|---|---|
| Selector option | "Up to 8 people" | "More than 8 people (up to 50)" |
| Transport | Full-mesh P2P WebRTC | LiveKit media server |
| Room capacity (hard cap) | 8 | 50 (configurable) |
| Availability | V1 | V1 (LiveKit) |
| Server media cost | None (TURN relay only when needed) | All media through SFU |

Rules:

- Capacity is enforced **server-side**; a join beyond capacity is rejected with a "room full" error.
- If SFU mode is selected but the SFU service is unreachable, the creator is warned and offered mesh mode (capped at 8) as fallback.
- Join flow, chat, host controls, participants panel, and UI are **identical** in both modes. Only the media transport layer differs, behind the frontend `MediaTransport` interface (see PROMPT.md).
- SFU mode requires a LiveKit server configured with `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, and `LIVEKIT_URL` environment variables.

---

# 4. Authentication & Identity

- No authentication, accounts, registration, or passwords in V1.
- Every participant is identified by a **display name** (user-provided, ≤ 40 characters).
- Each participant receives an internal temporary **UUID** for the session, assigned by the server.
- The **Host** additionally receives a **host token**, stored in `sessionStorage`, so a page refresh reclaims the host role. Host actions are validated server-side against this token — never against a client-side claim.

---

# 5. Roles

## 5.1 Host

The creator of the room (or a promoted participant after host migration).

Permissions:

- Lock / unlock meeting (locked rooms reject new joins)
- End meeting for all
- Remove participant (removed user cannot auto-rejoin for a cooldown period)
- Mute participant / Mute all
- Allow or deny screen sharing (room-wide)
- Disable chat (room-wide)
- Change a participant's display name (optional)

Mute behavior (decided): **Meet-style.** A participant muted by the host may unmute themselves. The UI shows "muted by host" so the action is transparent.

Host migration: if the host disconnects and does not reclaim within the grace period, the longest-present participant is promoted to host.

## 5.2 Participant

Can:

- Join and leave
- Use microphone and webcam
- Chat (if enabled)
- Share screen (if allowed by host)
- Choose display name and devices before joining

---

# 6. Features (Version 1)

## 6.1 Audio

- Join with microphone
- Mute / unmute (track-level enable; state broadcast to the room)
- Audio level indicator
- Automatic echo cancellation and noise suppression (getUserMedia constraints)

## 6.2 Video

- Camera on / off
- HD video where bandwidth allows; bitrate/resolution adapt as participant count grows
- Switch camera (front/back on mobile)
- Mirror **local** video only (remote views are unmirrored)
- When camera is off, the tile shows the display name / avatar placeholder

## 6.3 Screen Sharing

- Share entire screen, a window, or a browser tab (getDisplayMedia)
- Only **one** sharer at a time — enforced server-side
- Shared content becomes the primary tile; camera thumbnails shrink
- Stop via in-app button or the browser's native stop control
- Host may disable screen sharing room-wide

## 6.4 Chat

- Send / receive text messages via the signaling server
- Emoji support, timestamps, sender name, auto-scroll
- Unread badge on the chat button when the panel is closed
- Host can disable chat
- **Ephemeral:** in-memory only; chat disappears when the meeting ends; late joiners do not receive history
- Sanitization: HTML-escaped on render, message length ≤ 2000 chars, server-side rate limiting

## 6.5 Participants Panel

Shows per participant:

- Display name
- Microphone status
- Camera status
- Host badge
- Screen-sharing badge
- Speaking indicator

## 6.6 Meeting Controls (bottom toolbar)

All participants: Microphone · Camera · Share Screen · Chat · Participants · Leave Meeting

Host additionally: Lock Meeting · End Meeting · Mute All · Remove User (via participants panel)

## 6.7 Meeting Layout

Adapts automatically:

| Participants | Layout |
|---|---|
| 2 | Side-by-side |
| 3–4 | Grid |
| 5–9 | Responsive grid |
| 10+ | Scrollable grid |

The active speaker is highlighted with a colored border (automatic speaking detection via audio level analysis).

## 6.8 Notifications

Toast notifications, e.g.:

- "John joined" / "Jane left"
- "Mike started sharing"
- "Meeting locked"
- "Recording started" (Post-V1)

## 6.9 Join Preview & Device Selection

Before entering the room:

- Camera preview
- Microphone level test
- Device pickers: microphone, speaker (where supported), camera — selections persisted in `localStorage`
- Camera and microphone toggles
- Display name field
- Join button
- Graceful handling of denied permissions and missing devices

---

# 7. Post-V1 Features

Not in Version 1. Delivery order and details are defined in ROADMAP.md Phases 10–15.

| Phase | Feature |
|---|---|
| 10 | ✅ SFU mode — **completed in V1** |
| 11 | Waiting room + meeting password |
| 12 | Recording (SFU rooms, LiveKit Egress; recording indicator for consent; retention policy) |
| 13 | Virtual background + background blur (MediaPipe segmentation) |
| 14 | Whiteboard, polls, breakout rooms |
| 15 | Optional user accounts, meeting history, scheduled meetings, calendar (ICS), cloud recording links, file sharing — first introduction of PostgreSQL |

---

# 8. Technology Stack

**Frontend:** Next.js 14+ (App Router) · React · TypeScript · TailwindCSS · Socket.IO Client · WebRTC · LiveKit Client SDK

**Backend:** Node.js · Express · Socket.IO · UUID · LiveKit Server SDK · Redis (optional, multi-instance only)

**Database:** None in V1. PostgreSQL introduced only in Phase 15.

**Media:** WebRTC · STUN · TURN (Coturn, required for CGNAT/mobile users) · LiveKit SFU

**Deployment:** Docker · Ubuntu · Nginx (behind the existing jehydro.com reverse-proxy chain) · HTTPS / Let's Encrypt

---

# 9. Architecture

```
Client (browser)
   │  HTTPS / WSS
   ▼
Nginx / reverse proxy  ── Let's Encrypt TLS
   │
   ▼
Next.js frontend  +  Node.js signaling server (Express + Socket.IO)
   │  room state in memory (Map<roomId, Room>)
   │
   ├─ mediaMode "mesh" → WebRTC peer connections directly between participants
   └─ mediaMode "sfu"  → LiveKit SFU (Phase 10+)

STUN/TURN: Coturn (HMAC short-lived credentials issued by backend)
```

---

# 10. Data Model (in-memory)

## 10.1 Room

- Room ID
- Media mode (`mesh` | `sfu`)
- Host ID + host token (server-side)
- Participants (map of UUID → Participant)
- Meeting locked (boolean)
- Chat enabled (boolean)
- Screen sharing allowed (boolean)
- Current screen sharer (UUID or null)
- Created time
- Chat messages (memory only)

Rooms are garbage-collected after being empty for a configurable TTL.

## 10.2 Participant

- UUID
- Display name
- Joined time
- Microphone enabled
- Camera enabled
- Screen sharing (boolean)
- Is host (boolean)
- Connection state

## 10.3 Room URL / ID

```
https://jehydro.com/meet/a83Jd92K
```

- Minimum 8 characters, `[A-Za-z0-9]`
- Cryptographically random, collision-checked against live rooms

---

# 11. UI Theme

Clean · Modern · Minimal · Responsive (desktop, tablet, mobile) · Dark mode + Light mode for every component

---

# 12. Performance Goals

| Metric | Target |
|---|---|
| Join meeting | < 3 seconds |
| Camera startup | < 2 seconds |
| Chat latency | < 200 ms |
| Mesh meeting size | 2–8 participants (hard cap) |
| SFU meeting size (Phase 10) | up to 50 participants |

Bandwidth adaptation: per-peer video bitrate is capped progressively as mesh participant count grows, to remain usable on typical residential upload speeds.

---

# 13. Browser Support

Google Chrome · Microsoft Edge · Firefox · Safari · Mobile Safari · Chrome for Android

---

# 14. Security & Privacy

- HTTPS required; Secure WebSockets (WSS)
- No meeting data stored permanently; no login credentials exist
- Random, unguessable room IDs; temporary session UUIDs
- Host actions validated server-side via host token — never trusted from the client
- TURN credentials are short-lived HMAC credentials issued by the backend; no static TURN password ships to the client
- Camera and microphone accessed only after explicit browser permission
- Input sanitization: display names ≤ 40 chars, chat messages ≤ 2000 chars, HTML-escaped, rate-limited
- Abuse guardrails: max rooms created per IP per hour; room capacity caps enforced server-side

---

# 15. Project Directory

```
/apps
  /frontend        Next.js
  /backend         Express + Socket.IO
/packages
  /shared-types    shared interfaces & socket event names
/docker            Dockerfiles, docker-compose, coturn config
/docs              MEETING_APP_CONTEXT.md, ROADMAP.md, PROMPT.md
README.md
```

---

# 16. Version 1 Deliverables

- ✅ Create Meeting (with mesh/SFU size selector)
- ✅ Join by link
- ✅ Display name prompt
- ✅ Audio (mute, levels, echo cancellation, noise suppression)
- ✅ Video (on/off, mobile camera switch, local mirror)
- ✅ Screen sharing (single sharer, host gate)
- ✅ Ephemeral chat (emoji, timestamps, host disable)
- ✅ Participants list with status badges
- ✅ Host controls (lock, end, mute, remove, host token, host migration)
- ✅ Device selection + join preview
- ✅ Active speaker detection
- ✅ Responsive adaptive layout
- ✅ Dark mode + light mode
- ✅ Mobile support
- ✅ SFU mode (LiveKit, >8 participants, up to 50)
- ✅ Bandwidth adaptation (progressive bitrate capping)
- ✅ Rejoin-after-refresh (sessionStorage persistence)
- ✅ Production deployment (Docker, nginx, Coturn TURN, LiveKit SFU)
- ✅ Abuse guardrails (rate limiting, capacity caps, input validation)

---

# 17. Project Vision

Jehydro Meet aims to provide a lightweight, browser-native meeting platform that allows anyone to start or join a video conference instantly without creating an account. The focus is on simplicity, speed, privacy, and ease of use while maintaining a modern, professional meeting experience comparable to mainstream conferencing applications — scaling from small peer-to-peer meetings to larger SFU-backed sessions as the platform matures.
