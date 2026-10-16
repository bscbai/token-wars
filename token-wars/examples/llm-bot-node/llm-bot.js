/**
 * Token Wars — LLM 参赛 bot（Node.js，OpenAI 兼容 API）
 *
 * 每个 tick 把战局序列化进 prompt，要求模型只回一个 JSON 动作：
 *   {"thought":"...","action":{"type":"move","x":6,"y":5}}
 *
 * 设计要点（对应服务端 parity 规则，见 docs/bot-protocol.en.md §6）：
 *   - 决策截止 500ms：AbortController 420ms 超时；超时/解析失败/API 报错
 *     一律回退 idle（合法动作，不累计违规，也不会因此判负——连续 3 次
 *     超时才判负，所以慢模型偶发抖动是安全的）
 *   - tokensUsed 上报 API 返回的 usage.total_tokens（模型规格申报抽查时
 *     的对照数据；请如实上报）
 *   - 客户端轻量校验动作（move 必须相邻且可通行；attack 距离 ≤2），
 *     防止模型输出格式正确但不合法的动作浪费违规计数
 *
 * 用法：
 *   BOT_TOKEN=<botToken> OPENAI_API_KEY=<key> \
 *   MODEL=gpt-4o-mini node llm-bot.js
 *
 * 本地模型（OpenAI 兼容端点）：
 *   OPENAI_BASE_URL=http://localhost:8080/v1 MODEL=qwen2.5-7b-instruct \
 *   BOT_TOKEN=<botToken> node llm-bot.js
 *   （llama.cpp：--port 8080；Ollama：http://localhost:11434/v1）
 */

'use strict';

const { io } = require('socket.io-client');

const URL = process.env.BOT_URL || 'http://localhost:3000';
const MODEL = process.env.MODEL || 'gpt-4o-mini';
const BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const API_KEY = process.env.OPENAI_API_KEY || 'not-needed-for-local';
const DECISION_TIMEOUT_MS = 420; // < 服务端 500ms 截止，留 80ms 网络余量
const PROTOCOL_VERSION = 1;

const SYSTEM_PROMPT = `You are controlling an agent in Token Wars, a real-time 1v1 grid game.
You receive game state every 50ms (20 Hz) and must reply with ONE action per tick.

Rules:
- Grid coordinates are integers. You and the enemy are at {x, y}; Manhattan distance matters.
- Actions (exactly one JSON object, no prose):
  * {"type":"idle"} — wait
  * {"type":"move","x":INT,"y":INT} — move to an ADJACENT cell (Manhattan distance exactly 1), inside the map and not an obstacle
  * {"type":"attack"} — only when the enemy is within Manhattan distance 2 and basic_attack cooldownRemaining is 0
  * {"type":"skill","id":"dodge_roll|shield|token_burst"} — use a skill when its cooldownRemaining is 0
  * {"type":"shield"} — enable shield (20 absorb) when not active and off cooldown
- You see "cooldownRemaining" per skill in ms; never use a skill with cooldownRemaining > 0.
- When enemy is not visible, idle. When visible: approach when far (one cell per tick),
  attack when adjacent/in range, shield when HP is low.
- Reply with strict JSON on a single line: {"thought":"SHORT","action":{...}}
- Never include markdown fences. The action must be legal this tick.`;

/** 最近一场邀请的地图 */
let mapInfo = null;
let stats = { calls: 0, timeouts: 0, errors: 0, invalid: 0, tokens: 0 };

