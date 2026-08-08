#!/usr/bin/env node
/**
 * S2 smoke test — "Socket.IO 握手认证与会话唯一性" acceptance harness.
 *
 * Runs against a throwaway database (DB_PATH env), never the production file.
 *
 *   ① no-token connection        → rejected (connect_error)
 *   ② wrong-token connection     → rejected (connect_error)
 *   ③ valid-token connection     → accepted (auth:success)
 *   ④ 3× AUTH_LOGIN + upgrade    → mining:upgrade fires only once
 *   ⑤ same-account 2nd login     → old socket gets session:replaced + disconnect
 *
 * Usage:  node scripts/s2-smoke.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { io: client } = require('socket.io-client');
const { RARITY } = require('../shared/constants');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.SMOKE_PORT || '3988';
const BASE = `http://127.0.0.1:${PORT}`;
const JWT_SECRET = 's2-smoke-only-secret';

const results = [];
function check(id, name, pass, detail) {
  results.push({ id, name, pass, detail });
  const tag = pass ? 'PASS' : 'FAIL';
  console.log(`  [${tag}] ${id} ${name}${detail ? ` — ${detail}` : ''}`);
  return pass;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer(dbPath) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DB_PATH: dbPath,
      PORT,
      JWT_SECRET,
      LOG_LEVEL: 'warn',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => process.env.SMOKE_VERBOSE && process.stdout.write(`    [srv] ${d}`));
  child.stderr.on('data', (d) => process.env.SMOKE_VERBOSE && process.stderr.write(`    [srv!] ${d}`));
  return child;
}

async function waitForHealth(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return await res.json();
    } catch (_) { /* not up yet */ }
    await sleep(200);
  }
  throw new Error('server did not become healthy in time');
}

