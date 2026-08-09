#!/usr/bin/env node
/**
 * merge-playwright-reports.js
 *
 * Merges multiple Playwright JSON report files (one per browser) into a single
 * consolidated report for PR comment generation.
 *
 * Playwright JSON reporter outputs:
 *   {
 *     config: {...},
 *     suites: [...],
 *     errors: [...],
 *     stats: { expected, unexpected, flaky, skipped, durationMs }
 *   }
 *
 * Usage:
 *   node scripts/merge-playwright-reports.js \
 *     --input=path/to/chromium/test-results.json,path/to/firefox/test-results.json \
 *     --output=merged/test-results.json
 */

const fs = require('fs');
const path = require('path');

// --- Parse CLI args ---
const inputFlag = process.argv.find(a => a.startsWith('--input='));
const outputFlag = process.argv.find(a => a.startsWith('--output='));

if (!inputFlag || !outputFlag) {
  console.error('Usage: node scripts/merge-playwright-reports.js --input=f1.json,f2.json --output=out.json');
  process.exit(1);
}

const inputPaths = inputFlag.split('=')[1].split(',').map(s => s.trim());
const outputPath = outputFlag.split('=')[1];

// --- Load and merge reports ---
const merged = {
  stats: {
    expected: 0,
    unexpected: 0,
    flaky: 0,
    skipped: 0,
    total: 0,
    passed: 0,
    failed: 0,
    durationMs: 0,
  },
  errors: [],
  suites: [],
};

for (const filePath of inputPaths) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    console.warn('  Skipping (not found): ' + filePath);
    continue;
  }

  const raw = fs.readFileSync(resolved, 'utf-8');
  let report;
  try {
    report = JSON.parse(raw);
  } catch {
    console.warn('  Skipping (invalid JSON): ' + filePath);
    continue;
  }

  if (!report || !report.stats) {
    console.warn('  Skipping (no stats): ' + filePath);
    continue;
  }

  // Accumulate stats from Playwright's native fields
  const s = report.stats;
  merged.stats.expected    += s.expected  || 0;
  merged.stats.unexpected  += s.unexpected || 0;
  merged.stats.flaky       += s.flaky     || 0;
  merged.stats.skipped     += s.skipped   || 0;
  merged.stats.durationMs  += s.durationMs || 0;

  // Collect errors (Playwright JSON reporter uses 'errors', not 'failures')
  if (Array.isArray(report.errors)) {
    merged.errors.push(...report.errors);
  }

  // Collect suites
  if (Array.isArray(report.suites)) {
    merged.suites.push(...report.suites);
  }

  console.log('  Loaded: ' + filePath +
    ' (' + (s.expected || 0) + ' expected, ' +
    (s.unexpected || 0) + ' unexpected)');
}

// --- Compute derived stats ---
merged.stats.total  = merged.stats.expected + merged.stats.unexpected + merged.stats.flaky + merged.stats.skipped;
merged.stats.passed = merged.stats.expected;
merged.stats.failed = merged.stats.unexpected;

// --- Write merged output ---
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(merged, null, 2), 'utf-8');

console.log('');
console.log('  Merged report written to: ' + outputPath);
console.log('  Total: ' + merged.stats.total +
  ' | Passed: ' + merged.stats.passed +
  ' | Failed: ' + merged.stats.failed +
  ' | Flaky: ' + merged.stats.flaky +
  ' | Skipped: ' + merged.stats.skipped);