/** 连接 /bot 并开始参赛（仅直接运行时调用；require 本模块不产生副作用） */
function startBot() {
  const token = process.env.BOT_TOKEN;
  if (!token) {
    console.error('Missing BOT_TOKEN env var. See ../sample-bot-node/README.md.');
    process.exit(1);
  }

  const socket = io(`${URL}/bot`, {
    auth: { botToken: token },
    transports: ['websocket'],
  });

  socket.on('connect', () => console.log(`[llm-bot] ${MODEL} connected as ${socket.id}; waiting...`));
  socket.on('connect_error', (err) => console.error(`[llm-bot] connect failed: ${err.message}`));

  socket.on('bot:match_invite', (invite) => {
    mapInfo = invite.map;
    console.log(`[llm-bot] invited as ${invite.role} to ${invite.matchId.slice(0, 24)}…`);
    socket.emit('bot:match_accept', { protocolVersion: PROTOCOL_VERSION, matchId: invite.matchId });
  });

  socket.on('bot:state', async (state) => {
    const { action, tokensUsed } = await decide(state);
    socket.emit('bot:action', {
      protocolVersion: PROTOCOL_VERSION,
      matchId: state.matchId,
      tick: state.tick,
      action,
      tokensUsed,
    });
  });

  socket.on('bot:match_end', (msg) => {
    console.log(`[llm-bot] ${msg.matchId.slice(0, 24)}… -> ${msg.result}`, msg.stats, '| client stats:', stats);
    stats = { calls: 0, timeouts: 0, errors: 0, invalid: 0, tokens: 0 };
  });
  socket.on('bot:error', (msg) => console.warn('[llm-bot] server error:', msg));
  socket.on('disconnect', (r) => console.log(`[llm-bot] disconnected: ${r}`));
}

// 直接运行（node llm-bot.js）才连接；被 require 时仅导出纯函数供测试
if (require.main === module) startBot();

// --- 决策 -------------------------------------------------------------------

function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function walkable(x, y) {
  if (!mapInfo) return true;
  if (x < 0 || y < 0 || x >= mapInfo.width || y >= mapInfo.height) return false;
  return !mapInfo.obstacles.some(([ox, oy]) => ox === x && oy === y);
}

function skillReady(you, id) {
  const s = you.skills.find((k) => k.id === id);
  return !s || s.cooldownRemaining === 0;
}

/** 模型输出 → 合法动作；非法/缺字段返回 null */
function sanitizeAction(raw, state) {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw.action;
  const { you, enemy } = state;
  if (!a || typeof a.type !== 'string') return null;

  switch (a.type) {
    case 'idle':
      return { type: 'idle' };
    case 'attack':
      if (enemy && enemy.visible && manhattan(you, enemy) <= 2 && skillReady(you, 'basic_attack')) {
        return { type: 'attack' };
      }
      return null;
    case 'shield':
      if (!you.shieldActive && skillReady(you, 'shield')) return { type: 'shield' };
      return null;
    case 'skill': {
      const allowed = ['dodge_roll', 'shield', 'token_burst'];
      if (typeof a.id === 'string' && allowed.includes(a.id) && skillReady(you, a.id)) {
        return { type: 'skill', id: a.id };
      }
      return null;
    }
    case 'move': {
      const x = Number(a.x);
      const y = Number(a.y);
      if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
      if (manhattan(you, { x, y }) !== 1 || !walkable(x, y)) return null;
      return { type: 'move', x, y };
    }
    default:
      return null;
  }
}

/** 从模型回复中抽取 JSON（容忍偶尔的前后缀文字，但不要 fences） */
function parseModelJson(text) {
  if (!text) return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * 一个 tick 的决策。永不抛错——任何失败路径都返回 { action: idle, tokensUsed: 0 }。
 */
async function decide(state) {
  stats.calls++;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DECISION_TIMEOUT_MS);

  try {
    const resp = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: JSON.stringify({
              tick: state.tick,
              timeLeftMs: state.timeLeftMs,
              you: state.you,
              enemy: state.enemy,
              map: mapInfo ? { width: mapInfo.width, height: mapInfo.height } : null,
            }),
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      stats.errors++;
      console.warn(`[llm-bot] API ${resp.status}: ${(await resp.text()).slice(0, 120)}`);
      return { action: { type: 'idle' }, tokensUsed: 0 };
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content;
    const tokensUsed = data.usage?.total_tokens || 0;
    stats.tokens += tokensUsed;

    const parsed = parseModelJson(content);
    const action = sanitizeAction(parsed, state);
    if (!action) {
      stats.invalid++;
      return { action: { type: 'idle' }, tokensUsed };
    }
    return { action, tokensUsed };
  } catch (err) {
    if (err.name === 'AbortError') stats.timeouts++;
    else { stats.errors++; console.warn(`[llm-bot] API error: ${err.message}`); }
    return { action: { type: 'idle' }, tokensUsed: 0 };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { sanitizeAction, parseModelJson, decide, SYSTEM_PROMPT };