async function api(method, url, { token, body } = {}) {
  const res = await fetch(BASE + url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { json = { raw: text }; }
  return { status: res.status, body: json };
}

function waitExit(child) {
  return new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
}

// ---------------------------------------------------------------------------

async function runSmoke() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-s2-smoke-'));
  const dbPath = path.join(dir, 's2-smoke.db');
  const user = `s2_${Date.now() % 100000}`;
  const pass = 'smoke1234';

  console.log(`\n  (db: ${dbPath})`);

  let srv = startServer(dbPath);
  try {
    await waitForHealth();

    // --- Register player via REST ---
    const reg = await api('POST', '/api/auth/register', { body: { username: user, password: pass } });
    if (reg.status !== 200) throw new Error(`register failed: ${reg.status} ${JSON.stringify(reg.body)}`);
    const token = reg.body.sessionToken;
    const playerId = reg.body.player.id;

    // Give the player enough stable tokens for 3 upgrades
    // (level 2: 20 uncommon, level 3: 50 rare, level 4: 100 epic)
    const patchRes = await api('POST', '/api/shop/buy', {
      token,
      body: { packId: '__smoke_patch__' },
    }).catch(() => null);

    // Directly modify the player via the Store (smoke-only API)
    // Since there's no REST endpoint to add tokens, we'll use a different
    // approach: connect, emit mining:upgrade, and count events. The player
    // starts at level 1 with 0 stable tokens, so the upgrade will fail
    // (INSUFFICIENT_TOKENS). The key metric is: how many error events fire
    // for a single mining:upgrade emit? Without the fix, 4 listeners → 4
    // error events. With the fix, 1 listener → 1 error event.
    //
    // Actually, let's give the player tokens via a second REST call.
    // The shop 'legendary' pack gives 1 epic token (50 unstable + 1 epic stable).
    // We need uncommon tokens. Let's buy 'basic' packs (1 uncommon each).
    // But we need 20 uncommon for one upgrade. That's 20 basic packs at 100 credits each = 2000 credits.
    // The player starts with 200 credits. Not enough.
    //
    // Simpler approach: just count the error events. If 4 listeners fire,
    // we get 4 'error' events with code INSUFFICIENT_TOKENS. If 1 listener,
    // we get 1.

    // ① no-token connection → rejected
    console.log('\n① no-token connection rejected');
    {
      const sock = client(BASE, { auth: {}, forceNew: true, reconnection: false });
      const error = await new Promise((resolve) => {
        sock.on('connect_error', (err) => resolve(err));
        sock.on('connect', () => resolve(null));
        setTimeout(() => resolve({ message: 'timeout' }), 5000);
      });
      sock.close();
      check('①', 'no-token connection rejected', !!error && /auth|invalid|session/i.test(error.message),
        error ? error.message : 'connected (unexpected)');
    }

    // ② wrong-token connection → rejected
    console.log('\n② wrong-token connection rejected');
    {
      const sock = client(BASE, {
        auth: { token: 'garbage.token.here' },
        forceNew: true,
        reconnection: false,
      });
      const error = await new Promise((resolve) => {
        sock.on('connect_error', (err) => resolve(err));
        sock.on('connect', () => resolve(null));
        setTimeout(() => resolve({ message: 'timeout' }), 5000);
      });
      sock.close();
      check('②', 'wrong-token connection rejected', !!error && /auth|invalid|session/i.test(error.message),
        error ? error.message : 'connected (unexpected)');
    }

    // ③ valid-token connection → accepted + auth:success
    console.log('\n③ valid-token connection accepted');
    {
      const sock = client(BASE, { auth: { token }, forceNew: true, reconnection: false });
      const result = await new Promise((resolve) => {
        sock.on('auth:success', (data) => resolve(data));
        sock.on('connect_error', (err) => resolve({ error: err.message }));
        setTimeout(() => resolve({ error: 'timeout' }), 5000);
      });
      sock.close();
      check('③', 'valid-token connection accepted + AUTH_SUCCESS',
        !result.error && result.playerId === playerId,
        result.error || `playerId=${result.playerId}`);
    }

    // ④ 3× AUTH_LOGIN + mining:upgrade → only 1 effect
    console.log('\n④ duplicate AUTH_LOGIN idempotency (mining:upgrade fires once)');
    {
      const sock = client(BASE, { auth: { token }, forceNew: true, reconnection: false });

      // Wait for handshake auth
      const authed = await new Promise((resolve) => {
        sock.on('auth:success', () => resolve(true));
        sock.on('connect_error', () => resolve(false));
        setTimeout(() => resolve(false), 5000);
      });
      if (!authed) {
        check('④', 'handshake auth succeeded', false, 'auth:success not received');
        sock.close();
      } else {
        // Send AUTH_LOGIN 3 more times (simulating old client code)
        sock.emit('auth:login', { token });
        sock.emit('auth:login', { token });
        sock.emit('auth:login', { token });
        await sleep(200);

        // Count error events for a single mining:upgrade
        // Player has 0 stable tokens, so upgrade → INSUFFICIENT_TOKENS error.
        // Without fix: 4 listeners (1 handshake + 3 AUTH_LOGIN) → 4 errors
        // With fix: 1 listener → 1 error
        const errors = [];
        sock.on('error', (data) => errors.push(data));

        sock.emit('mining:upgrade');
        await sleep(500);

        sock.close();
        check('④', 'mining:upgrade fires only once (no duplicate listeners)',
          errors.length === 1,
          `received ${errors.length} error event(s) for 1 mining:upgrade (expected 1)`);
      }
    }

    // ⑤ same-account 2nd login → old socket gets session:replaced
    console.log('\n⑤ same-account session replacement');
    {
      const sock1 = client(BASE, { auth: { token }, forceNew: true, reconnection: false });

      // Wait for first connection auth
      const authed1 = await new Promise((resolve) => {
        sock1.on('auth:success', () => resolve(true));
        sock1.on('connect_error', () => resolve(false));
        setTimeout(() => resolve(false), 5000);
      });
      if (!authed1) {
        check('⑤', 'first connection auth succeeded', false, 'auth:success not received');
        sock1.close();
      } else {
        // Listen for session:replaced and disconnect on sock1
        let replaced = null;
        let disconnected = false;
        sock1.on('session:replaced', (data) => { replaced = data; });
        sock1.on('disconnect', () => { disconnected = true; });

        // Second connection with the same token
        const sock2 = client(BASE, { auth: { token }, forceNew: true, reconnection: false });
        const authed2 = await new Promise((resolve) => {
          sock2.on('auth:success', () => resolve(true));
          sock2.on('connect_error', () => resolve(false));
          setTimeout(() => resolve(false), 5000);
        });

        // Wait for session:replaced on sock1
        await sleep(1500);

        sock1.close();
        sock2.close();

        check('⑤a', 'second connection authenticated', authed2, authed2 ? 'ok' : 'failed');
        check('⑤b', 'old socket received session:replaced',
          !!replaced, replaced ? JSON.stringify(replaced) : 'no event received');
        check('⑤c', 'old socket disconnected after replacement',
          disconnected, disconnected ? 'ok' : 'still connected');
      }
    }

    return dbPath;
  } finally {
    if (srv && srv.exitCode === null) { srv.kill('SIGKILL'); await waitExit(srv); }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------

(async () => {
  console.log('='.repeat(70));
  console.log('S2 SMOKE TEST — Socket.IO 握手认证与会话唯一性');
  console.log('='.repeat(70));

  await runSmoke();

  const failed = results.filter((r) => !r.pass);
  console.log('\n' + '='.repeat(70));
  console.log(`RESULT: ${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('FAILED: ' + failed.map((f) => f.id).join(', '));
  }
  console.log('='.repeat(70));
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error('\nSMOKE TEST ERROR:', err);
  process.exit(2);
});
