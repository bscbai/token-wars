#!/usr/bin/env node
/**
 * S1 smoke test — "存档写穿与优雅关停" acceptance harness.
 *
 * Runs against a throwaway database (DB_PATH env), never the production file.
 *
 *   ① purchase then kill -9  -> item still there after restart
 *   ② SIGINT                 -> .db-wal is 0 B (or gone)
 *   ③ importing modules      -> creates no server/data/*.db
 *   ④ mining collect         -> written through to disk immediately
 *
 * Usage:  node scripts/s1-smoke.js
 */
const { spawn, spawnSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.SMOKE_PORT || '3987';
const BASE = `http://127.0.0.1:${PORT}`;
const JWT_SECRET = 'smoke-only-secret';

// --- child mode: boot the server, then fire the real SIGINT handler ---------
// Windows cannot deliver a POSIX SIGINT to another process (process.kill maps
// SIGINT to an unconditional terminate), so we emit the signal inside the
// server process. This invokes the exact handler registered by server/index.js.
if (process.argv.includes('--child-sigint')) {
  require(path.join(ROOT, 'server', 'index.js'));
  setTimeout(() => process.emit('SIGINT'), Number(process.env.SMOKE_SIGINT_DELAY || 2000));
  return;
}

const results = [];
function check(id, name, pass, detail) {
  results.push({ id, name, pass, detail });
  const tag = pass ? 'PASS' : 'FAIL';
  console.log(`  [${tag}] ${id} ${name}${detail ? ` — ${detail}` : ''}`);
  return pass;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function walSize(dbPath) {
  const p = dbPath + '-wal';
  return fs.existsSync(p) ? fs.statSync(p).size : -1; // -1 = file absent
}
function fmtWal(n) {
  return n < 0 ? 'absent' : `${n} B`;
}

function readRow(dbPath, username) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db.prepare('SELECT data FROM players WHERE username = ?').get(username);
    return row ? JSON.parse(row.data) : null;
  } finally {
    db.close();
  }
}

function startServer(dbPath, { childSigint = false } = {}) {
  const args = childSigint
    ? [path.join(ROOT, 'scripts', 's1-smoke.js'), '--child-sigint']
    : [path.join(ROOT, 'server', 'index.js')];
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DB_PATH: dbPath,
      PORT,
      JWT_SECRET,
      LOG_LEVEL: 'warn',
      SMOKE_SIGINT_DELAY: process.env.SMOKE_SIGINT_DELAY || '2000',
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

async function checkImportSideEffects() {
  console.log('\n③ import side effects');
  const dataDir = path.join(ROOT, 'server', 'data');
  const before = fs.readdirSync(dataDir).sort();
  const phantomDb = path.join(os.tmpdir(), `tw-phantom-${Date.now()}.db`);

  const script = `
    require('./server/data/Store');
    require('./server/routes/auth');
    require('./server/routes/player');
    require('./server/routes/shop');
    require('./server/game/MiningManager');
    require('./server/game/CombatSystem');
    require('./server/game/PvEManager');
    require('./server/game/PvPManager');
    console.log('imported-ok');
  `;
  const out = spawnSync(process.execPath, ['-e', script], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: 'production', DB_PATH: phantomDb, JWT_SECRET, LOG_LEVEL: 'silent' },
    encoding: 'utf-8',
  });

  const after = fs.readdirSync(dataDir).sort();
  const imported = out.stdout.includes('imported-ok');
  const noNewFiles = JSON.stringify(before) === JSON.stringify(after);
  const noPhantom = !fs.existsSync(phantomDb);

  check('③a', 'modules import cleanly', imported, out.stderr.trim().slice(0, 200) || 'no stderr');
  check('③b', 'no new files in server/data/', noNewFiles, `before=${before.length} after=${after.length}`);
  check('③c', 'configured DB_PATH not created on import', noPhantom, path.basename(phantomDb));
  return imported && noNewFiles && noPhantom;
}

