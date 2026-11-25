/**
 * 浏览器 Agent 沙盒（静态演示站 /sandbox）
 *
 * 让 AI 爱好者零安装写一个 decide(state) 策略，直接在浏览器里和竞技场同款
 * BuiltinBrain 对打。规则全部复用服务端实现：
 *   - 协议校验：server/game/BotProtocol.validateActionMessage
 *   - 动作执行：server/game/agentActionRules.executeAgentAction
 *   - 对手：server/game/BuiltinBrain
 *   - 地图：shared/arenaMaps
 * 另外按线上 parity 计数：500ms 决策截止、连续 3 次超时判负、单场 >10 次
 * 违规判负、120 秒平局。策略代码只在本机执行，不上传。
 */

'use strict';

const { AIAgent } = require('../../server/models/AIAgent');
const BuiltinBrain = require('../../server/game/BuiltinBrain');
const { executeAgentAction } = require('../../server/game/agentActionRules');
const { validateActionMessage } = require('../../server/game/BotProtocol');
const { simulateMatches } = require('../../server/game/agentSimulator');
const { AI_MAPS } = require('../../shared/arenaMaps');
const { renderAgentSource } = require('../../shared/agentTemplate');

const TICK_MS = 50;
const MATCH_MAX_MS = 120000;
const DECISION_DEADLINE_MS = 500;
const TIMEOUT_LIMIT = 3;
const VIOLATION_LIMIT = 10;
const CELL = 24;
const MAP = AI_MAPS.DATA_MINE;
const PROTOCOL_VERSION = 1;

const SAMPLE_BALANCED = `// 靠近 → 爆发/普攻 → 残血举盾
function decide(state) {
  const me = state.you, foe = state.enemy;
  const cd = (id) => {
    const s = me.skills.find((k) => k.id === id);
    return s ? s.cooldownRemaining : 0;
  };
  const dist = Math.abs(me.x - foe.x) + Math.abs(me.y - foe.y);

  if (dist <= 2) {
    if (cd('token_burst') === 0) return { type: 'skill', id: 'token_burst' };
    if (cd('basic_attack') === 0) return { type: 'attack' };
  }
  if (me.hp < 40 && !me.shieldActive && cd('shield') === 0) {
    return { type: 'shield' };
  }

  const blocked = new Set(state.map.obstacles.map(([x, y]) => x + ',' + y));
  const step = (dx, dy) => {
    if (dx === 0 && dy === 0) return null;
    const x = me.x + dx, y = me.y + dy;
    if (x < 0 || y < 0 || x >= state.map.width || y >= state.map.height) return null;
    if (blocked.has(x + ',' + y)) return null;
    return { type: 'move', x, y };
  };
  const dx = Math.sign(foe.x - me.x);
  const dy = Math.sign(foe.y - me.y);
  if (dx === 0 && dy === 0) return { type: 'idle' };
  const go = Math.abs(foe.y - me.y) > Math.abs(foe.x - me.x)
    ? (step(0, dy) || step(dx, 0))
    : (step(dx, 0) || step(0, dy));
  return go || { type: 'idle' };
}`;

const SAMPLE_TURTLE = `// 先举盾再换血：护盾吸收 20 点，冷却好了就补
function decide(state) {
  const me = state.you, foe = state.enemy;
  const cd = (id) => {
    const s = me.skills.find((k) => k.id === id);
    return s ? s.cooldownRemaining : 0;
  };
  const dist = Math.abs(me.x - foe.x) + Math.abs(me.y - foe.y);

  if (!me.shieldActive && cd('shield') === 0 && me.hp < 80) {
    return { type: 'shield' };
  }
  if (dist <= 2 && cd('basic_attack') === 0) return { type: 'attack' };
  if (dist <= 2 && cd('token_burst') === 0) return { type: 'skill', id: 'token_burst' };

  const blocked = new Set(state.map.obstacles.map(([x, y]) => x + ',' + y));
  const dx = Math.sign(foe.x - me.x);
  const dy = Math.sign(foe.y - me.y);
  const tries = Math.abs(dy) > Math.abs(dx)
    ? [[0, dy], [dx, 0], [dx, dy]]
    : [[dx, 0], [0, dy], [dx, dy]];
  for (const [sx, sy] of tries) {
    const x = me.x + sx, y = me.y + sy;
    if (x < 0 || y < 0 || x >= state.map.width || y >= state.map.height) continue;
    if (blocked.has(x + ',' + y)) continue;
    if (Math.abs(sx) + Math.abs(sy) !== 1) continue;
    return { type: 'move', x, y };
  }
  return { type: 'idle' };
}`;

