/**
 * 浏览器试玩页（静态演示站 /play）
 *
 * 目的：让访问者在零安装的前提下亲手打一局——对手是服务端同款 BuiltinBrain，
 * 伤害掷骰、技能冷却、护盾衰减、同 tick 对称结算全部复用服务端实现：
 *   - `server/game/BuiltinBrain`「内置 AI 的决策逻辑」
 *   - `server/game/arenaDamage`「12% 暴击 ×1.6、±10% 浮动」
 *   - `server/models/AIAgent`「技能冷却 / 护盾 / 伤害吸收」
 * 地图来自 `shared/arenaMaps`，与线上对局完全一致。
 *
 * 走位 WASD / 方向键，J 普攻（距离≤2），K 算力爆发（1.5×），
 * L 护盾（吸收 20），空格 闪避冲刺（向敌方 3 格）。R 重开。
 */

'use strict';

const { AIAgent } = require('../../server/models/AIAgent');
const BuiltinBrain = require('../../server/game/BuiltinBrain');
const { rollArenaDamage } = require('../../server/game/arenaDamage');
const { AI_MAPS } = require('../../shared/arenaMaps');

const TICK_MS = 50; // 20 Hz，与服务器同频
const MATCH_MAX_MS = 120000;
const CELL = 24;

const MAP = AI_MAPS.DATA_MINE;
const brain = new BuiltinBrain();

const ui = {};
let you = null;
let enemy = null;
let running = false;
let ended = false;
let timer = null;
let elapsed = 0;
let held = new Set();

function isWalkable(x, y) {
  if (x < 0 || y < 0 || x >= MAP.width || y >= MAP.height) return false;
  return !MAP.obstacles.some(([ox, oy]) => ox === x && oy === y);
}

function dist(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function freshAgents() {
  you = new AIAgent('local-player', [], 'You');
  you.name = 'YOU';
  you.x = MAP.spawnA.x;
  you.y = MAP.spawnA.y;

  enemy = new AIAgent('local-gatekeeper', [], 'Gatekeeper');
  enemy.x = MAP.spawnB.x;
  enemy.y = MAP.spawnB.y;
}

function reset() {
  stop();
  freshAgents();
  elapsed = 0;
  ended = false;
  running = true;
  ui.result.textContent = '';
  ui.result.classList.remove('show');
  start();
  draw();
  updateHud();
}

function start() {
  stop();
  running = true;
  timer = setInterval(tick, TICK_MS);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  running = false;
}

// --- 玩家操作 ---------------------------------------------------------------

function tryMove(dx, dy) {
  if (dx === 0 && dy === 0) return false;
  if (isWalkable(you.x + dx, you.y + dy)) {
    you.x += dx;
    you.y += dy;
    return true;
  }
  return false;
}

function heldDir() {
  const k = held;
  if (k.has('arrowup') || k.has('w')) return [0, -1];
  if (k.has('arrowdown') || k.has('s')) return [0, 1];
  if (k.has('arrowleft') || k.has('a')) return [-1, 0];
  if (k.has('arrowright') || k.has('d')) return [1, 0];
  return [0, 0];
}

/** 返回 true 表示玩家本 tick 做了动作 */
function playerAct(now) {
  const [dx, dy] = heldDir();
  if (dx || dy) {
    if (tryMove(dx, dy)) return true;
    // 被挡时沿另一轴侧移，避免贴着墙卡死
    if (dx && tryMove(0, dy || 1)) return true;
    if (dy && tryMove(dx || 1, 0)) return true;
  }
  return false;
}

function tryAttack(now) {
  if (!running || ended) return;
  if (dist(you, enemy) > 2) return flashHint('Attack needs range ≤ 2');
  if (you.skillOnCooldown('basic_attack', now)) return;
  you.useSkill('basic_attack', now, 1);
  const dmg = rollArenaDamage(you.atk, 1.0, enemy.def);
  enemy.takeDamage(dmg, you.id);
  draw();
  updateHud();
}

function tryBurst(now) {
  if (!running || ended) return;
  if (dist(you, enemy) > 2) return flashHint('Burst needs range ≤ 2');
  if (you.skillOnCooldown('token_burst', now)) return;
  you.useSkill('token_burst', now, 3);
  const dmg = rollArenaDamage(you.atk, 1.5, enemy.def);
  enemy.takeDamage(dmg, you.id);
  draw();
  updateHud();
}

function tryShield(now) {
  if (!running || ended) return;
  if (you.shieldActive || you.skillOnCooldown('shield', now)) return;
  you.enableShield(you.shieldMax);
  you.useSkill('shield', now);
  draw();
  updateHud();
}

function tryDash(now) {
  if (!running || ended) return;
  if (you.skillOnCooldown('dodge_roll', now)) return;
  you.useSkill('dodge_roll', now, 0);
  const dx = Math.sign(enemy.x - you.x);
  const dy = Math.sign(enemy.y - you.y);
  for (let step = 0; step < 3; step++) {
    if (!tryMove(dx, dy)) break;
  }
  draw();
  updateHud();
}

let hintTimer = null;
function flashHint(text) {
  ui.hint.textContent = text;
  if (hintTimer) clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { ui.hint.textContent = ''; }, 1200);
}

// --- 主循环 -----------------------------------------------------------------

