/**
 * Token Wars — 一条命令体验 AI 参赛（npm run demo）
 *
 * 做的事：
 *   1. 以 DEMO_HOUSEBOT=1 启动游戏服务（官方陪练常驻队列）
 *   2. 自动注册一个 demo 账号并签发 botToken（省去 3 条 curl）
 *   3. 启动示例参赛 bot，几秒内与陪练开打，结束后自动再排队
 *
 * 使用独立数据库（server/data/demo.db），不污染真实存档。
 * Ctrl+C 同时停止全部子进程。
 *
 * 用法：
 *   npm run demo
 *   PORT=3100 npm run demo          # 换端口
 *   DB_PATH=/tmp/tw.db npm run demo # 换数据库
 */

'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PORT = parseInt(process.env.PORT, 10) || 3000;
const BASE = `http://localhost:${PORT}`;
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'server', 'data', 'demo.db');
// 本地 demo 把对局冷却缩到几秒，让对局持续产出（正式服务器仍是 5 分钟）
const MATCH_COOLDOWN_MS = parseInt(process.env.AI_MATCH_COOLDOWN_MS, 10) || 3000;

/** @type {import('node:child_process').ChildProcess[]} */
const children = [];
let shuttingDown = false;

function relay(tag, stream, onLine) {
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    for (const line of chunk.split(/\r?\n/)) {
      if (!line.trim()) continue;
      // 子进程自身已带 [bot] 前缀时避免重复
      const body = line.startsWith(tag) ? line.slice(tag.length).trimStart() : line;
      console.log(`${tag} ${body}`);
      if (onLine) onLine(body);
    }
  });
}

function startProcess(name, args, env, onLine) {
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  relay(`[${name}]`, child.stdout, onLine);
  relay(`[${name}]`, child.stderr);
  child.on('exit', (code) => {
    if (!shuttingDown && !child.intentionalExit) console.log(`[${name}] exited with code ${code}`);
  });
  return child;
}

function stopAll() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (requeueTimer) clearTimeout(requeueTimer);
  console.log('\nShutting down demo...');
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(0), 300);
}

async function waitForServer(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/`);
      if (res.ok) return;
    } catch {
      // 服务还没监听，继续等
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server did not become ready within ${timeoutMs}ms`);
}

async function registerDemoAccount() {
  // username 长度上限 16：demo_ + base36 时间戳 = 13
  const username = `demo_${Date.now().toString(36)}`;
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'demo-pass-1234' }),
  });
  if (!res.ok) throw new Error(`register failed: ${res.status} ${await res.text()}`);
  const { sessionToken } = await res.json();
  return { username, sessionToken };
}

async function mintBotToken(sessionToken) {
  const res = await fetch(`${BASE}/api/bot/token`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  if (!res.ok) throw new Error(`bot token failed: ${res.status} ${await res.text()}`);
  const { botToken } = await res.json();
  return botToken;
}

// --- 参赛 bot：一场结束后重连，于是重新入队（新连接 = 新 queue join） ---
let botToken = null;
let botChild = null;
let requeueTimer = null;

function startBot() {
  botChild = startProcess('bot', [path.join('examples', 'sample-bot-node', 'bot.js')], {
    BOT_URL: BASE,
    BOT_TOKEN: botToken,
  }, (line) => {
    if (/match \S+ -> (win|loss|draw)/.test(line)) scheduleRequeue();
  });
}

/** 冷却结束后重启 bot 进程，让本地 demo 持续出对局 */
function scheduleRequeue() {
  if (shuttingDown || requeueTimer) return;
  requeueTimer = setTimeout(() => {
    requeueTimer = null;
    if (shuttingDown) return;
    if (botChild && !botChild.killed) {
      botChild.intentionalExit = true;
      botChild.kill('SIGTERM');
    }
    startBot();
  }, MATCH_COOLDOWN_MS + 1800);
}

async function main() {
  console.log('Starting Token Wars demo...\n');

  startProcess('server', ['server/index.js'], {
    DEMO_HOUSEBOT: '1',
    PORT: String(PORT),
    DB_PATH,
    AI_MATCH_COOLDOWN_MS: String(MATCH_COOLDOWN_MS),
  });
  await waitForServer();

  const { username, sessionToken } = await registerDemoAccount();
  botToken = await mintBotToken(sessionToken);

  startBot();

  console.log(`
──────────────────────────────────────────────────────────────
  Token Wars demo is live — a sample bot fights the Gatekeeper
──────────────────────────────────────────────────────────────
  Play as a human:    ${BASE}
  Watch the arena:    ${BASE}/arena
  Competing bot:      ${username}
  Protocol schema:    ${BASE}/api/bot/protocol
  Demo database:      ${DB_PATH}

  Next: swap the bot's decide() for an LLM call, or point
  examples/llm-bot-node at any OpenAI-compatible endpoint.

  Note: the demo shortens the match cooldown to ${Math.round(MATCH_COOLDOWN_MS / 1000)}s and
  reconnects the bot after each fight, so matches keep coming.
  Real servers keep the 5-minute cooldown.
  Ctrl+C to stop everything.
`);
}

process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);

main().catch((err) => {
  console.error(`\ndemo failed: ${err.message}`);
  stopAll();
  process.exitCode = 1;
});