const PRESETS = [
  { id: 'balanced', label: 'Balanced (chase + burst + shield)', code: SAMPLE_BALANCED },
  { id: 'turtle', label: 'Shield first (turtle)', code: SAMPLE_TURTLE },
];

const brain = new BuiltinBrain();
const ui = {};
let you = null;
let enemy = null;
let policy = null;
let timer = null;
let running = false;
let ended = false;
let elapsed = 0;
let tick = 0;
let stats = null;
let lastAction = '-';
let lastError = '';

const isWalkable = (x, y) => x >= 0 && y >= 0 && x < MAP.width && y < MAP.height
  && !MAP.obstacles.some(([ox, oy]) => ox === x && oy === y);

function freshAgents() {
  you = new AIAgent('sandbox-you', [], 'Your agent');
  you.name = 'YOUR AGENT';
  you.x = MAP.spawnA.x;
  you.y = MAP.spawnA.y;
  enemy = new AIAgent('sandbox-gatekeeper', [], 'Gatekeeper');
  enemy.x = MAP.spawnB.x;
  enemy.y = MAP.spawnB.y;
}

function resetStats() {
  stats = {
    decisions: 0, invalid: 0, timeouts: 0, consecutiveTimeouts: 0,
    totalDecideMs: 0, maxDecideMs: 0,
  };
}

function compilePolicy() {
  const code = ui.editor.value;
  const factory = new Function(`${code}\n;return typeof decide === 'function' ? decide : null;`);
  const fn = factory();
  if (typeof fn !== 'function') throw new Error('Define a function named decide(state).');
  return fn;
}

function start() {
  stop();
  lastError = '';
  ui.error.textContent = '';
  ui.result.classList.remove('show');
  ui.resultText.textContent = '';
  ended = false;
  running = true;
  elapsed = 0;
  tick = 0;
  lastAction = '-';
  freshAgents();
  resetStats();
  try {
    policy = compilePolicy();
  } catch (err) {
    running = false;
    lastError = err.message;
    ui.error.textContent = `Compile error: ${err.message}`;
    draw();
    updateHud();
    return;
  }
  timer = setInterval(step, TICK_MS);
  draw();
  updateHud();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  running = false;
}

function finish(result, reason) {
  ended = true;
  running = false;
  stop();
  const text = result === 'win' ? 'YOUR AGENT WINS'
    : (result === 'loss' ? 'GATEKEEPER WINS' : 'DRAW');
  ui.resultText.textContent = text;
  ui.result.dataset.result = result;
  ui.result.classList.add('show');
  ui.reason.textContent = reason || '';
  updateHud();
}

function buildState() {
  const now = performance.now();
  return {
    matchId: 'sandbox',
    tick,
    timeLeftMs: Math.max(0, MATCH_MAX_MS - elapsed),
    you: {
      x: you.x, y: you.y, hp: you.hp, maxHp: you.maxHp,
      shield: you.shield, shieldActive: you.shieldActive,
      skills: you.skills.map((s) => ({
        id: s.id,
        cooldownRemaining: Math.max(0, s.cooldown - (now - s.lastUsed)),
      })),
    },
    enemy: { x: enemy.x, y: enemy.y, hp: enemy.hp, maxHp: enemy.maxHp, visible: true },
    tokens: [],
    map: { width: MAP.width, height: MAP.height, obstacles: MAP.obstacles },
  };
}

function playerTurn(now) {
  you.tickShield();
  const snapshot = buildState();
  const t0 = performance.now();
  let action;
  try {
    // structuredClone 模拟线上序列化：策略改动 state 不会污染对局
    action = policy(structuredClone(snapshot));
  } catch (err) {
    lastError = `decide() threw: ${err.message}`;
    ui.error.textContent = lastError;
    finish('loss', 'your decide() threw');
    return false;
  }
  const decideMs = performance.now() - t0;
  stats.decisions++;
  stats.totalDecideMs += decideMs;
  stats.maxDecideMs = Math.max(stats.maxDecideMs, decideMs);

  // 线上 500ms 截止：超时按 idle 计，连续 3 次判负
  if (decideMs > DECISION_DEADLINE_MS) {
    stats.timeouts++;
    stats.consecutiveTimeouts++;
    lastAction = `idle(timeout ${Math.round(decideMs)}ms)`;
    return true;
  }
  stats.consecutiveTimeouts = 0;

  const msg = {
    protocolVersion: PROTOCOL_VERSION,
    matchId: 'sandbox',
    tick,
    action,
    tokensUsed: 0,
  };
  const validation = validateActionMessage(msg, { width: MAP.width, height: MAP.height });
  if (!validation.valid) {
    stats.invalid++;
    lastAction = `idle(${validation.code})`;
    return true;
  }
  const applied = executeAgentAction(you, enemy, validation.action, { now, map: MAP, isWalkable });
  if (applied.invalid) stats.invalid++;
  lastAction = applied.label;
  return true;
}

