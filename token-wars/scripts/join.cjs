/**
 * Token Wars — 一条命令加入一个已在运行的竞技场（本地或公网）
 *
 * 做的事：
 *   1. 在目标服务器注册（账号已存在则登录）
 *   2. 签发 botToken
 *   3. 启动示例 bot 连上去 —— 若服务器开了 DEMO_HOUSEBOT，几秒内就开打
 *
 * 用法：
 *   npm run join                                        # http://localhost:3000
 *   npm run join -- --url https://your-arena.example    # 指向公网实例
 *   npm run join -- --name my-agent --password secret   # 固定账号（便于重复运行）
 *   npm run join -- --bot examples/llm-bot-node/llm-bot.js
 *
 * 示例 bot 会沿用 BOT_URL / BOT_TOKEN 环境变量，因此换任何参赛程序都只需
 * 把 --bot 指过去（LLM bot 另需 OPENAI_API_KEY / MODEL 等自身变量）。
 */

'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { out[key] = next; i += 1; }
    else out[key] = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || args.h) {
  console.log(`
Usage: npm run join -- [--url <base>] [--name <username>] [--password <pw>] [--bot <script>]

  --url       arena origin (default http://localhost:3000)
  --name      account name, 2-16 chars (default bot_<random>)
  --password  account password (default generated; reuse it to log in again)
  --bot       competitor script (default examples/sample-bot-node/bot.js)
`);
  process.exit(0);
}

const BASE = String(args.url || process.env.BOT_URL || 'http://localhost:3000').replace(/\/+$/, '');
const NAME = String(args.name || `bot_${Date.now().toString(36).slice(-6)}`);
const PASSWORD = String(args.password || `tw-${NAME}-pass`);
const BOT = String(args.bot || path.join('examples', 'sample-bot-node', 'bot.js'));

async function ensureSessionToken() {
  const register = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: NAME, password: PASSWORD }),
  });
  if (register.ok) return (await register.json()).sessionToken;

  const detail = await register.text();
  // 账号已存在 → 用同一密码登录
  if (register.status === 400 || register.status === 409) {
    const login = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: NAME, password: PASSWORD }),
    });
    if (login.ok) return (await login.json()).sessionToken;
    throw new Error(`account exists but login failed (pass --password to reuse it): ${await login.text()}`);
  }
  throw new Error(`register failed: ${register.status} ${detail}`);
}

async function mintBotToken(sessionToken) {
  const res = await fetch(`${BASE}/api/bot/token`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  if (!res.ok) throw new Error(`bot token failed: ${res.status} ${await res.text()}`);
  return (await res.json()).botToken;
}

async function main() {
  // 先确认目标服务器活着，错误信息才可读
  try {
    const ping = await fetch(`${BASE}/api/bot/protocol`, { signal: AbortSignal.timeout(8000) });
    if (!ping.ok) throw new Error(`HTTP ${ping.status}`);
  } catch (err) {
    throw new Error(`cannot reach ${BASE} (${err.message}) — pass --url <arena origin>`);
  }

  const sessionToken = await ensureSessionToken();
  const botToken = await mintBotToken(sessionToken);

  console.log(`
──────────────────────────────────────────────────────────────
  Joined the arena
──────────────────────────────────────────────────────────────
  Arena:      ${BASE}
  Account:    ${NAME}
  Competitor: ${BOT}
  Watch:      ${BASE}/arena

  Copy-paste for any other bot:
    BOT_URL=${BASE} BOT_TOKEN=${botToken}

  (the token is a credential — anyone holding it can drive this account)
  Ctrl+C to disconnect.
`);

  const child = spawn(process.execPath, [BOT], {
    cwd: ROOT,
    env: { ...process.env, BOT_URL: BASE, BOT_TOKEN: botToken },
    stdio: 'inherit',
  });
  const stop = () => { try { child.kill('SIGTERM'); } catch { /* already gone */ } process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  child.on('exit', (code) => process.exit(code ?? 0));
}

main().catch((err) => {
  console.error(`\njoin failed: ${err.message}`);
  process.exitCode = 1;
});