function tick() {
  if (!running || ended) return;
  const now = performance.now();
  elapsed += TICK_MS;

  // 同 tick 对称：双方都按「回合开始」的存活状态行动
  const canAct = [you.alive, enemy.alive];

  if (canAct[0]) {
    you.tickShield();
    playerAct(now);
  }
  if (canAct[1]) {
    brain.decide(enemy, you, { now, map: MAP, isWalkable });
  }

  draw();
  updateHud();

  const youDead = !you.alive;
  const enemyDead = !enemy.alive;
  if (youDead || enemyDead) {
    finish(youDead && enemyDead ? 'draw' : (enemyDead ? 'win' : 'loss'));
    return;
  }
  if (elapsed >= MATCH_MAX_MS) finish('draw');
}

function finish(result) {
  ended = true;
  running = false;
  stop();
  const text = result === 'win' ? 'YOU WIN' : (result === 'loss' ? 'GATEKEEPER WINS' : 'DRAW');
  ui.result.textContent = text;
  ui.result.classList.add('show');
  ui.result.dataset.result = result;
  updateHud();
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

  const entity = (a, color, dim) => {
    if (!a.alive) return;
    ctx.fillStyle = a.shieldActive ? '#88aaff' : color;
    ctx.fillRect(a.x * CELL + 2, a.y * CELL + 2, CELL - 4, CELL - 4);
    if (a.shieldActive) {
      ctx.strokeStyle = '#88aaff';
      ctx.lineWidth = 2;
      ctx.strokeRect(a.x * CELL + 1, a.y * CELL + 1, CELL - 2, CELL - 2);
    }
    // 选择框：玩家用外圈标记
    if (dim) {
      ctx.strokeStyle = '#00ff88';
      ctx.lineWidth = 1;
      ctx.strokeRect(a.x * CELL + 0.5, a.y * CELL + 0.5, CELL - 1, CELL - 1);
    }
  };
  entity(enemy, '#ff4466', false);
  entity(you, '#00ff88', true);
}

function pct(a) { return Math.max(0, Math.round((a.hp / a.maxHp) * 100)); }

function updateHud() {
  ui.hpYou.textContent = `${pct(you)}`;
  ui.hpEnemy.textContent = `${pct(enemy)}`;
  ui.barYou.style.width = `${pct(you)}%`;
  ui.barEnemy.style.width = `${pct(enemy)}%`;
  ui.clock.textContent = formatClock(Math.max(0, MATCH_MAX_MS - elapsed));
  const now = performance.now();
  const pill = (el, id, label) => {
    const ready = !you.skillOnCooldown(id, now);
    el.textContent = label;
    el.classList.toggle('ready', ready);
  };
  pill(ui.skillAttack, 'basic_attack', 'J 普攻');
  pill(ui.skillBurst, 'token_burst', 'K 爆发');
  pill(ui.skillShield, 'shield', 'L 护盾');
  pill(ui.skillDash, 'dodge_roll', '␣ 冲刺');
  ui.shieldTag.textContent = you.shieldActive ? `SHIELD ${you.shield}` : '';
}

function formatClock(ms) {
  const s = Math.ceil(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// --- 输入 -------------------------------------------------------------------

function bindInput() {
  window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'w', 'a', 's', 'd',
      'j', 'k', 'l'].includes(key)) e.preventDefault();
    held.add(key);
    const now = performance.now();
    if (key === 'j') tryAttack(now);
    if (key === 'k') tryBurst(now);
    if (key === 'l') tryShield(now);
    if (key === ' ') tryDash(now);
    if (key === 'r' || (ended && key === 'enter')) reset();
  });
  window.addEventListener('keyup', (e) => held.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => held.clear());

  // 触屏/鼠标：按住方向键移动，点按技能
  const hold = (el, key) => {
    const start = (e) => { e.preventDefault(); held.add(key); };
    const end = (e) => { e.preventDefault(); held.delete(key); };
    el.addEventListener('pointerdown', start);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointerleave', end);
    el.addEventListener('pointercancel', end);
  };
  hold(ui.padUp, 'w');
  hold(ui.padDown, 's');
  hold(ui.padLeft, 'a');
  hold(ui.padRight, 'd');
  ui.skillAttack.addEventListener('click', () => tryAttack(performance.now()));
  ui.skillBurst.addEventListener('click', () => tryBurst(performance.now()));
  ui.skillShield.addEventListener('click', () => tryShield(performance.now()));
  ui.skillDash.addEventListener('click', () => tryDash(performance.now()));
  ui.restart.addEventListener('click', reset);
}

// --- 启动 -------------------------------------------------------------------

function boot() {
  const $ = (id) => document.getElementById(id);
  Object.assign(ui, {
    canvas: $('board'),
    hpYou: $('hpYou'),
    hpEnemy: $('hpEnemy'),
    barYou: $('barYou'),
    barEnemy: $('barEnemy'),
    clock: $('clock'),
    result: $('result'),
    hint: $('hint'),
    shieldTag: $('shieldTag'),
    restart: $('restart'),
    skillAttack: $('skillAttack'),
    skillBurst: $('skillBurst'),
    skillShield: $('skillShield'),
    skillDash: $('skillDash'),
    padUp: $('padUp'),
    padDown: $('padDown'),
    padLeft: $('padLeft'),
    padRight: $('padRight'),
  });
  bindInput();
  reset();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
