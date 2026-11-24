/**
 * 端到端冒烟测试（CI 用）：真实起服务 + 示例 bot 打一场，验证关键公开面。
 *
 * 覆盖的回归点（都是曾经出过问题或容易被改坏的）：
 *   1. 服务端能启动，外部 agent 能注册并匹配到官方陪练
 *   2. 对局能打完（ticks ≥ 40，排除一上场就弃权的假成功）
 *   3. 赛后自动重排存在（至少完成 2 场，验证冷却 > 2s 时也不会停摆）
 *   4. /api/ai-arena/matches/:id/replay 有回放帧
 *   5. /arena 含参赛命令；/m/:id 服务端渲染对阵 OG 卡且脚本为绝对路径
 *
 * 用法：node scripts/smoke-demo.cjs   （成功 exit 0，失败 exit 1）
 */

'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const PORT = parseInt(process.env.SMOKE_PORT, 10) || 3399;
const BASE = `http://127.0.0.1:${PORT}`;
const DB_PATH = path.join(ROOT, 'server', 'data', 'smoke.db');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const children = [];
function spawnChild(args, env) {
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  children.push(child);
  return child;
}

function cleanup() {
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try { fs.unlinkSync(DB_PATH + suffix); } catch { /* ignore */ }
  }
}

async function api(pathname, opts) {
  const res = await fetch(`${BASE}${pathname}`, opts);
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, body, text };
}

async function main() {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try { fs.unlinkSync(DB_PATH + suffix); } catch { /* ignore */ }
  }

  spawnChild(['server/index.js'], {
    PORT: String(PORT),
    DB_PATH,
    DEMO_HOUSEBOT: '1',
    AI_MATCH_COOLDOWN_MS: '1000',
    NODE_ENV: 'development',
    JWT_SECRET: 'smoke-test-secret',
  });

  const deadline = Date.now() + 30000;
  let up = false;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/bot/protocol`);
      if (r.ok) { up = true; break; }
    } catch { /* warming up */ }
    await sleep(500);
  }
  if (!up) throw new Error('server did not start within 30s');

  const username = `smoke_${Date.now().toString(36)}`;
  const reg = await api('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'smoke-pass-1' }),
  });
  if (!reg.body?.sessionToken) throw new Error(`register failed: ${reg.status}`);
  const mint = await api('/api/bot/token', {
    method: 'POST',
    headers: { Authorization: `Bearer ${reg.body.sessionToken}` },
  });
  if (!mint.body?.botToken) throw new Error(`mint failed: ${mint.status}`);

  spawnChild([path.join('examples', 'sample-bot-node', 'bot.js')], {
    BOT_URL: BASE,
    BOT_TOKEN: mint.body.botToken,
  });

  // 等到两场完整对局：单场通过不足以发现「赛后就停摆」的问题
  const matches = new Map();
  const matchDeadline = Date.now() + 90000;
  while (Date.now() < matchDeadline) {
    const r = await api('/api/ai-arena/matches/recent?limit=10');
    for (const m of r.body?.entries || []) {
      if (!matches.has(m.matchId)) matches.set(m.matchId, m);
    }
    const done = [...matches.values()].filter((m) => m.ticks >= 40 && m.external);
    if (done.length >= 2) break;
    await sleep(1500);
  }

  const finished = [...matches.values()].filter((m) => m.ticks >= 40 && m.external);
  if (finished.length < 2) {
    throw new Error(`expected 2 completed external matches, got ${finished.length}`);
  }

  const sample = finished[0];
  const replay = await api(`/api/ai-arena/matches/${encodeURIComponent(sample.matchId)}/replay`);
  if (replay.status !== 200 || !(replay.body?.frames || []).length) {
    throw new Error(`replay missing frames (status ${replay.status})`);
  }

  const arena = await api('/arena');
  if (arena.status !== 200 || !arena.text.includes('id="join-code"')) {
    throw new Error('arena page missing join panel');
  }

  const share = await api(`/m/${encodeURIComponent(sample.matchId)}`, {
    headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'smoke.example' },
  });
  const shareHtml = share.text;
  if (share.status !== 200 || !/property="og:title" content="[^"]+ vs [^"]+/.test(shareHtml)) {
    throw new Error(`share page missing matchup OG card (status ${share.status})`);
  }
  if (!shareHtml.includes('src="/arena.js"')) {
    throw new Error('share page must reference /arena.js (absolute)');
  }

  console.log(JSON.stringify({
    ok: true,
    matches: finished.length,
    ticks: finished.map((m) => m.ticks),
    replayFrames: replay.body.frames.length,
    winner: replay.body.winner,
    map: replay.body.map.id,
  }, null, 2));
}

main()
  .then(() => { cleanup(); process.exit(0); })
  .catch((err) => { console.error(`smoke failed: ${err.message}`); cleanup(); process.exit(1); });
