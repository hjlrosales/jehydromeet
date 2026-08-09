#!/usr/bin/env node

/**
 * Jehydro Meet — Signaling Load Test
 *
 * Simulates multiple participants joining a mesh meeting room via Socket.IO
 * and measures signaling performance. Tests room lifecycle, chat, host actions,
 * screen share signaling, and TURN credential issuance.
 *
 * Does NOT test WebRTC media — only the signaling layer.
 *
 * Usage:
 *   node scripts/load-test.mjs [options]
 *
 * Options:
 *   --server <url>         Backend URL (default: http://localhost:4000)
 *   --participants <n>     Number of participants to simulate (default: 8)
 *   --message-delay <ms>   Delay between each join (default: 500)
 *   --timeout <ms>         Timeout for each operation (default: 10000)
 *   --verbose              Log individual events
 *
 * Example:
 *   node scripts/load-test.mjs --server https://meet-api.jehydro.com --participants 8 --verbose
 *
 * Exit codes:
 *   0 — All tests passed
 *   1 — One or more tests failed
 */

import { io as ioc } from 'socket.io-client';
import { performance } from 'perf_hooks';

// Parse arguments
const args = process.argv.slice(2);
const SERVER_URL = getArg('--server', 'http://localhost:4000');
const NUM_PARTICIPANTS = parseInt(getArg('--participants', '8'), 10);
const JOIN_DELAY_MS = parseInt(getArg('--message-delay', '500'), 10);
const OP_TIMEOUT_MS = parseInt(getArg('--timeout', '10000'), 10);
const VERBOSE = args.includes('--verbose');

// Test state
let passed = 0;
let failed = 0;
const testResults = [];
const sockets = [];

function getArg(name, fallback) {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] ?? fallback : fallback;
}

function log(msg, level = 'info') {
  const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : level === 'pass' ? '✅' : '📋';
  console.log(`${prefix} ${msg}`);
}

function verbose(msg) {
  if (VERBOSE) console.log(`  ${msg}`);
}

