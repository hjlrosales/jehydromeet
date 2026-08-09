# Jehydro Meet — Phase 8 Load Test Plan

**Version:** 1.0  
**Objective:** Validate that an 8-participant mesh WebRTC meeting works reliably over the public internet, including at least one participant behind mobile CGNAT (forcing TURN relay).

---

## 1. Pre-Test Checklist

Before running the load test, verify:

- [ ] **Docker compose up** — All services running on the production server:
  - `docker compose -f docker/docker-compose.yml up -d`
  - Check `docker compose ps` — `frontend`, `backend`, `nginx`, `coturn`, `livekit` all `Up`
- [ ] **Health check** — `curl https://meet-api.jehydro.com/health` returns `{"status":"ok"}`
- [ ] **TURN configured** — `TURN_SECRET` set in `.env`, Coturn starts without errors
- [ ] **SSL certificates** — All domains have valid Let's Encrypt certs
- [ ] **DNS records** — `jehydro.com`, `meet-api.jehydro.com`, `turn.jehydro.com` resolve
- [ ] **LiveKit keys** (if testing SFU) — `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_URL` set
- [ ] **Firewall open** — Ports 443 (HTTPS/WSS), 3478 (STUN/TURN), 5349 (TURN TLS), 49152-65535 (TURN relay)

---

## 2. Test Topology

```
Participant 1 (Host)  — Desktop, wired broadband
Participant 2         — Desktop, wired broadband
Participant 3         — Laptop, WiFi broadband
Participant 4         — Laptop, WiFi broadband
Participant 5         — Mobile, home WiFi
Participant 6         — Mobile, 5G data (CGNAT)
Participant 7         — Mobile, 4G data (CGNAT)
Participant 8         — Desktop, WiFi broadband
```

**Key constraint:** Participants 6 and 7 must be on mobile data (4G/5G) behind carrier-grade NAT (CGNAT). This forces TURN relay usage and validates the Coturn deployment.

---

## 3. Test Procedure

### Phase A: Room Creation & Join (2 minutes)

1. **Host creates a meeting** at `https://jehydro.com/meet`
   - Select **"Up to 8 people" (mesh mode)**
   - Copy the meeting URL
2. **Participants 2–5 join** from WiFi/wired connections — enter name, preview devices, join
3. **Participants 6–7 join** from mobile data — enter name, preview devices, join
4. **Participant 8 joins** last
5. **Verify:** All 8 participants visible in the participants panel with correct names

**Expected:** All 8 join within 30 seconds. No "Room full" or connection errors.

### Phase B: Audio Check (2 minutes)

1. Each participant speaks one at a time — "Testing 1, 2, 3"
2. Others confirm they can hear the speaker
3. **Verify:** Active speaker indicator highlights the correct tile
4. **Verify:** Audio level meter shows activity on the speaker's tile

**Expected:** All participants hear each other. <1 second latency. No echo or distortion.

### Phase C: Video Check (2 minutes)

1. All participants enable their cameras
2. **Verify:** All 8 video tiles render in a scrollable grid
3. **Verify:** Host sees all remote video streams
4. **Verify:** Mobile participant sees all remote video streams
5. Toggle camera off/on for two participants — verify state reflects correctly

**Expected:** All video streams visible. Camera toggle updates instantly for all.

### Phase D: Screen Sharing (2 minutes)

1. Participant 2 shares their screen (a browser tab with a presentation)
2. **Verify:** Shared content becomes the primary tile; camera thumbnails shrink
3. **Verify:** All 7 other participants see the shared content
4. Participant 2 stops sharing
5. Participant 6 (mobile data) shares their screen
6. **Verify:** All participants see the mobile screen share
7. **Verify:** Second simultaneous share attempt is blocked with error

**Expected:** Screen share works from desktop and mobile. One sharer at a time enforced.

### Phase E: Chat (2 minutes)

1. Host sends a chat message — "Hello everyone!"
2. All 7 other participants reply
3. **Verify:** Messages appear in real-time (< 200ms delivery)
4. **Verify:** Unread badge appears when chat panel is closed
5. Host disables chat — verify no one can send
6. Host re-enables chat

**Expected:** Chat works bidirectionally, host disable is enforced server-side.

### Phase F: Host Controls (2 minutes)

