// @ts-nocheck — Playwright test file; types are loaded at runtime

/**
 * Jehydro Meet — Phase 11 Waiting Room E2E Tests
 *
 * Tests the waiting room and password features across browsers via Playwright.
 * Covers: password-protected rooms, waiting room admit/deny, admit-all/deny-all,
 * lock override, and leave waiting room.
 *
 * Prerequisites:
 *   - Backend running at http://localhost:4000
 *   - Frontend running at http://localhost:3000
 *
 * Run:
 *   npx playwright test e2e/waiting-room.spec.ts --project=chromium
 *   npx playwright test e2e/waiting-room.spec.ts --project=firefox
 *   npx playwright test e2e/waiting-room.spec.ts --project=webkit
 */

import { test, expect, type Page } from '@playwright/test';

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:3000';
const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:4000';

// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------

/** Wait for health check once before all tests */
let serverReady = false;
test.beforeAll(async () => {
  const resp = await fetch(`${BACKEND_URL}/health`).catch(() => null);
  serverReady = resp?.status === 200;
});
test.beforeEach(async () => {
  if (!serverReady) {
    test.skip();
  }
});

async function createMeeting(
  page: Page,
  name: string,
  opts?: { password?: string; waitingRoom?: boolean }
): Promise<string> {
  await page.goto(FRONTEND_URL);
  // Click the 'Create Meeting' button on the home page to reveal the form
  await page.click('text=Create Meeting');
  await page.waitForSelector('#create-name', { timeout: 5000 });
  await page.fill('#create-name', name);
  if (opts?.password) {
    await page.fill('#meeting-password', opts.password);
  }
  if (opts?.waitingRoom) {
    await page.check('input[type="checkbox"]');
  }
  // Click the submit button inside the form
  await page.click('button:has-text("Create Meeting")');

  // Wait for the room page to load (we end up in preview)
  await page.waitForURL(/\/meet\//, { timeout: 10000 });
  const url = page.url();
  const roomId = url.split('/meet/')[1]?.split('?')[0] ?? '';

  // Should be on the join preview page now
  await expect(page.locator('text=Ready to join?')).toBeVisible({ timeout: 10000 });
  return roomId;
}

async function joinMeeting(page: Page, roomId: string, name: string): Promise<void> {
  await page.goto(`${FRONTEND_URL}/meet/${roomId}`);
  await page.fill('#room-name', name);
  await page.click('text=Next');
  // Now on preview
  await expect(page.locator('text=Ready to join?')).toBeVisible({ timeout: 10000 });
}

async function clickJoin(page: Page): Promise<void> {
  await page.click('text=Join Now');
}

// -----------------------------------------------------------
// Tests
// -----------------------------------------------------------

test.describe('Phase 11 — Waiting Room & Password', () => {
  // -----------------------------------------------------------
  // TC-01: Create meeting with waiting room enabled
  // -----------------------------------------------------------
  test('TC-01: Host creates meeting with waiting room', async ({ page }) => {
    await page.goto(FRONTEND_URL);

    // Click the 'Create Meeting' button on the home page to reveal the form
    await page.click('text=Create Meeting');
    await page.waitForSelector('#create-name', { timeout: 5000 });

    // Fill in host name
    await page.fill('#create-name', 'Host User');

    // Select mesh mode (radio button)
    await page.click('text=Up to 8 people');

    // Enable waiting room (checkbox is inside Meeting Options)
    await page.click('text=Waiting room');

    // Click the submit button inside the form
    await page.click('button:has-text("Create Meeting")');

    // Should redirect to meet page
    await page.waitForURL(/\/meet\//, { timeout: 15000 });
    await expect(page.locator('text=Ready to join?')).toBeVisible({ timeout: 10000 });
  });

  // -----------------------------------------------------------
  // TC-02: Join waiting room — see waiting screen
  // -----------------------------------------------------------
  test('TC-02: Participant sees waiting screen', async ({ browser }) => {
    // Create a room with waiting room in host context
    const hostPage = await browser.newPage();
    const roomId = await createMeeting(hostPage, 'Host WR', { waitingRoom: true });
    // Join as host to enter meeting
    await clickJoin(hostPage);
    // Check host entered the meeting (Leave button visible in toolbar)
    await expect(hostPage.locator('button[title="Leave meeting"]')).toBeVisible({ timeout: 10000 });

    // Open participants panel to see waiting list
    await hostPage.click('button[title="View participants"]');

    // Guest joins in a separate context
    const guestPage = await browser.newPage();
    await joinMeeting(guestPage, roomId, 'Waiter One');
    await clickJoin(guestPage);

    // Guest should see waiting screen
    await expect(guestPage.locator('text=Waiting for host')).toBeVisible({ timeout: 10000 });
    await expect(guestPage.locator('text=Leave waiting room')).toBeVisible();

    // Host should see notification
    await expect(hostPage.locator('text=Waiter One is waiting')).toBeVisible({ timeout: 5000 });

    await hostPage.close();
    await guestPage.close();
  });

  // -----------------------------------------------------------
  // TC-03: Admit single participant
  // -----------------------------------------------------------
  test('TC-03: Host admits a waiting participant', async ({ browser }) => {
    const hostPage = await browser.newPage();
    const roomId = await createMeeting(hostPage, 'Host Admits', { waitingRoom: true });
    await clickJoin(hostPage);
    await expect(hostPage.locator('button[title="Leave meeting"]')).toBeVisible({ timeout: 10000 });

    // Open participants panel
    await hostPage.click('button[title="View participants"]');

    // Guest joins
    const guestPage = await browser.newPage();
    await joinMeeting(guestPage, roomId, 'Admit Me');
    await clickJoin(guestPage);
    await expect(guestPage.locator('text=Waiting for host')).toBeVisible({ timeout: 10000 });

    // Host admits the guest via the ✅ button
    await expect(hostPage.locator('text=Waiting (1)')).toBeVisible({ timeout: 5000 });
    await hostPage.click('button[title="Admit"]');

    // Guest should now be in the meeting
    await expect(guestPage.locator('button[title="Leave meeting"]')).toBeVisible({ timeout: 10000 });

    await hostPage.close();
    await guestPage.close();
  });

  // -----------------------------------------------------------
  // TC-04: Deny single participant
  // -----------------------------------------------------------
  test('TC-04: Host denies a waiting participant', async ({ browser }) => {
    const hostPage = await browser.newPage();
    const roomId = await createMeeting(hostPage, 'Host Denies', { waitingRoom: true });
    await clickJoin(hostPage);
    await expect(hostPage.locator('button[title="Leave meeting"]')).toBeVisible({ timeout: 10000 });

    await hostPage.click('button[title="View participants"]');

    const guestPage = await browser.newPage();
    await joinMeeting(guestPage, roomId, 'Deny Me');
    await clickJoin(guestPage);
    await expect(guestPage.locator('text=Waiting for host')).toBeVisible({ timeout: 10000 });

    // Host denies via the ❌ button
    await expect(hostPage.locator('text=Waiting (1)')).toBeVisible({ timeout: 5000 });
    await hostPage.click('button[title="Deny"]');

    // Guest should see denial
    await expect(guestPage.locator('text=denied your request')).toBeVisible({ timeout: 10000 });

    await hostPage.close();
    await guestPage.close();
  });

  // -----------------------------------------------------------
  // TC-05: Admit all participants
  // -----------------------------------------------------------
  test('TC-05: Host admits all waiting participants', async ({ browser }) => {
    const hostPage = await browser.newPage();
    const roomId = await createMeeting(hostPage, 'Host AdmitAll', { waitingRoom: true });
    await clickJoin(hostPage);
    await expect(hostPage.locator('button[title="Leave meeting"]')).toBeVisible({ timeout: 10000 });
    await hostPage.click('button[title="View participants"]');

    // Three guests join
    const guests: Page[] = [];
    for (let i = 0; i < 3; i++) {
      const guest = await browser.newPage();
      await joinMeeting(guest, roomId, `Waiter ${i + 1}`);
      await clickJoin(guest);
      await expect(guest.locator('text=Waiting for host')).toBeVisible({ timeout: 10000 });
      guests.push(guest);
    }

    // Wait for waiting list to show 3
    await expect(hostPage.locator('text=Waiting (3)')).toBeVisible({ timeout: 5000 });

    // Click "Admit All"
    await hostPage.click('button:has-text("Admit All")');

    // All guests should enter the meeting
    for (const guest of guests) {
      await expect(guest.locator('button[title="Leave meeting"]')).toBeVisible({ timeout: 10000 });
      await guest.close();
    }

    await hostPage.close();
  });

  // -----------------------------------------------------------
  // TC-06: Deny all participants
  // -----------------------------------------------------------
  test('TC-06: Host denies all waiting participants', async ({ browser }) => {
    const hostPage = await browser.newPage();
    const roomId = await createMeeting(hostPage, 'Host DenyAll', { waitingRoom: true });
    await clickJoin(hostPage);
    await expect(hostPage.locator('button[title="Leave meeting"]')).toBeVisible({ timeout: 10000 });
    await hostPage.click('button[title="View participants"]');

    // Three guests join
    const guests: Page[] = [];
    for (let i = 0; i < 3; i++) {
      const guest = await browser.newPage();
      await joinMeeting(guest, roomId, `Deny ${i + 1}`);
      await clickJoin(guest);
      await expect(guest.locator('text=Waiting for host')).toBeVisible({ timeout: 10000 });
      guests.push(guest);
    }

    await expect(hostPage.locator('text=Waiting (3)')).toBeVisible({ timeout: 5000 });

    // Click "Deny All"
    await hostPage.click('button:has-text("Deny All")');

    // All guests should see denial
    for (const guest of guests) {
      await expect(guest.locator('text=denied your request')).toBeVisible({ timeout: 10000 });
      await guest.close();
    }

    await hostPage.close();
  });

  // -----------------------------------------------------------
  // TC-07: Leave waiting room
  // -----------------------------------------------------------
  test('TC-07: Participant leaves waiting room', async ({ browser }) => {
    const hostPage = await browser.newPage();
    const roomId = await createMeeting(hostPage, 'Host Leave', { waitingRoom: true });
    await clickJoin(hostPage);

    const guestPage = await browser.newPage();
    await joinMeeting(guestPage, roomId, 'Leaving');
    await clickJoin(guestPage);
    await expect(guestPage.locator('text=Waiting for host')).toBeVisible({ timeout: 10000 });

    // Guest clicks "Leave waiting room"
    await guestPage.click('text=Leave waiting room');

    // Guest should be back at the lobby
    await expect(guestPage.locator('text=Join Meeting')).toBeVisible({ timeout: 5000 });

    await hostPage.close();
    await guestPage.close();
  });

  // -----------------------------------------------------------
  // TC-08: Password-protected room
  // -----------------------------------------------------------
  test('TC-08: Password-protected room join with correct password', async ({ browser }) => {
    const hostPage = await browser.newPage();
    await hostPage.goto(FRONTEND_URL);
    // Click the 'Create Meeting' button on the home page to reveal the form
    await hostPage.click('text=Create Meeting');
    await hostPage.waitForSelector('#create-name', { timeout: 5000 });
    await hostPage.fill('#create-name', 'Host Pwd');
    await hostPage.fill('#meeting-password', 'secret123');
    await hostPage.click('button:has-text("Create Meeting")');
    await hostPage.waitForURL(/\/meet\//, { timeout: 10000 });
    const roomId = hostPage.url().split('/meet/')[1]?.split('?')[0] ?? '';
    await clickJoin(hostPage);
    await expect(hostPage.locator('button[title="Leave meeting"]')).toBeVisible({ timeout: 10000 });

    // Guest joins with correct password
    const guestPage = await browser.newPage();
    await guestPage.goto(`${FRONTEND_URL}/meet/${roomId}`);
    await guestPage.fill('#room-name', 'Correct Pwd');
    await guestPage.click('text=Next');
    await expect(guestPage.locator('text=Ready to join?')).toBeVisible({ timeout: 10000 });

    // Click Join Now first — server will respond with PASSWORD_REQUIRED
    await guestPage.click('text=Join Now');

    // Password prompt should appear after server response
    await expect(guestPage.locator('text=This meeting requires a password')).toBeVisible({ timeout: 10000 });
    await guestPage.fill('#join-password', 'secret123');
    await guestPage.click('text=Join Now');

    // Guest should enter the meeting
    await expect(guestPage.locator('button[title="Leave meeting"]')).toBeVisible({ timeout: 10000 });
    await guestPage.close();
  });

  // -----------------------------------------------------------
  // TC-09: Incorrect password rejected
  // -----------------------------------------------------------
  test('TC-09: Incorrect password shows error', async ({ browser }) => {
    const hostPage = await browser.newPage();
    await hostPage.goto(FRONTEND_URL);
    // Click the 'Create Meeting' button on the home page to reveal the form
    await hostPage.click('text=Create Meeting');
    await hostPage.waitForSelector('#create-name', { timeout: 5000 });
    await hostPage.fill('#create-name', 'Host Pwd2');
    await hostPage.fill('#meeting-password', 'secret123');
    await hostPage.click('button:has-text("Create Meeting")');
    await hostPage.waitForURL(/\/meet\//, { timeout: 10000 });
    const roomId = hostPage.url().split('/meet/')[1]?.split('?')[0] ?? '';
    await clickJoin(hostPage);

    // Guest joins with wrong password
    const guestPage = await browser.newPage();
    await guestPage.goto(`${FRONTEND_URL}/meet/${roomId}`);
    await guestPage.fill('#room-name', 'Wrong Pwd');
    await guestPage.click('text=Next');
    await expect(guestPage.locator('text=Ready to join?')).toBeVisible({ timeout: 10000 });

    // Click Join Now first — server will respond with PASSWORD_REQUIRED
    await guestPage.click('text=Join Now');

    // Password prompt should appear after server response
    await expect(guestPage.locator('text=This meeting requires a password')).toBeVisible({ timeout: 10000 });
    await guestPage.fill('#join-password', 'wrongpassword');
    await guestPage.click('text=Join Now');

    // Should see error
    await expect(guestPage.locator('text=Incorrect password')).toBeVisible({ timeout: 5000 });
    await expect(guestPage.locator('#join-password')).toBeVisible();
    await guestPage.close();
  });

  // -----------------------------------------------------------
  // TC-10: Admit All / Deny All buttons visibility
  // -----------------------------------------------------------
  test('TC-10: Bulk buttons visible only with 2+ waiters', async ({ browser }) => {
    const hostPage = await browser.newPage();
    const roomId = await createMeeting(hostPage, 'Host Bulk', { waitingRoom: true });
    await clickJoin(hostPage);
    await expect(hostPage.locator('button[title="Leave meeting"]')).toBeVisible({ timeout: 10000 });
    await hostPage.click('button[title="View participants"]');

    // One waiter joins — no bulk buttons
    const guest1 = await browser.newPage();
    await joinMeeting(guest1, roomId, 'Only One');
    await clickJoin(guest1);
    await expect(guest1.locator('text=Waiting for host')).toBeVisible({ timeout: 10000 });
    await expect(hostPage.locator('text=Waiting (1)')).toBeVisible({ timeout: 5000 });

    // Admit All / Deny All should NOT be visible with only 1
    await expect(hostPage.locator('button:has-text("Admit All")')).not.toBeVisible();
    await expect(hostPage.locator('button:has-text("Deny All")')).not.toBeVisible();

    // Second waiter joins
    const guest2 = await browser.newPage();
    await joinMeeting(guest2, roomId, 'Second One');
    await clickJoin(guest2);
    await expect(guest2.locator('text=Waiting for host')).toBeVisible({ timeout: 10000 });
    await expect(hostPage.locator('text=Waiting (2)')).toBeVisible({ timeout: 5000 });

    // Bulk buttons SHOULD be visible now
    await expect(hostPage.locator('button:has-text("Admit All")')).toBeVisible();
    await expect(hostPage.locator('button:has-text("Deny All")')).toBeVisible();

    await hostPage.close();
    await guest1.close();
    await guest2.close();
  });

  // -----------------------------------------------------------
  // TC-11: Lock overrides admit
  // -----------------------------------------------------------
  test('TC-11: Lock overrides admit (security check)', async ({ browser }) => {
    const hostPage = await browser.newPage();
    const roomId = await createMeeting(hostPage, 'Host Lock', { waitingRoom: true });
    await clickJoin(hostPage);
    await expect(hostPage.locator('button[title="Leave meeting"]')).toBeVisible({ timeout: 10000 });
    await hostPage.click('button[title="View participants"]');

    // Guest joins and waits
    const guestPage = await browser.newPage();
    await joinMeeting(guestPage, roomId, 'Locked Waiter');
    await clickJoin(guestPage);
    await expect(guestPage.locator('text=Waiting for host')).toBeVisible({ timeout: 10000 });
    await expect(hostPage.locator('text=Waiting (1)')).toBeVisible({ timeout: 5000 });

    // Host locks the meeting (lock button is in the toolbar, only visible to host)
    await hostPage.click('button[title="Lock meeting (prevent new joins)"]');
    await expect(hostPage.locator('text=Meeting locked')).toBeVisible({ timeout: 5000 });

    // Host tries to admit the waiting participant (should be blocked)
    // The admit button should still be visible in the waiting list
    await hostPage.click('button[title="Admit"]');

    // Host should see an error message — check for the toast
    await expect(hostPage.locator('text=Cannot admit participants')).toBeVisible({ timeout: 5000 });

    // Guest should still be waiting (not admitted)
    await expect(guestPage.locator('text=Waiting for host')).toBeVisible();

    // Host unlocks the meeting
    await hostPage.click('button[title="Unlock meeting"]');

    // Now admit should work
    await hostPage.click('button[title="Admit"]');
    await expect(guestPage.locator('button[title="Leave meeting"]')).toBeVisible({ timeout: 10000 });

    await hostPage.close();
    await guestPage.close();
  });
});
