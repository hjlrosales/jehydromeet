#!/usr/bin/env node
/**
 * validate-env.js
 *
 * Loads environment variables (from .env files and/or process.env)
 * and validates they meet the requirements for the current mode.
 *
 * Usage:
 *   node scripts/validate-env.js                        # validate all
 *   node scripts/validate-env.js --mode e2e             # E2E tests only
 *   node scripts/validate-env.js --mode production      # production only
 *
 * Modes:
 *   base       -- vars needed for any backend startup
 *   sfu        -- LiveKit SFU vars (on top of base)
 *   turn       -- TURN server vars (on top of base)
 *   recording  -- recording vars (on top of sfu)
 *   frontend   -- frontend build/run vars
 *   e2e        -- E2E test vars
 *   production -- base + turn + sfu + recording + frontend
 *   all        -- everything (default)
 *
 * Exit codes:
 *   0 - all required vars present (warnings are OK)
 *   1 - one or more required vars missing
 */

const path = require('path');
const fs   = require('fs');

// -----------------------------------------------------------
// Try to load dotenv; fall back to manual .env parsing
// -----------------------------------------------------------
try {
  require('dotenv').config();
} catch {
  // dotenv not available - fall back to manual .env loading
  const envPath = path.resolve('.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      // Strip surrounding quotes
      if ((val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

// -----------------------------------------------------------
// Environment variable definitions
// -----------------------------------------------------------
// Each entry: { key, required, mode, default, description }
//   required: true  -> missing value is a hard error
//   required: false -> missing value is a warning (uses default)
//   mode: which validation mode includes this var
//   secret: if true, don't print the value in messages

const ENV_VARS = [
  // ---- Base (always needed) ----
  { key: 'PORT',               required: false, mode: 'base',    default: '4000',                 description: 'Backend HTTP server port' },
  { key: 'CORS_ORIGIN',        required: false, mode: 'base',    default: 'http://localhost:3000', description: 'Allowed CORS origin for frontend' },
  { key: 'ROOM_EMPTY_TTL_MIN', required: false, mode: 'base',    default: '10',                    description: 'Minutes before empty room is destroyed' },
  { key: 'MAX_ROOMS_PER_IP_PER_HOUR', required: false, mode: 'base', default: '20',                description: 'Max rooms created per IP per hour' },
  { key: 'REDIS_URL',          required: false, mode: 'base',    default: '',                      description: 'Redis URL for Socket.IO adapter (multi-instance backend)' },

  // ---- TURN ----
  { key: 'TURN_SECRET',        required: true,  mode: 'turn',    default: '',        secret: true,  description: 'Shared secret for Coturn HMAC auth' },
  { key: 'TURN_URLS',          required: false, mode: 'turn',    default: 'turn:turn.jehydro.com:3478,turns:turn.jehydro.com:5349', description: 'Comma-separated TURN server URLs (TCP + TLS)' },

  // ---- SFU (LiveKit) ----
  { key: 'LIVEKIT_API_KEY',    required: true,  mode: 'sfu',     default: '',        secret: true,  description: 'LiveKit API key' },
  { key: 'LIVEKIT_API_SECRET', required: true,  mode: 'sfu',     default: '',        secret: true,  description: 'LiveKit API secret' },
  { key: 'LIVEKIT_URL',        required: true,  mode: 'sfu',     default: '',                      description: 'LiveKit server WebSocket URL (e.g. ws://livekit:7880)' },

  // ---- Recording (depends on SFU) ----
  { key: 'RECORDING_STORAGE_PATH',   required: false, mode: 'recording', default: './recordings',  description: 'Directory for recording output files' },
  { key: 'RECORDING_RETENTION_DAYS', required: false, mode: 'recording', default: '7',              description: 'Days to keep recordings before auto-delete' },
  { key: 'RECORDING_MAX_STORAGE_GB', required: false, mode: 'recording', default: '10',             description: 'Max storage for recordings in GB' },

  // ---- Frontend ----
  { key: 'NEXT_PUBLIC_BACKEND_URL', required: false, mode: 'frontend', default: 'http://localhost:4000', description: 'Backend URL used by the frontend' },
  { key: 'NEXT_PUBLIC_ICE_SERVERS', required: false, mode: 'frontend', default: '',                       description: 'JSON array of ICE server configs (falls back to Google STUN)' },

  // ---- E2E Tests ----
  { key: 'FRONTEND_URL', required: false, mode: 'e2e', default: 'http://localhost:3000', description: 'Frontend URL for E2E tests' },
  { key: 'BACKEND_URL',  required: false, mode: 'e2e', default: 'http://localhost:4000', description: 'Backend URL for E2E tests' },
];

// -----------------------------------------------------------
// Validation
// -----------------------------------------------------------

function validate(modeFilter) {
  const vars = modeFilter === 'all'
    ? ENV_VARS
    : ENV_VARS.filter(v => v.mode === modeFilter);

  const missing = [];
  const warnings = [];

  for (const v of vars) {
    const raw = process.env[v.key] || '';
    const value = raw.trim();
    const isSet = value.length > 0 && value !== v.default;

    if (v.required && !isSet) {
      missing.push(v);
    } else if (v.required && isSet) {
      // All good
    } else if (!isSet) {
      warnings.push(v);
    }
  }

  return { missing, warnings };
}

// -----------------------------------------------------------
// Display helpers
// -----------------------------------------------------------

function printCheckmark(ok) {
  return ok ? '\u2705' : '\u274C';
}

function printValue(key, val, secret) {
  if (secret && val) return key + '=***';
  return key + '=' + (val || '(not set)');
}

// -----------------------------------------------------------
// Main
// -----------------------------------------------------------

const args = process.argv.slice(2);

// Accept both --mode=base and --mode base formats
let mode = 'all';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--mode' && i + 1 < args.length) {
    mode = args[i + 1];
  } else if (args[i].startsWith('--mode=')) {
    mode = args[i].split('=')[1];
  }
}

const validModes = ['base', 'sfu', 'turn', 'recording', 'frontend', 'e2e', 'production', 'all'];

if (!validModes.includes(mode)) {
  console.error('');
  console.error('  Unknown mode: ' + mode);
  console.error('  Valid modes: ' + validModes.join(', '));
  console.error('');
  process.exit(1);
}

let exitCode = 0;
console.log('');
console.log('  \uD83D\uDD0D  Environment Variable Validation');
console.log('  Mode: ' + mode);
console.log('');

// Determine which sub-modes to validate
const modesToCheck = mode === 'all'
  ? ['base', 'turn', 'sfu', 'recording', 'frontend', 'e2e']
  : mode === 'production'
    ? ['base', 'turn', 'sfu', 'recording', 'frontend']
    : [mode];

for (const m of modesToCheck) {
  const result = validate(m);

  // Section header
  const modeLabel = m.charAt(0).toUpperCase() + m.slice(1);
  console.log('  ' + '\u2500'.repeat(50));
  console.log('  ' + modeLabel + ' settings');
  console.log('');

  // List all vars in this sub-mode
  const varsInMode = ENV_VARS.filter(v => v.mode === m);

  for (const v of varsInMode) {
    const raw = process.env[v.key] || '';
    const value = raw.trim();
    const isSet = value.length > 0;
    const check = v.required ? (isSet && value !== v.default) : true;

    console.log(
      '    ' + printCheckmark(check) + '  ' +
      (v.required ? '[REQUIRED] ' : '[optional] ') +
      printValue(v.key, isSet ? value : v.default, v.secret)
    );
  }

  // Print errors (missing required vars)
  if (result.missing.length > 0) {
    console.log('');
    for (const v of result.missing) {
      console.log('    \u274C  MISSING REQUIRED: ' + v.key);
      console.log('         ' + v.description);
      console.log('         Set it in .env or export it in your shell');
    }
    exitCode = 1;
  }

  // Print warnings (using defaults). Always shown regardless of mode.
  if (result.warnings.length > 0) {
    console.log('');
    for (const v of result.warnings) {
      console.log('    \u26A0\uFE0F  Using default: ' + v.key + '=' + v.default);
      console.log('         ' + v.description);
    }
  }

  console.log('');
}

console.log('  ' + '\u2500'.repeat(50));
if (exitCode === 0) {
  console.log('  \u2705  All required environment variables are set.');
} else {
  console.log('  \u274C  One or more required environment variables are missing.');
  console.log('     See errors above. Create a .env file or export the vars.');
}
console.log('');

process.exit(exitCode);
