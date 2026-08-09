# Jehydro Meet — Cross-Browser Test Plan

**Version:** 1.0  
**Focus:** Phase 11 Waiting Room features (password, admit/deny, admit-all/deny-all)  
**Scope:** Signaling layer only (no WebRTC media). Tests focus on Socket.IO event flow, UI rendering, and host-client interaction across browsers.

---

## 1. Test Matrix

| Browser | OS | Notes |
|---------|----|-------|
| Chrome 120+ | Windows / macOS / Android | Primary target |
| Firefox 120+ | Windows / macOS | Full support |
| Safari 17+ | macOS / iOS | WebKit quirks expected |
| Edge 120+ | Windows | Chromium-based, should match Chrome |
| Samsung Internet | Android | Chromium-based |

---

## 2. Pre-Test Setup

1. Start the backend: `pnpm --filter @jehydro/backend dev`
2. Start the frontend: `pnpm --filter @jehydro/frontend dev`
3. Open the app at `http://localhost:3000` in each browser
4. Verify the health endpoint: `curl http://localhost:4000/health`

---

## 3. Test Scenarios

### TC-01: Create Meeting with Password + Waiting Room

**Steps:**
1. Navigate to `http://localhost:3000`
2. Enter display name "Host User"
3. Select "Up to 8 people" (mesh)
4. Expand Meeting Options
5. Enter password: "test123"
6. Check "Waiting room" toggle
7. Click "Create Meeting"

**Expected across ALL browsers:**
- [ ] Meeting created successfully
- [ ] Redirects to `/meet/<roomId>`
- [ ] Preview screen loads with camera preview
- [ ] Host enters the meeting after clicking Join

**Known issues:**
- Safari: Device labels may show as empty until camera/mic permission granted
- Safari: AudioContext constructor requires `webkitAudioContext` fallback (fixed)

---

### TC-02: Join with Correct Password

**Steps:**
1. Open the meeting link in a second browser tab/window
2. Enter display name "Joiner Alpha"
3. Click "Next" to go to preview
4. When password prompt appears, enter "test123"
5. Click "Join Now"

**Expected:**
- [ ] Password prompt appears in preview screen
- [ ] Correct password → joins room successfully
- [ ] Host sees "Joiner Alpha joined" toast

---

### TC-03: Join with Incorrect Password

**Steps:**
1. Open meeting link in new tab
2. Enter display name "Bad Password Tester"
3. Enter incorrect password "wrongpass"
4. Click "Join Now"

**Expected:**
- [ ] Error message "Incorrect password" displayed
- [ ] Password field remains visible for retry
- [ ] After 5 failed attempts → "Too many incorrect attempts" message shown
- [ ] No room join occurs

---

### TC-04: Join Password-Protected Room Without Password (Password Prompt)

**Steps:**
1. Open meeting link in new tab
2. Enter display name
3. Go to preview — do NOT enter password
4. Click "Join Now"

**Expected:**
- [ ] Password prompt appears (no error)
- [ ] User can enter password and re-submit
- [ ] Back button works to return to lobby

---

### TC-05: Waiting Room — Join and Wait

**Prerequisites:** Room created with waiting room enabled, password optional

**Steps:**
1. Open meeting link in new tab (do NOT join as host in this tab)
2. Enter display name "Waiter One"
3. Click "Join Now"

**Expected:**
- [ ] "Waiting for host" screen appears
- [ ] Animated dots indicator visible
- [ ] "Leave waiting room" button visible and clickable
- [ ] Host sees "Waiter One is waiting to join" toast
- [ ] Host sees participant in waiting list (Participants Panel)

---

### TC-06: Waiting Room — Admit Single Participant

**Steps:**
1. Host opens Participants Panel
2. Clicks the ✅ (Admit) button for "Waiter One"

**Expected:**
- [ ] "Waiter One" removed from waiting list
- [ ] "Waiter One" appears in participants list
- [ ] Waiter One's screen transitions from "Waiting" to meeting room
- [ ] Waiter One sees video tiles and toolbar

---

### TC-07: Waiting Room — Deny Single Participant

**Steps:**
1. Waiter Two joins while waiting room active
2. Host clicks the ❌ (Deny) button for "Waiter Two"

**Expected:**
- [ ] "Waiter Two" removed from waiting list
- [ ] Waiter Two sees "The host denied your request" error screen
- [ ] Waiter Two can click "Try Again" to return to lobby

---

### TC-08: Waiting Room — Admit All

**Steps:**
1. Waiters 3, 4, 5 join (3 waiting participants)
2. Host opens Participants Panel
3. Host clicks "Admit All" button

**Expected:**
- [ ] All 3 waiters admitted simultaneously
- [ ] Waiting list section disappears (empty)
- [ ] All 3 waiters see video tiles and toolbar
- [ ] Host sees "X joined" toasts for each