function assert(condition, label) {
  if (condition) {
    passed++;
    log(label, 'pass');
    return true;
  } else {
    failed++;
    log(`${label} — FAILED`, 'error');
    return false;
  }
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function socketConnect(url) {
  return new Promise((resolve, reject) => {
    const sock = ioc(url, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });
    const timer = setTimeout(() => {
      sock.close();
      reject(new Error('Connection timeout'));
    }, OP_TIMEOUT_MS);

    sock.on('connect', () => {
      clearTimeout(timer);
      resolve(sock);
    });
    sock.on('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function waitForEvent(socket, event, timeoutMs = OP_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for ${event}`));
    }, timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

// -----------------------------------------------------------
// Main Test
// -----------------------------------------------------------
async function run() {
  console.log('');
  log('Jehydro Meet — Signaling Load Test');
  log(`Server: ${SERVER_URL}`);
  log(`Participants: ${NUM_PARTICIPANTS}`);
  log(`Timeout: ${OP_TIMEOUT_MS}ms`);
  console.log('');

  try {
    // =========================================================
    // Test 1: Health check
    // =========================================================
    log('Test 1: Health check');
    try {
      const resp = await fetch(`${SERVER_URL}/health`);
      const data = await resp.json();
      assert(data.status === 'ok', 'Server health check');
    } catch (err) {
      assert(false, `Server health check — ${err.message}`);
      log('Server unreachable. Aborting.', 'error');
      process.exit(1);
    }

    // =========================================================
    // Test 2: TURN credential issuance
    // =========================================================
    log('Test 2: TURN credentials');
    try {
      const resp = await fetch(`${SERVER_URL}/api/turn/credentials`);
      const data = await resp.json();
      assert(!!data.iceServers, 'TURN endpoint returns iceServers');
      assert(data.iceServers.length > 0, 'TURN endpoint returns at least one ICE server');
      const hasTurn = data.iceServers.some((s) => s.urls && s.urls.some((u) => u.startsWith('turn:')));
      assert(hasTurn, 'TURN URLs present in credentials');
      verbose(`TURN credentials: ${JSON.stringify(data.iceServers)}`);
    } catch (err) {
      assert(false, `TURN credentials check — ${err.message}`);
    }

    // =========================================================
    // Test 3: Create room + host connects
    // =========================================================
    log('Test 3: Create room');
    const hostSocket = await socketConnect(SERVER_URL);
    sockets.push(hostSocket);
    verbose(`Host socket connected: ${hostSocket.id}`);

    let hostId;
    const createStart = performance.now();
    hostSocket.emit('room:create', {
      mediaMode: 'mesh',
      displayName: 'Load Test Host',
      micEnabled: true,
      cameraEnabled: true,
    });

    const created = await waitForEvent(hostSocket, 'room:created');
    const createTime = performance.now() - createStart;
    hostId = created.hostId;
    verbose(`Room created: ${created.roomId} in ${createTime.toFixed(0)}ms`);
    assert(!!created.roomId, 'Room created with room ID');
    assert(!!created.hostToken, 'Host token received');
    assert(createTime < 3000, `Room creation time (${createTime.toFixed(0)}ms < 3000ms)`);

    // Also wait for ROOM_JOINED
    await waitForEvent(hostSocket, 'room:joined');

    const roomId = created.roomId;

    // =========================================================
    // Test 4: Join participants sequentially
    // =========================================================
    log(`Test 4: Join ${NUM_PARTICIPANTS - 1} participants`);

    const joinTimes = [];
    const participantUuids = [hostId];
    for (let i = 2; i <= NUM_PARTICIPANTS; i++) {
      const start = performance.now();
      const sock = await socketConnect(SERVER_URL);
      sockets.push(sock);

      sock.emit('room:join', {
        roomId,
        displayName: `Load Tester ${i}`,
        micEnabled: true,
        cameraEnabled: true,
      });

      const joined = await waitForEvent(sock, 'room:joined');
      const joinTime = performance.now() - start;
      joinTimes.push(joinTime);
      participantUuids.push(joined.yourUuid);
      verbose(`Participant ${i} joined in ${joinTime.toFixed(0)}ms`);

      if (i < NUM_PARTICIPANTS) {
        await wait(JOIN_DELAY_MS);
      }
    }

    const avgJoin = joinTimes.reduce((a, b) => a + b, 0) / joinTimes.length;
    const maxJoin = Math.max(...joinTimes);
    assert(avgJoin < 3000, `Average join time (${avgJoin.toFixed(0)}ms < 3000ms)`);
    assert(maxJoin < 5000, `Max join time (${maxJoin.toFixed(0)}ms < 5000ms)`);

    // =========================================================
    // Test 5: Verify all participants visible
    // =========================================================
    log('Test 5: Participant visibility');

    // Host should have seen PARTICIPANT_JOINED events for all others
    const hostJoinedEvents = [];
    const onJoined = (payload) => hostJoinedEvents.push(payload.participant);
    hostSocket.on('participant:joined', onJoined);

    // Wait for all participants to be seen
    await wait(2000);

    assert(hostJoinedEvents.length >= NUM_PARTICIPANTS - 1,
      `Host received participant:joined events (${hostJoinedEvents.length} >= ${NUM_PARTICIPANTS - 1})`);
    assert(sockets.length === NUM_PARTICIPANTS,
      `All ${NUM_PARTICIPANTS} sockets connected`);

    hostSocket.off('participant:joined', onJoined);

    // =========================================================
    // Test 6: Chat delivery
    // =========================================================
    log('Test 6: Chat delivery');

    const chatStart = performance.now();
    const chatId = `load-test-${Date.now()}`;

    hostSocket.emit('chat:message', {
      message: {
        id: chatId,
        senderUuid: hostId,
        senderName: 'Load Test Host',
        text: `Hello from load test! (${NUM_PARTICIPANTS} participants)`,
        timestamp: Date.now(),
      },
    });

    let chatDelivered = 0;
    const chatPromises = [];
    for (let i = 1; i < sockets.length; i++) {
      chatPromises.push(
        new Promise((resolve) => {
          const timer = setTimeout(() => resolve(false), 3000);
          sockets[i].once('chat:message', (payload) => {
            clearTimeout(timer);
            if (payload.message.id === chatId) chatDelivered++;
            resolve(true);
          });
        })
      );
    }

    await Promise.all(chatPromises);
    const chatTime = performance.now() - chatStart;

    assert(chatDelivered === NUM_PARTICIPANTS - 1,
      `Chat delivered to all participants (${chatDelivered}/${NUM_PARTICIPANTS - 1})`);
    assert(chatTime < 2000,
      `Chat delivery time (${chatTime.toFixed(0)}ms < 2000ms)`);

    // =========================================================
    // Test 7: Screen share signaling
    // =========================================================
    log('Test 7: Screen share signaling');

    // Non-host participant starts screen share
    const sharerSocket = sockets[1];
    sharerSocket.emit('screen-share:start', { uuid: participantUuids[1] });

    const shareStarted = await waitForEvent(hostSocket, 'screen-share:started');
    assert(shareStarted.uuid === participantUuids[1],
      'Screen share start broadcast to room');

    // Second share attempt should be blocked
    sharerSocket.emit('screen-share:start', { uuid: participantUuids[1] });
    const shareBlocked = await waitForEvent(sharerSocket, 'screen-share:blocked');
    assert(shareBlocked.reason && shareBlocked.reason.length > 0,
      'Second share attempt blocked with reason');

    // Stop screen share
    sharerSocket.emit('screen-share:stop', { uuid: participantUuids[1] });
    const shareStopped = await waitForEvent(hostSocket, 'screen-share:stopped');
    assert(shareStopped.uuid === participantUuids[1],
      'Screen share stop broadcast to room');

    // =========================================================
    // Test 8: Host actions (lock/unlock)
    // =========================================================
    log('Test 8: Host actions');

    hostSocket.emit('room:lock');
    await waitForEvent(hostSocket, 'room:locked');
    assert(true, 'Host can lock meeting');

    hostSocket.emit('room:unlock');
    await waitForEvent(hostSocket, 'room:unlocked');
    assert(true, 'Host can unlock meeting');

    // =========================================================
    // Test 9: Connection cleanup on leave
    // =========================================================
    log('Test 9: Leave and cleanup');

    const leavePromises = [];
    for (let i = 1; i < sockets.length; i++) {
      const sock = sockets[i];
      const leftPromise = new Promise((resolve) => {
        hostSocket.once('participant:left', (payload) => {
          resolve(!!payload.uuid);
        });
      });
      sock.emit('room:leave');
      leavePromises.push(leftPromise);
      await wait(200);
    }

    const leaveResults = await Promise.all(leavePromises);
    assert(leaveResults.every(Boolean), 'All participants leave cleanly');

    // =========================================================
    // Summary
    // =========================================================
    console.log('');
    log('='.repeat(50));
    log(`RESULTS: ${passed} passed, ${failed} failed`, failed > 0 ? 'error' : 'pass');
    log('='.repeat(50));
    console.log('');

    // Cleanup
    for (const sock of sockets) {
      try { sock.close(); } catch {}
    }

    process.exit(failed > 0 ? 1 : 0);

  } catch (err) {
    log(`Fatal error: ${err.message}`, 'error');
    console.error(err);
    for (const sock of sockets) {
      try { sock.close(); } catch {}
    }
    process.exit(1);
  }
}

run();