async function checkCrashSafetyAndShutdown() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-smoke-'));
  const dbPath = path.join(dir, 'smoke.db');
  const user = `smoke_${Date.now() % 100000}`;
  const pass = 'smoke1234';

  console.log(`\n① purchase -> kill -9 -> restart   (db: ${dbPath})`);
  let srv = startServer(dbPath);
  try {
    await waitForHealth();

    const reg = await api('POST', '/api/auth/register', { body: { username: user, password: pass } });
    if (reg.status !== 200) throw new Error(`register failed: ${reg.status} ${JSON.stringify(reg.body)}`);
    const token = reg.body.sessionToken;
    const creditsAtStart = reg.body.player.credits;

    const daily = await api('POST', '/api/player/claim-daily', { token, body: {} });
    const buy = await api('POST', '/api/shop/buy', { token, body: { packId: 'basic' } });
    if (buy.status !== 200) throw new Error(`buy failed: ${buy.status} ${JSON.stringify(buy.body)}`);

    const expected = {
      credits: buy.body.player.credits,
      unstableTokens: buy.body.player.unstableTokens,
      stableCount: buy.body.player.stableTokens.length,
    };

    // Written through *before* any autosave tick could have run?
    const preKill = readRow(dbPath, user);
    check(
      '①a',
      'purchase is on disk before any crash',
      !!preKill && preKill.purchasedPacks.basic === 1 && preKill.credits === expected.credits,
      `disk: credits=${preKill && preKill.credits}, basic=${preKill && preKill.purchasedPacks.basic}`
    );
    check(
      '①b',
      'daily claim is on disk',
      !!preKill && preKill.lastDailyClaim === new Date().toDateString() && daily.status === 200,
      `lastDailyClaim=${preKill && preKill.lastDailyClaim}`
    );

    // --- hard kill: no handlers run, no flush, WAL left dirty ---
    const walBeforeKill = walSize(dbPath);
    srv.kill('SIGKILL');
    const killed = await waitExit(srv);
    const walAfterKill = walSize(dbPath);
    console.log(`    kill -9 -> exit code=${killed.code} signal=${killed.signal}; WAL ${fmtWal(walBeforeKill)} -> ${fmtWal(walAfterKill)}`);

    // --- restart and confirm the data survived ---
    srv = startServer(dbPath);
    await waitForHealth();
    const login = await api('POST', '/api/auth/login', { body: { username: user, password: pass } });
    if (login.status !== 200) throw new Error(`login after restart failed: ${login.status}`);
    const profile = await api('GET', '/api/player/profile', { token: login.body.sessionToken });
    const p = profile.body.player;

    check(
      '①c',
      'item still owned after kill -9 + restart',
      p.stableTokens.length === expected.stableCount && p.unstableTokens === expected.unstableTokens,
      `stable=${p.stableTokens.length}/${expected.stableCount}, unstable=${p.unstableTokens}/${expected.unstableTokens}`
    );
    check(
      '①d',
      'credits survived (daily claim + purchase)',
      p.credits === expected.credits,
      `${p.credits} === ${expected.credits} (start ${creditsAtStart})`
    );

    srv.kill('SIGKILL');
    await waitExit(srv);
    srv = null;

    // --- ② graceful shutdown checkpoints the WAL ---
    console.log('\n② SIGINT -> WAL checkpoint');
    const walBeforeSigint = walSize(dbPath);
    const gsrv = startServer(dbPath, { childSigint: true });
    await waitForHealth();
    const walWhileRunning = walSize(dbPath);
    const exit = await waitExit(gsrv);
    const walAfterSigint = walSize(dbPath);

    console.log(`    WAL: after crash=${fmtWal(walBeforeSigint)}, running=${fmtWal(walWhileRunning)}, after SIGINT=${fmtWal(walAfterSigint)}`);
    check('②a', 'process exited 0 on SIGINT', exit.code === 0, `code=${exit.code} signal=${exit.signal}`);
    check('②b', '.db-wal is 0 B or absent after SIGINT', walAfterSigint <= 0, fmtWal(walAfterSigint));

    // data must still be intact + integrity ok after the clean close
    const finalRow = readRow(dbPath, user);
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
    const count = db.prepare('SELECT COUNT(*) c FROM players').get().c;
    db.close();
    check('②c', 'db intact after clean close', integrity === 'ok' && !!finalRow && count >= 1, `integrity=${integrity}, rows=${count}`);

    return dbPath;
  } finally {
    if (srv && srv.exitCode === null) { srv.kill('SIGKILL'); await waitExit(srv); }
  }
}

async function checkMiningWriteThrough() {
  console.log('\n④ mining collect write-through');
  // socket.io-client is not a project dependency, so the websocket handler is
  // exercised at manager level against a real on-disk Store + a fake socket.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-mine-'));
  const dbPath = path.join(dir, 'mine.db');
  const { Store } = require(path.join(ROOT, 'server', 'data', 'Store'));
  const Player = require(path.join(ROOT, 'server', 'models', 'Player'));
  const MiningManager = require(path.join(ROOT, 'server', 'game', 'MiningManager'));

  const store = new Store(dbPath, { migrate: false });
  const player = new Player('miner');
  store.addPlayer(player);

  const emitted = [];
  const fakeSocket = { emit: (ev, data) => emitted.push({ ev, data }), on: () => {} };
  const mining = new MiningManager({ emit: () => {} }, store);
  mining.playerSockets.set(player.id, fakeSocket);

  player.pendingMiningTokens = 7;
  const before = player.unstableTokens;
  mining.collect(player.id);

  const onDisk = readRow(dbPath, 'miner');
  const ok = onDisk && onDisk.unstableTokens === before + 7 && onDisk.pendingMiningTokens === 0;
  check('④a', 'mining collect written through before autosave', !!ok,
    `disk unstable=${onDisk && onDisk.unstableTokens} (expected ${before + 7}), pending=${onDisk && onDisk.pendingMiningTokens}`);
  check('④b', 'collect clears the dirty flag (write-through, not queued)', !store.dirty.has(player.id));

  // tick accrual should mark dirty rather than write
  player.lastMiningCollect = Date.now() - 60 * 60 * 1000;
  mining.tick(Date.now());
  check('④c', 'passive accrual marks dirty instead of writing', store.dirty.has(player.id),
    `pending=${player.pendingMiningTokens}`);

  store.close();
  const walAfter = walSize(dbPath);
  check('④d', 'store.close() truncates this db WAL too', walAfter <= 0, fmtWal(walAfter));
  fs.rmSync(dir, { recursive: true, force: true });
}

(async () => {
  console.log('='.repeat(70));
  console.log('S1 SMOKE TEST — 存档写穿与优雅关停');
  console.log('='.repeat(70));

  await checkImportSideEffects();
  await checkCrashSafetyAndShutdown();
  await checkMiningWriteThrough();

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