---

### TC-09: Waiting Room — Deny All

**Steps:**
1. Waiters 6, 7, 8 join (3 waiting participants)
2. Host opens Participants Panel
3. Host clicks "Deny All" button

**Expected:**
- [ ] All 3 waiters denied simultaneously
- [ ] Each waiter sees "The host denied your request" error screen
- [ ] Waiting list section disappears
- [ ] No participants added to the room

---

### TC-10: Lock Overrides Admit

**Steps:**
1. Waiter 9 joins (waiting)
2. Host locks the meeting
3. Host attempts to admit Waiter 9

**Expected:**
- [ ] Host sees error: "Cannot admit participants while the meeting is locked"
- [ ] Waiter 9 remains in waiting list
- [ ] Host unlocks meeting → can admit normally

---

### TC-11: Leave Waiting Room

**Steps:**
1. Waiter 10 joins (waiting)
2. Waiter 10 clicks "Leave waiting room"

**Expected:**
- [ ] Waiter 10 returns to lobby screen
- [ ] Host sees waiter removed from waiting list (no toast for "joined")
- [ ] No error

---

### TC-12: Admit All Buttons Visibility

**Steps:**
1. 1 waiter joins
2. Check if "Admit All"/"Deny All" buttons are visible

**Expected:**
- [ ] With 1 waiter: no bulk buttons (single admit/deny only)
- [ ] With 2+ waiters: "Admit All" and "Deny All" buttons appear

---

### TC-13: UI Rendering — Dark Mode

**Steps:**
1. Toggle dark mode on
2. Repeat TC-01 through TC-12

**Expected:**
- [ ] All waiting room UI elements render correctly in dark mode
- [ ] Text contrast meets accessibility standards
- [ ] Buttons, badges, and icons visible

---

### TC-14: Mobile Viewport (375px)

**Steps:**
1. Open browser dev tools, set viewport to 375px × 812px (iPhone)
2. Repeat TC-01, TC-05, TC-06, TC-08

**Expected:**
- [ ] No horizontal scroll
- [ ] All buttons tappable
- [ ] Waiting room screen fits viewport
- [ ] Participants panel slides in correctly

---

### TC-15: Screen Reader Accessibility

**Steps:**
1. Enable VoiceOver (macOS) / TalkBack (Android) / NVDA (Windows)
2. Navigate through waiting room screens

**Expected:**
- [ ] All buttons have accessible labels (title attributes)
- [ ] Waiting status announced
- [ ] Participant names announced in waiting list

---

## 4. Browser-Specific Known Issues

| Issue | Browser | Status | Workaround |
|-------|---------|--------|------------|
| `AudioContext` prefixed | Safari ≤16.4 | ✅ Fixed | Added `webkitAudioContext` fallback in JoinPreview |
| `backdrop-filter` | Safari | ✅ Supported (v15+) | Standard Tailwind class works |
| Socket.IO transport | Safari | ✅ Should work | Uses WebSocket transport with polling fallback |
| Device labels empty | Safari (no permission) | ⚠️ Known limitation | Labels show after user grants camera/mic permission |
| `SVG` rendering | Safari | ⚠️ Minor differences | Inline SVGs render correctly |

---

## 5. Automated Playwright Tests

A companion test script at `apps/frontend/e2e/waiting-room.spec.ts` automates the core scenarios using Playwright. Run it across all 3 engines:

```bash
# Chromium only
npx playwright test --project=chromium

# All browsers
npx playwright test

# Specific test file
npx playwright test e2e/waiting-room.spec.ts --project=firefox
```

The script tests:
- Creating a meeting with password + waiting room
- Joining with correct/incorrect passwords
- Waiting room admit/deny/admit-all/deny-all
- Lock override
- Leave waiting room

Note: The Playwright script requires the backend to be running at `http://localhost:4000` and the frontend at `http://localhost:3000`.

---

## 6. Results Log Template

```
Browser: ___________  Version: ___________  OS: ___________

| TC-ID | Description              | Pass/Fail | Notes |
|-------|--------------------------|-----------|-------|
| TC-01 | Create with password+WR  |           |       |
| TC-02 | Join with correct pwd    |           |       |
| TC-03 | Join with wrong pwd      |           |       |
| TC-04 | No password prompt        |           |       |
| TC-05 | Waiting room join        |           |       |
| TC-06 | Admit single             |           |       |
| TC-07 | Deny single              |           |       |
| TC-08 | Admit all                |           |       |
| TC-09 | Deny all                 |           |       |
| TC-10 | Lock overrides admit     |           |       |
| TC-11 | Leave waiting room       |           |       |
| TC-12 | Bulk buttons visibility  |           |       |
| TC-13 | Dark mode                |           |       |
| TC-14 | Mobile 375px             |           |       |
| TC-15 | Screen reader            |           |       |
```
