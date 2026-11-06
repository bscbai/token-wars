#!/usr/bin/env node
/**
 * S3 smoke test — "事件校验与全量限流" acceptance harness.
 *
 * Runs against a throwaway database (DB_PATH env), never the production file.
 *
 *   ① grep 确认 server/ 中无裸 socket.on（排除 AUTH_LOGIN / PING / disconnect）
 *   ② ai_arena:name_agent 传 10000 字符 → 被拒（返回 EVENTS.ERROR）
 *   ③ 狂刷 mining:collect 100 次验证限流（前 2 次处理，其余丢弃 + 计数）
 *   ④ 正常事件通过（mining:upgrade 无 token → ERROR but not RATE_LIMITED）
 *
 * Usage:  node scripts/s3-smoke.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { io: client } = require('socket.io-client');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.SMOKE_PORT || '3989';
const BASE = `http://127.0.0.1:${PORT}`;
const JWT_SECRET = 's3-smoke-only-secret';

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
// ① grep 检查：server/game/ 和 server/index.js 中无裸 socket.on
// （排除 AUTH_LOGIN / PING / disconnect / eventGuard 内部实现）
// ---------------------------------------------------------------------------

function checkNoBareSocketOn() {
  console.log('\n① grep 确认无裸 socket.on（排除 AUTH_LOGIN / PING / disconnect）');

  // Check server/game/ — should have ZERO bare socket.on
  const gameResult = require('child_process').spawnSync(
    process.platform === 'win32' ? 'findstr' : 'grep',
    process.platform === 'win32'
      ? ['/S', '/N', 'socket.on(', path.join(ROOT, 'server', 'game')]
      : ['-rn', '--include=*.js', 'socket.on(', path.join(ROOT, 'server', 'game')],
    { encoding: 'utf-8' }
  );

  const gameLines = (gameResult.stdout || '')
    .split('\n')
    .filter((l) => l.trim() && !l.includes('guard.on'));

  check('①a', 'server/game/ 无裸 socket.on',
    gameLines.length === 0,
    gameLines.length === 0 ? 'clean' : `found ${gameLines.length} bare socket.on:\n      ${gameLines.slice(0, 5).join('\n      ')}`
  );

  // Check server/index.js — should only have AUTH_LOGIN, PING, disconnect
  const indexContent = fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf-8');
  const indexLines = indexContent
    .split('\n')
    .map((line, i) => ({ num: i + 1, line }))
    .filter(({ line }) => line.includes('socket.on(') && !line.includes('guard.on'));

  const allowedPatterns = ['AUTH_LOGIN', 'PING', 'disconnect', 'auth:login', "'ping'"];
  const bareLines = indexLines.filter(({ line }) =>
    !allowedPatterns.some((p) => line.includes(p))
  );

  check('①b', 'server/index.js 裸 socket.on 仅为 AUTH_LOGIN / PING / disconnect',
    bareLines.length === 0,
    bareLines.length === 0
      ? `all ${indexLines.length} socket.on calls are allowed exceptions`
      : `unexpected bare socket.on at lines: ${bareLines.map((l) => l.num).join(', ')}`
  );
}

// ---------------------------------------------------------------------------

async function runSmoke() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-s3-smoke-'));
  const dbPath = path.join(dir, 's3-smoke.db');
  const user = `s3_${Date.now() % 100000}`;
  const pass = 'smoke1234';

  console.log(`\n  (db: ${dbPath})`);

  // ① grep check (doesn't need server running)
  checkNoBareSocketOn();

  let srv = startServer(dbPath);
  try {
    await waitForHealth();

    // Register player via REST
    const reg = await api('POST', '/api/auth/register', { body: { username: user, password: pass } });
    if (reg.status !== 200) throw new Error(`register failed: ${reg.status} ${JSON.stringify(reg.body)}`);
    const token = reg.body.sessionToken;

    // Connect with valid token
    const sock = client(BASE, { auth: { token }, forceNew: true, reconnection: false });

    // Wait for auth
    const authed = await new Promise((resolve) => {
      sock.on('auth:success', () => resolve(true));
      sock.on('connect_error', () => resolve(false));
      setTimeout(() => resolve(false), 5000);
    });

    if (!authed) {
      check('②③④', 'socket connection', false, 'auth:success not received');
      sock.close();
      return;
    }

    // Give a moment for managers to register
    await sleep(300);

    // ② ai_arena:name_agent 传 10000 字符 → 被拒
    console.log('\n② ai_arena:name_agent 传 10000 字符被拒');
    {
      const longName = 'x'.repeat(10000);
      const errorEvents = [];
      const errorHandler = (data) => errorEvents.push(data);
      sock.on('error', errorHandler);

      sock.emit('ai_arena:name_agent', { agentId: 'fake-id', name: longName });
      await sleep(500);

      sock.off('error', errorHandler);

      const validationError = errorEvents.find(
        (e) => e.code === 'VALIDATION_ERROR' && e.event === 'ai_arena:name_agent'
      );

      check('②', '10000 字符 name 被拒（VALIDATION_ERROR）',
        !!validationError,
        validationError
          ? `errors: ${JSON.stringify(validationError.errors)}`
          : `received ${errorEvents.length} error(s), none with VALIDATION_ERROR`
      );
    }

    // ③ 狂刷 mining:collect 100 次验证限流
    console.log('\n③ 狂刷 mining:collect 100 次验证限流');
    {
      // Wait for rate limit window to reset (in case ② used economy bucket)
      await sleep(1100);

      const collectedEvents = [];
      const errorEvents = [];
      const collectedHandler = (data) => collectedEvents.push(data);
      const errorHandler = (data) => errorEvents.push(data);
      sock.on('mining:collected', collectedHandler);
      sock.on('error', errorHandler);

      // Fire 100 mining:collect events as fast as possible
      for (let i = 0; i < 100; i++) {
        sock.emit('mining:collect');
      }

      // Wait for server to process
      await sleep(1000);

      sock.off('mining:collected', collectedHandler);
      sock.off('error', errorHandler);

      // Economy limit is 2/s. The first 2 should be processed (either
      // collected or error if no pending tokens), the remaining 98 should
      // be rate-limited.
      const rateLimited = errorEvents.filter((e) => e.code === 'RATE_LIMITED');
      const totalProcessed = collectedEvents.length + errorEvents.filter(
        (e) => e.code !== 'RATE_LIMITED'
      ).length;

      check('③a', '超频事件被丢弃（≥95 个 RATE_LIMITED）',
        rateLimited.length >= 95,
        `rate-limited: ${rateLimited.length}, processed: ${totalProcessed}`
      );

      check('③b', '前 2 次被处理（collected 或 MINING_EMPTY error）',
        totalProcessed <= 3, // allow small margin for timing
        `processed: ${totalProcessed} (collected: ${collectedEvents.length})`
      );

      check('③c', '限流丢弃有计数（RATE_LIMITED events > 0）',
        rateLimited.length > 0,
        `count: ${rateLimited.length}`
      );
    }

    // ④ 正常事件通过：mining:upgrade（无 token → ERROR but not RATE_LIMITED）
    console.log('\n④ 正常事件通过（非限流错误可到达 handler）');
    {
      // Wait for rate limit window to reset
      await sleep(1100);

      const errorEvents = [];
      const errorHandler = (data) => errorEvents.push(data);
      sock.on('error', errorHandler);

      sock.emit('mining:upgrade');
      await sleep(500);

      sock.off('error', errorHandler);

      // Player has 0 stable tokens → INSUFFICIENT_TOKENS error (not RATE_LIMITED)
      const nonRateError = errorEvents.find(
        (e) => e.code !== 'RATE_LIMITED' && e.code !== 'VALIDATION_ERROR'
      );

      check('④', '正常事件到达 handler（非限流/非校验错误）',
        !!nonRateError,
        nonRateError
          ? `code: ${nonRateError.code}, message: ${nonRateError.message}`
          : `received ${errorEvents.length} error(s), all rate-limited`
      );
    }

    sock.close();
  } finally {
    if (srv && srv.exitCode === null) { srv.kill('SIGKILL'); await waitExit(srv); }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------

(async () => {
  console.log('='.repeat(70));
  console.log('S3 SMOKE TEST — 事件校验与全量限流');
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