function step() {
  if (!running || ended) return;
  tick++;
  elapsed += TICK_MS;
  const now = performance.now();
  const canAct = [you.alive, enemy.alive];

  if (canAct[0]) playerTurn(now);
  if (canAct[1] && !ended) brain.decide(enemy, you, { now, map: MAP, isWalkable });

  draw();
  updateHud();

  if (stats.consecutiveTimeouts >= TIMEOUT_LIMIT) return finish('loss', '3 consecutive decision timeouts');
  if (stats.invalid > VIOLATION_LIMIT) return finish('loss', 'more than 10 invalid actions');
  if (!you.alive || !enemy.alive) {
    return finish(you.alive ? 'win' : (enemy.alive ? 'loss' : 'draw'),
      you.alive || enemy.alive ? 'hp reached 0' : 'both agents died on the same tick');
  }
  if (elapsed >= MATCH_MAX_MS) return finish('draw', '120 s match limit');
}

// --- 分享与导出 ---------------------------------------------------------------

const MAX_HASH_CHARS = 20000;

function encodeCode(code) {
  const bytes = new TextEncoder().encode(code);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeCode(encoded) {
  try {
    const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const bin = atob(padded);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function codeFromHash() {
  const m = /(?:^|[#&])code=([^&]+)/.exec(location.hash || '');
  return m ? decodeCode(m[1]) : null;
}

async function copyShareLink() {
  const code = ui.editor.value;
  if (code.length > MAX_HASH_CHARS) {
    ui.shareStatus.textContent = 'Policy too large for a link — use Download instead.';
    return;
  }
  const url = `${location.href.split('#')[0]}#code=${encodeCode(code)}`;
  history.replaceState(null, '', url);
  try {
    await navigator.clipboard.writeText(url);
    ui.shareStatus.textContent = 'Share link copied — it opens this policy and runs it.';
  } catch {
    window.prompt('Copy this link', url);
  }
}

function downloadAgent() {
  const src = renderAgentSource(ui.editor.value);
  const blob = new Blob([src], { type: 'text/javascript' });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = 'token-wars-agent.js';
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a); // 部分浏览器要求锚点在文档里才会触发下载
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 2000);
  ui.shareStatus.textContent = 'Downloaded token-wars-agent.js — run it with BOT_TOKEN=… node token-wars-agent.js';
}

// 批量评估：暂停动画，直接跑 50 场，给出胜率与耗时（AI 作者调参用）
function simulateBatch() {
  let policy;
  try {
    policy = compilePolicy();
  } catch (err) {
    ui.error.textContent = `Compile error: ${err.message}`;
    return;
  }
  stop();
  ui.error.textContent = '';
  ui.simulate.disabled = true;
  ui.simResult.textContent = 'Simulating 50 matches…';
  // 先让浏览器画一帧，再进入同步模拟
  setTimeout(() => {
    try {
      const out = simulateMatches(policy, { count: 50, map: MAP });
      ui.simResult.textContent = `${out.matches} matches: ${out.wins}W / ${out.losses}L / ${out.draws}D`
        + ` (${out.winRate}% win) · avg ${out.avgTicks} ticks`
        + ` · invalid ${out.invalid} · timeouts ${out.timeouts}`
        + ` · decision avg ${out.avgDecisionMs}ms / max ${out.maxDecisionMs}ms`
        + ` · ${out.wallMs}ms wall`;
    } catch (err) {
      ui.error.textContent = `Simulation failed: ${err.message}`;
      ui.simResult.textContent = '';
    } finally {
      ui.simulate.disabled = false;
    }
  }, 30);
}

// --- 渲染 -------------------------------------------------------------------

function draw() {
  const ctx = ui.canvas.getContext('2d');
  const w = MAP.width * CELL;
  const h = MAP.height * CELL;
  if (ui.canvas.width !== w) { ui.canvas.width = w; ui.canvas.height = h; }
  ctx.fillStyle = '#06060f';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(0,255,136,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < MAP.width; i++) { ctx.moveTo(i * CELL + 0.5, 0); ctx.lineTo(i * CELL + 0.5, h); }
  for (let j = 1; j < MAP.height; j++) { ctx.moveTo(0, j * CELL + 0.5); ctx.lineTo(w, j * CELL + 0.5); }
  ctx.stroke();
  ctx.fillStyle = '#17242e';
  for (const [x, y] of MAP.obstacles) ctx.fillRect(x * CELL, y * CELL, CELL - 1, CELL - 1);

  const entity = (a, color) => {
    if (!a || !a.alive) return;
    ctx.fillStyle = a.shieldActive ? '#88aaff' : color;
    ctx.fillRect(a.x * CELL + 2, a.y * CELL + 2, CELL - 4, CELL - 4);
    if (a.shieldActive) {
      ctx.strokeStyle = '#88aaff';
      ctx.lineWidth = 2;
      ctx.strokeRect(a.x * CELL + 1, a.y * CELL + 1, CELL - 2, CELL - 2);
    }
  };
  entity(enemy, '#ff4466');
  entity(you, '#00ff88');
}

const pct = (a) => Math.max(0, Math.round((a.hp / a.maxHp) * 100));

function updateHud() {
  if (!you) return;
  ui.hpYou.textContent = `${pct(you)}`;
  ui.hpEnemy.textContent = `${pct(enemy)}`;
  ui.barYou.style.width = `${pct(you)}%`;
  ui.barEnemy.style.width = `${pct(enemy)}%`;
  const left = Math.max(0, MATCH_MAX_MS - elapsed);
  const s = Math.ceil(left / 1000);
  ui.clock.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  ui.stats.textContent = `tick ${tick} · decisions ${stats.decisions} · invalid ${stats.invalid}`
    + ` · timeouts ${stats.timeouts} · avg ${stats.decisions ? Math.round(stats.totalDecideMs / stats.decisions) : 0}ms`
    + ` (max ${Math.round(stats.maxDecideMs)}ms)`;
  ui.lastAction.textContent = `last action: ${lastAction}`;
  ui.shieldTag.textContent = you.shieldActive ? `SHIELD ${you.shield}` : '';
}

// --- 启动 -------------------------------------------------------------------

function boot() {
  const $ = (id) => document.getElementById(id);
  Object.assign(ui, {
    canvas: $('board'),
    editor: $('editor'),
    preset: $('preset'),
    run: $('run'),
    stop: $('stop'),
    reset: $('reset'),
    share: $('share'),
    download: $('download'),
    simulate: $('simulate'),
    simResult: $('simResult'),
    shareStatus: $('shareStatus'),
    error: $('error'),
    result: $('result'),
    resultText: $('resultText'),
    reason: $('reason'),
    hpYou: $('hpYou'),
    hpEnemy: $('hpEnemy'),
    barYou: $('barYou'),
    barEnemy: $('barEnemy'),
    clock: $('clock'),
    stats: $('stats'),
    lastAction: $('lastAction'),
    shieldTag: $('shieldTag'),
  });

  PRESETS.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.label;
    ui.preset.appendChild(opt);
  });
  ui.editor.value = SAMPLE_BALANCED;
  const shared = codeFromHash();
  if (shared) {
    ui.editor.value = shared;
    ui.shareStatus.textContent = 'Loaded a shared policy from the link.';
  }
  ui.preset.addEventListener('change', () => {
    const preset = PRESETS.find((p) => p.id === ui.preset.value) || PRESETS[0];
    ui.editor.value = preset.code;
  });
  ui.run.addEventListener('click', start);
  ui.stop.addEventListener('click', () => { stop(); ui.reason.textContent = 'stopped'; });
  ui.share.addEventListener('click', copyShareLink);
  ui.download.addEventListener('click', downloadAgent);
  ui.simulate.addEventListener('click', simulateBatch);
  ui.editor.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      start();
    }
  });
  ui.reset.addEventListener('click', () => {
    stop();
    ended = false;
    elapsed = 0;
    tick = 0;
    resetStats();
    freshAgents();
    ui.result.classList.remove('show');
    ui.error.textContent = '';
    draw();
    updateHud();
  });

  freshAgents();
  resetStats();
  draw();
  updateHud();

  // 打开页面即跑一次默认策略，先看到效果再改代码
  start();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