1. Host locks the meeting — verify new joins are rejected (test with a 9th browser tab)
2. Host unlocks the meeting — verify new joins work
3. Host mutes Participant 3 — verify Participant 3 sees "muted by host" and can unmute
4. Host uses "Mute All" — verify all non-host participants are muted
5. Host removes Participant 5 — verify Participant 5 is disconnected with "removed" message
6. Participant 5 re-joins
7. **Verify:** Host migration — host disconnects → longest-present participant becomes host

**Expected:** All host actions enforced server-side. Non-host cannot trigger host actions.

### Phase G: Endurance (5 minutes)

1. All 8 participants stay connected with AV active
2. Normal conversation — mix of speaking, silent periods, camera toggles
3. **Monitor:** CPU usage on server (signaling server should stay < 20% CPU)
4. **Monitor:** Bandwidth on server (TURN relay should be minimal for mesh mode)
5. **Monitor:** Client-side WebRTC stats (`chrome://webrtc-internals`)

**Expected:** Stable for entire duration. No ICE failures, no unexpected disconnections.

**Mobile metrics to capture (Phase G):**
- Open `chrome://webrtc-internals` on one desktop participant
- Go to `edge://webrtc-internals` on one Edge participant
- On mobile Safari: enable `WebRTC Logging` via Safari developer menu
- **Key metrics to record:**
  - Packet loss: < 1%
  - Jitter: < 50ms
  - RTT: < 200ms
  - ICE candidate pairs: at least one `succeeded` pair for each participant
  - TURN relay usage visible for CGNAT participants (candidate type `relay`)
  - Video bitrate: stable within expected range
  - Audio bitrate: stable at ~32-64 kbps

### Phase H: Clean Leave (1 minute)

1. Participants 8, 7, 6, 5, 4, 3, 2 leave one at a time using the Leave button
2. **Verify:** Each leave triggers a "left" toast for remaining participants
3. After all leave, host ends the meeting
4. **Verify:** Room is garbage collected (empty for 10 minutes → deleted)

**Expected:** Clean disconnections. No dangling socket connections.

---

## 4. Success Criteria

| Criterion | Target | Measure |
|-----------|--------|---------|
| Join time | < 3 seconds | Timer from click to video visible |
| Audio latency | < 1 second | Subjective from speaker to listener |
| Chat delivery | < 200ms | Server-side timestamp diff |
| Screen share start | < 3 seconds | Click to remote display |
| No dropped connections | 100% | All 8 participants stay connected for 5 minutes |
| TURN fallback | Works for CGNAT | Mobile data participants connect via TURN |
| Host actions | Enforced server-side | Forged event from non-host rejected |
| Server CPU | < 20% | `htop` on production server |

---

## 5. Troubleshooting

### Issue: Participant behind CGNAT cannot connect
- **Check:** Coturn logs: `docker compose logs coturn`
- **Check:** TURN credentials issued by backend: `curl https://meet-api.jehydro.com/api/turn/credentials`
- **Fix:** Verify `TURN_SECRET` matches between `.env` and coturn config
- **Fix:** Verify `TURN_URLS` in `.env` sends correct TURN URLs to clients

### Issue: Video not rendering for mobile participant
- **Check:** Mobile browser support (Safari/Chrome)
- **Check:** ICE candidates exchanged (`chrome://webrtc-internals` on desktop)
- **Fix:** Ensure mobile has granted camera/mic permissions
- **Fix:** Check that `NEXT_PUBLIC_ICE_SERVERS` includes TURN URLs

### Issue: Host actions not working
- **Check:** Server logs: `docker compose logs backend`
- **Fix:** Host token must be in sessionStorage (auto-set on create)
- **Fix:** Verify host UUID matches server-side

---

## 6. Post-Test Cleanup

1. Stop all test containers: `docker compose -f docker/docker-compose.yml down`
2. Check logs for errors: `docker compose logs backend | grep ERROR`
3. Save relevant logs if issues found
4. Update ROADMAP.md: check Phase 8 load test box

---

## 7. Automated Signaling Load Test

A companion script at `apps/backend/scripts/load-test.mjs` can validate the signaling layer independently without WebRTC. Run it before the full manual test:

```bash
cd apps/backend
node scripts/load-test.mjs --server https://meet-api.jehydro.com --participants 8
```

This script:
- Creates a room
- Joins N simulated participants
- Measures join times
- Tests chat delivery
- Tests host actions
- Reports pass/fail for each scenario

See the script header for full options.
