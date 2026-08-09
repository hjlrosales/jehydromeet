#!/usr/bin/env node
/**
 * open-report.js
 *
 * Opens the latest Playwright HTML report in the default browser.
 * Also prints a summary of the last test run from test-results/.last-run.json.
 *
 * Usage:
 *   node scripts/open-report.js
 *   pnpm report:open
 */

const { exec } = require('child_process');
const fs   = require('fs');
const path = require('path');

const ROOT       = path.resolve(__dirname, '..');
const REPORT_DIR = path.join(ROOT, 'playwright-report');
const REPORT_HTML= path.join(REPORT_DIR, 'index.html');
const LAST_RUN   = path.join(ROOT, 'test-results', '.last-run.json');

// --- Print last run summary ---
try {
  const raw    = fs.readFileSync(LAST_RUN, 'utf-8');
  const lastRun = JSON.parse(raw);
  const statusEmoji = lastRun.status === 'passed' ? '\u2705' : '\u274C';
  const failCount   = lastRun.failedTests?.length ?? 0;

  console.log('');
  console.log(`  ${statusEmoji}  Last test run: ${lastRun.status}`);
  if (failCount > 0) {
    console.log(`     Failed tests: ${failCount}`);
    for (const t of lastRun.failedTests) {
      console.log(`       \u2022 ${t}`);
    }
  }
  console.log('');
} catch {
  console.log('  \u2139\uFE0F  No previous test run found in test-results/.last-run.json');
  console.log('');
}

// --- Check that the report exists ---
if (!fs.existsSync(REPORT_HTML)) {
  console.error('  \u26A0\uFE0F  HTML report not found at: playwright-report/index.html');
  console.error('     Run E2E tests first: pnpm test:e2e');
  process.exit(1);
}

// --- Open in default browser (cross-platform) ---
const platform = process.platform;
const cmd =
  platform === 'darwin'
    ? `open "${REPORT_HTML}"`
    : platform === 'win32'
      ? `start "" "${REPORT_HTML}"`
      : `xdg-open "${REPORT_HTML}"`;

console.log('  \uD83D\uDCF1  Opening playwright-report/index.html in your default browser\u2026');
console.log('');

exec(cmd, (err) => {
  if (err) {
    console.error('  \u26A0\uFE0F  Failed to open report: ' + err.message);
    console.error('     Open it manually: file://' + REPORT_HTML);
    process.exit(1);
  }
  // Success — exit cleanly (not strictly necessary since the event loop
  // has no work left, but explicit is clearer).
  process.exit(0);
});
