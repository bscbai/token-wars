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

const MAP_LIST = Object.values(AI_MAPS);
const MAP_EN = {
  data_mine: 'Data Mine',
  compute_square: 'Compute Square',
  cache_maze: 'Cache Maze',
  arena_dome: 'Arena Dome',
  data_torrent: 'Data Torrent',
};
const MAP_KEY = 'tw-play-map';
let MAP = AI_MAPS.DATA_MINE;
const brain = new BuiltinBrain();

// 每日挑战：本地日期决定「地图 + 规则变体」，每天轮换，无需服务端。
// 地图每天变；规则变体每 5 天换一档（5 张图 × 5 变体 = 25 天不重复组合）。
const DAILY_EPOCH = Date.UTC(2026, 0, 1);
const DAILY_MUTATORS = [
  { id: 'blitz', maxMs: 60000 },
  { id: 'glass', hp: 60 },
  { id: 'guarded', enemyShield: true },
  { id: 'fierce', enemyAtkMult: 1.25 },
  { id: 'fragile', youHp: 60 },
];

function dailyInfo(date = new Date()) {
  const localMidnight = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const day = Math.floor((localMidnight - DAILY_EPOCH) / 86400000);
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    + `-${String(date.getDate()).padStart(2, '0')}`;
  const mapIndex = ((day % MAP_LIST.length) + MAP_LIST.length) % MAP_LIST.length;
  const mutIndex = ((Math.floor(day / MAP_LIST.length) % DAILY_MUTATORS.length)
    + DAILY_MUTATORS.length) % DAILY_MUTATORS.length;
  return {
    key,
    number: day + 1,
    map: MAP_LIST[mapIndex],
    mutator: DAILY_MUTATORS[mutIndex],
  };
}

const I18N = {
  en: {
    subtitle: "Human vs the arena's built-in AI — same rules, in your browser.",
    banner: `This is a playable slice, not the full game. The opponent is the exact
      <code>BuiltinBrain</code> that competes on the arena ladder, with the same
      500&nbsp;ms basic cooldown, 10&nbsp;s burst, 3&nbsp;s dash, 20-point shield and
      12%&nbsp;crit damage. The complete game (mining, ladder, bots) runs locally with
      <code>npm start</code>. <a href="./index.html">Watch recorded matches →</a>
      · <a href="./sandbox.html">Write an agent →</a>`,
    match: 'Match',
    mapLabel: 'Arena',
    mapAria: 'arena map',
    you: 'YOU',
    hpAriaYou: 'Your HP',
    hpAriaEnemy: 'Gatekeeper HP',
    skillAttack: 'J Attack',
    skillBurst: 'K Burst',
    skillShield: 'L Shield',
    skillDash: '␣ Dash',
    restart: 'Restart (R)',
    shareResult: 'Share result',
    howToPlay: 'How to play',
    introTitle: 'How to fight',
    introMove: '<b>WASD / arrows</b> move — on a phone, use the pad.',
    introAttack: '<b>J</b> attacks when the enemy is within 2 tiles.',
    introSkills: '<b>K</b> burst · <b>L</b> shield absorbs 20 · <b>Space</b> dash 3 tiles.',
    introWin: 'Drop the gatekeeper to 0 HP. It uses the same cooldowns you do.',
    introStart: 'Start fighting',
    controlsNote: `<b>WASD / arrows</b> move · <b>J</b> attack (range ≤ 2) · <b>K</b> burst
      (1.5×, 10 s) · <b>L</b> shield (absorbs 20) · <b>Space</b> dash toward the
      enemy · <b>R</b> restart. Touch: use the pad and buttons above.`,
    agentNote: `Because the AI is the same code as the server, this is also the fastest
      way to feel what a bot opponent is like before you
      <a href="https://github.com/bscbai/token-wars/blob/main/token-wars/docs/agent-quickstart.md">write your own</a>.`,
    footerMatches: 'Recorded matches',
    footerAgent: 'Write an agent',
    footerBenchmark: 'Benchmark v0',
    footerProtocol: 'Bot protocol',
    padAria: 'movement',
    up: 'up',
    left: 'left',
    down: 'down',
    right: 'right',
    resultWin: 'YOU WIN',
    resultLoss: 'GATEKEEPER WINS',
    resultDraw: 'DRAW',
    resultCtaWin: 'Now beat a bot policy — open the sandbox →',
    resultCtaLoss: 'Beat it with code — write a bot →',
    resultCtaDraw: 'Try the bot sandbox →',
    hintAttack: 'Attack needs range ≤ 2',
    hintBurst: 'Burst needs range ≤ 2',
    shareCopied: 'Result copied — paste it in Discord, X or a PR.',
    sharePrompt: 'Copy this result',
    dailyTitle: 'Daily challenge',
    dailyNone: 'Not played today',
    dailyLoss: '✗ today',
    dailyDraw: '= today',
    mut_blitz: 'Blitz 60s',
    mut_glass: 'Glass 60 HP',
    mut_guarded: 'Shielded foe',
    mut_fierce: 'Fierce AI',
    mut_fragile: 'Fragile: you 60 HP',
  },
  zh: {
    subtitle: '人类 vs 竞技场内置 AI——同一套规则，全部在浏览器里。',
    banner: `这是可玩的切片，不是完整游戏。对手是竞技场天梯上同一个
      <code>BuiltinBrain</code>，500&nbsp;ms 普攻冷却、10&nbsp;s 爆发、3&nbsp;s 冲刺、
      20 点护盾、12%&nbsp;暴击伤害完全一致。完整游戏（挖矿、排位、bot）可在本地
      <code>npm start</code> 运行。<a href="./index.html">看录制对局 →</a>
      · <a href="./sandbox.html">写个 agent →</a>`,
    match: '对局',
    mapLabel: '竞技场',
    mapAria: '竞技场地图',
    you: '你',
    hpAriaYou: '你的生命值',
    hpAriaEnemy: '守门 AI 生命值',
    skillAttack: 'J 普攻',
    skillBurst: 'K 爆发',
    skillShield: 'L 护盾',
    skillDash: '␣ 冲刺',
    restart: '重开 (R)',
    shareResult: '分享战绩',
    howToPlay: '操作说明',
    introTitle: '怎么打',
    introMove: '<b>WASD / 方向键</b> 移动——手机用上方方向键。',
    introAttack: '<b>J</b> 在距离 ≤ 2 时普攻。',
    introSkills: '<b>K</b> 爆发 · <b>L</b> 护盾吸收 20 点 · <b>空格</b> 向敌方冲刺 3 格。',
    introWin: '把守门 AI 打到 0 血即可获胜；它的冷却和你完全一样。',
    introStart: '开始对战',
    controlsNote: `<b>WASD / 方向键</b> 移动 · <b>J</b> 普攻（距离 ≤ 2）· <b>K</b> 爆发
      （1.5×，10 s）· <b>L</b> 护盾（吸收 20）· <b>空格</b> 向敌方冲刺 · <b>R</b> 重开。
      触屏：用上方方向键和技能按钮。`,
    agentNote: `对手与服务端是同一份代码，所以这也是在
      <a href="https://github.com/bscbai/token-wars/blob/main/token-wars/docs/agent-quickstart.md">写自己的 agent</a>
      之前，最快感受 bot 对手的方式。`,
    footerMatches: '录制对局',
    footerAgent: '写个 agent',
    footerBenchmark: '基准测试 v0',
    footerProtocol: 'Bot 协议',
    padAria: '方向',
    up: '上',
    left: '左',
    down: '下',
    right: '右',
    resultWin: '你赢了',
    resultLoss: 'GATEKEEPER 获胜',
    resultDraw: '平局',
    resultCtaWin: '再去沙盒挑战策略 →',
    resultCtaLoss: '用代码打败它——写个 bot →',
    resultCtaDraw: '去沙盒写个 bot →',
    hintAttack: '普攻需要距离 ≤ 2',
    hintBurst: '爆发需要距离 ≤ 2',
    shareCopied: '战绩已复制——可以直接发到 Discord、X 或 PR。',
    sharePrompt: '复制此战绩',
    dailyTitle: '每日挑战',
    dailyNone: '今日未挑战',
    dailyLoss: '✗ 今日未通过',
    dailyDraw: '＝ 今日平局',
    mut_blitz: '极速 60 秒',
    mut_glass: '玻璃 60 血',
    mut_guarded: '对手带盾',
    mut_fierce: '狂暴 AI',
    mut_fragile: '脆弱：你只有 60 血',
  },
};

function initialLang() {
  const q = new URLSearchParams(location.search).get('lang');
  if (q === 'zh' || q === 'en') return q;
  try {
    const stored = localStorage.getItem('tw-play-lang');
    if (stored === 'zh' || stored === 'en') return stored;
  } catch { /* 隐私模式忽略 */ }
  return (navigator.language || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

let lang = initialLang();
const t = (key) => (I18N[lang] && I18N[lang][key]) || I18N.en[key] || key;

const FMT = {
  en: {
    recordLine: (r) => `Record ${r.wins}W–${r.losses}L${r.draws ? `–${r.draws}D` : ''}`
      + ` · streak ${r.streak} (best ${r.bestStreak})`
      + (r.best ? ` · fastest ${r.best}s` : ''),
    resultStats: (o) => `${o.time}s · ${o.wins}W–${o.losses}L${o.draws ? `–${o.draws}D` : ''}`
      + (o.newBest ? ' · NEW BEST' : ''),
    mapRecord: (r) => `${r.wins}W–${r.losses}L${r.draws ? `–${r.draws}D` : ''}`,
    dailyWin: (s) => `✓ ${s}s today`,
    dailyTries: (n) => ` · ${n} ${n === 1 ? 'try' : 'tries'}`,
    shareText: (o) => {
      const score = `${o.wins}W–${o.losses}L${o.draws ? `–${o.draws}D` : ''}`;
      const line = o.result === 'win'
        ? `I beat the Token Wars gatekeeper in ${o.time}s — ${score}, streak ${o.streak}.`
        : o.result === 'loss'
          ? `The Token Wars gatekeeper got me in ${o.time}s — ${score}.`
          : `Draw with the Token Wars gatekeeper at ${o.time}s — ${score}.`;
      const daily = o.daily
        ? `Token Wars Daily #${o.daily.number} (${o.daily.map} · ${o.daily.mut}).\n`
        : '';
      return `${daily}${line}\nPlay free in your browser: ${PLAY_URL}\nWrite your own bot: ${SANDBOX_URL}`;
    },
  },
  zh: {
    recordLine: (r) => `战绩 ${r.wins}胜–${r.losses}负${r.draws ? `–${r.draws}平` : ''}`
      + ` · 连胜 ${r.streak}（最高 ${r.bestStreak}）`
      + (r.best ? ` · 最快 ${r.best}秒` : ''),
    resultStats: (o) => `${o.time}秒 · ${o.wins}胜–${o.losses}负${o.draws ? `–${o.draws}平` : ''}`
      + (o.newBest ? ' · 新纪录' : ''),
    mapRecord: (r) => `${r.wins}胜${r.losses}负${r.draws ? `${r.draws}平` : ''}`,
    dailyWin: (s) => `✓ 今日 ${s} 秒`,
    dailyTries: (n) => ` · ${n} 次`,
    shareText: (o) => {
      const score = `${o.wins}胜–${o.losses}负${o.draws ? `–${o.draws}平` : ''}`;
      const line = o.result === 'win'
        ? `我在 Token Wars 里 ${o.time} 秒击败了守门 AI——${score}，连胜 ${o.streak}。`
        : o.result === 'loss'
          ? `Token Wars 守门 AI 在 ${o.time} 秒内放倒了我——${score}。`
          : `和 Token Wars 守门 AI 打成平局（${o.time} 秒）——${score}。`;
      const daily = o.daily
        ? `Token Wars 每日挑战 #${o.daily.number}（${o.daily.map} · ${o.daily.mut}）。\n`
        : '';
      return `${daily}${line}\n浏览器免费试玩：${PLAY_URL}\n自己写 bot：${SANDBOX_URL}`;
    },
  },
};
const f = (key, ...args) => (FMT[lang][key] || FMT.en[key])(...args);

const PLAY_URL = 'https://bscbai.github.io/token-wars/play.html';
const SANDBOX_URL = 'https://bscbai.github.io/token-wars/sandbox.html';

const RECORD_KEY = 'tw-play-record-v1';
const defaultRecord = () => ({
  wins: 0, losses: 0, draws: 0, streak: 0, bestStreak: 0, bestWinMs: null, byMap: {}, daily: {},
});

function loadRecord() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECORD_KEY));
    if (parsed && typeof parsed.wins === 'number') {
      const merged = { ...defaultRecord(), ...parsed };
      if (!merged.byMap || typeof merged.byMap !== 'object') merged.byMap = {};
      if (!merged.daily || typeof merged.daily !== 'object') merged.daily = {};
      return merged;
    }
  } catch { /* 隐私模式/损坏数据 */ }
  return defaultRecord();
}

function saveRecord() {
  try { localStorage.setItem(RECORD_KEY, JSON.stringify(record)); } catch { /* 隐私模式忽略 */ }
}

let record = loadRecord();
let lastOutcome = null;
const secs = (ms) => (ms / 1000).toFixed(1);

function updateRecordLine() {
  if (!ui.record) return;
  ui.record.textContent = f('recordLine', {
    ...record,
    best: record.bestWinMs ? secs(record.bestWinMs) : null,
  });
}

function updateMapRecord() {
  if (!ui.mapRecord) return;
  ui.mapRecord.textContent = f('mapRecord', record.byMap[MAP.id] || { wins: 0, losses: 0, draws: 0 });
}

function renderDaily() {
  if (!ui.daily) return;
  const info = dailyInfo();
  const rec = record.daily[info.key];
  ui.daily.textContent = `${t('dailyTitle')} #${info.number} · ${mapNameOf(info.map)}`
    + ` · ${t(`mut_${info.mutator.id}`)}`;
  ui.daily.classList.toggle('active', !!dailyMode && dailyMode.key === info.key);
  if (!rec) {
    ui.dailyStatus.textContent = t('dailyNone');
    return;
  }
  const tries = f('dailyTries', rec.played);
  if (rec.won > 0) ui.dailyStatus.textContent = f('dailyWin', secs(rec.bestMs)) + tries;
  else if (rec.drawn > 0) ui.dailyStatus.textContent = t('dailyDraw') + tries;
  else ui.dailyStatus.textContent = t('dailyLoss') + tries;
}

function startDaily() {
  dailyMode = dailyInfo();
  MAP = dailyMode.map;
  populateMaps();
  reset();
}

function pruneDaily() {
  const keys = Object.keys(record.daily).sort();
  while (keys.length > 14) delete record.daily[keys.shift()];
}

function applyDailyRules() {
  matchMaxMs = MATCH_MAX_MS;
  if (!dailyMode) return;
  const m = dailyMode.mutator;
  if (m.maxMs) matchMaxMs = m.maxMs;
  if (m.hp) {
    you.maxHp = m.hp; you.hp = m.hp;
    enemy.maxHp = m.hp; enemy.hp = m.hp;
  }
  if (m.youHp) { you.maxHp = m.youHp; you.hp = m.youHp; }
  if (m.enemyShield) enemy.enableShield(enemy.shieldMax);
  if (m.enemyAtkMult) enemy.baseAtk = Math.round(enemy.baseAtk * m.enemyAtkMult);
}

// 首访操作说明：暂停比赛，关掉后继续；之后可从页脚「操作说明」再打开
const INTRO_KEY = 'tw-play-intro-v1';
function introSeen() {
  try { return localStorage.getItem(INTRO_KEY) === '1'; } catch { return true; }
}

function openIntro() {
  if (!ui.intro) return;
  stop();
  ui.intro.hidden = false;
}

function closeIntro() {
  try { localStorage.setItem(INTRO_KEY, '1'); } catch { /* 隐私模式忽略 */ }
  ui.intro.hidden = true;
  if (!ended) {
    running = true;
    start();
  }
}

const ui = {};
let you = null;
let enemy = null;
let running = false;
let ended = false;
let timer = null;
let elapsed = 0;
let held = new Set();
let lastResult = null;
let dailyMode = null;
let matchMaxMs = MATCH_MAX_MS;

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

const mapNameOf = (m) => (lang === 'zh' ? m.name : (MAP_EN[m.id] || m.id));

function populateMaps() {
  if (!ui.mapSelect) return;
  ui.mapSelect.innerHTML = '';
  for (const m of MAP_LIST) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = mapNameOf(m);
    opt.selected = m.id === MAP.id;
    ui.mapSelect.appendChild(opt);
  }
}

function selectMap(id) {
  const next = MAP_LIST.find((m) => m.id === id);
  if (!next || next.id === MAP.id) return;
  MAP = next;
  dailyMode = null;
  try { localStorage.setItem(MAP_KEY, MAP.id); } catch { /* 隐私模式忽略 */ }
  reset();
}

function reset() {
  stop();
  freshAgents();
  applyDailyRules();
  elapsed = 0;
  ended = false;
  running = true;
  lastResult = null;
  lastOutcome = null;
  ui.share.hidden = true;
  ui.resultCta.hidden = true;
  ui.resultText.textContent = '';
  ui.resultStats.textContent = '';
  ui.result.classList.remove('show');
  start();
  draw();
  updateHud();
  updateRecordLine();
  updateMapRecord();
  renderDaily();
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
  if (dist(you, enemy) > 2) return flashHint('hintAttack');
  if (you.skillOnCooldown('basic_attack', now)) return;
  you.useSkill('basic_attack', now, 1);
  const dmg = rollArenaDamage(you.atk, 1.0, enemy.def);
  enemy.takeDamage(dmg, you.id);
  draw();
  updateHud();
}

function tryBurst(now) {
  if (!running || ended) return;
  if (dist(you, enemy) > 2) return flashHint('hintBurst');
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
function flashHint(key) {
  ui.hint.textContent = t(key);
  if (hintTimer) clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { ui.hint.textContent = ''; }, 1200);
}

async function shareMatch() {
  const daily = lastOutcome.daily
    ? {
      number: lastOutcome.daily.number,
      map: mapNameOf(MAP_LIST.find((m) => m.id === lastOutcome.daily.mapId) || MAP),
      mut: t(`mut_${lastOutcome.daily.mutId}`),
    }
    : null;
  const text = f('shareText', {
    result: lastResult,
    time: secs(lastOutcome.ms),
    ...lastOutcome.record,
    daily,
  });
  try {
    await navigator.clipboard.writeText(text);
    flashHint('shareCopied');
  } catch {
    window.prompt(t('sharePrompt'), text);
  }
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
  if (elapsed >= matchMaxMs) finish('draw');
}

function finish(result) {
  ended = true;
  running = false;
  stop();
  const ms = elapsed;
  const prevBest = record.bestWinMs;
  if (result === 'win') {
    record.wins++;
    record.streak++;
    record.bestStreak = Math.max(record.bestStreak, record.streak);
    if (!record.bestWinMs || ms < record.bestWinMs) record.bestWinMs = ms;
  } else if (result === 'loss') {
    record.losses++;
    record.streak = 0;
  } else {
    record.draws++;
  }
  const bucket = record.byMap[MAP.id] || { wins: 0, losses: 0, draws: 0, bestWinMs: null };
  if (result === 'win') {
    bucket.wins++;
    if (!bucket.bestWinMs || ms < bucket.bestWinMs) bucket.bestWinMs = ms;
  } else if (result === 'loss') {
    bucket.losses++;
  } else {
    bucket.draws++;
  }
  record.byMap[MAP.id] = bucket;
  if (dailyMode) {
    const d = record.daily[dailyMode.key]
      || { played: 0, won: 0, lost: 0, drawn: 0, bestMs: null };
    d.played++;
    if (result === 'win') {
      d.won++;
      if (!d.bestMs || ms < d.bestMs) d.bestMs = ms;
    } else if (result === 'loss') d.lost++;
    else d.drawn++;
    record.daily[dailyMode.key] = d;
    pruneDaily();
  }
  saveRecord();
  lastResult = result;
  lastOutcome = {
    ms,
    newBest: result === 'win' && (!prevBest || ms < prevBest),
    record: { ...record },
    daily: dailyMode
      ? { number: dailyMode.number, mapId: dailyMode.map.id, mutId: dailyMode.mutator.id }
      : null,
  };
  renderResult();
  updateRecordLine();
  updateMapRecord();
  renderDaily();
  updateHud();
  ui.share.hidden = false;
}

function renderResult() {
  if (!lastResult) return;
  const key = lastResult === 'win' ? 'resultWin' : (lastResult === 'loss' ? 'resultLoss' : 'resultDraw');
  ui.resultText.textContent = t(key);
  ui.resultStats.textContent = lastOutcome
    ? f('resultStats', {
      time: secs(lastOutcome.ms),
      ...lastOutcome.record,
      newBest: lastOutcome.newBest,
    })
    : '';
  const ctaKey = lastResult === 'win' ? 'resultCtaWin'
    : (lastResult === 'loss' ? 'resultCtaLoss' : 'resultCtaDraw');
  ui.resultCta.textContent = t(ctaKey);
  ui.resultCta.href = `./sandbox.html?lang=${lang}`;
  ui.resultCta.hidden = false;
  ui.result.classList.add('show');
  ui.result.dataset.result = lastResult;
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
  if (!you) return;
  ui.hpYou.textContent = `${pct(you)}`;
  ui.hpEnemy.textContent = `${pct(enemy)}`;
  ui.barYou.style.width = `${pct(you)}%`;
  ui.barEnemy.style.width = `${pct(enemy)}%`;
  // 血条同时作为无障碍 progressbar：最大值会随每日挑战（如 60 血）变化
  ui.trackYou.setAttribute('aria-valuemax', you.maxHp);
  ui.trackYou.setAttribute('aria-valuenow', you.hp);
  ui.trackYou.setAttribute('aria-label', t('hpAriaYou'));
  ui.trackEnemy.setAttribute('aria-valuemax', enemy.maxHp);
  ui.trackEnemy.setAttribute('aria-valuenow', enemy.hp);
  ui.trackEnemy.setAttribute('aria-label', t('hpAriaEnemy'));
  ui.clock.textContent = formatClock(Math.max(0, matchMaxMs - elapsed));
  const now = performance.now();
  const pill = (el, id, label) => {
    const ready = !you.skillOnCooldown(id, now);
    el.textContent = label;
    el.classList.toggle('ready', ready);
  };
  pill(ui.skillAttack, 'basic_attack', t('skillAttack'));
  pill(ui.skillBurst, 'token_burst', t('skillBurst'));
  pill(ui.skillShield, 'shield', t('skillShield'));
  pill(ui.skillDash, 'dodge_roll', t('skillDash'));
  ui.shieldTag.textContent = you.shieldActive
    ? (lang === 'zh' ? `护盾 ${you.shield}` : `SHIELD ${you.shield}`)
    : '';
}

function formatClock(ms) {
  const s = Math.ceil(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function applyLang(next) {
  if (next === 'zh' || next === 'en') lang = next;
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
  ui.lang.textContent = lang === 'zh' ? 'EN' : '中文';
  ui.lang.setAttribute('aria-label', lang === 'zh' ? 'Switch to English' : '切换到中文');
  ui.hint.textContent = '';
  populateMaps();
  renderResult();
  updateRecordLine();
  updateMapRecord();
  renderDaily();
  updateHud();
}

// --- 输入 -------------------------------------------------------------------

function bindInput() {
  window.addEventListener('keydown', (e) => {
    if (ui.intro && !ui.intro.hidden) return;
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
  ui.share.addEventListener('click', shareMatch);
  ui.daily.addEventListener('click', startDaily);
  ui.howto.addEventListener('click', openIntro);
  ui.introStart.addEventListener('click', closeIntro);
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
    trackYou: $('trackYou'),
    trackEnemy: $('trackEnemy'),
    clock: $('clock'),
    result: $('result'),
    resultText: $('resultText'),
    resultStats: $('resultStats'),
    resultCta: $('resultCta'),
    record: $('record'),
    hint: $('hint'),
    shieldTag: $('shieldTag'),
    restart: $('restart'),
    share: $('share'),
    intro: $('intro'),
    introStart: $('introStart'),
    howto: $('howto'),
    skillAttack: $('skillAttack'),
    skillBurst: $('skillBurst'),
    skillShield: $('skillShield'),
    skillDash: $('skillDash'),
    lang: $('lang'),
    mapSelect: $('mapSelect'),
    mapRecord: $('mapRecord'),
    daily: $('daily'),
    dailyStatus: $('dailyStatus'),
    padUp: $('padUp'),
    padDown: $('padDown'),
    padLeft: $('padLeft'),
    padRight: $('padRight'),
  });
  bindInput();
  ui.lang.addEventListener('click', () => {
    const next = lang === 'zh' ? 'en' : 'zh';
    try { localStorage.setItem('tw-play-lang', next); } catch { /* 隐私模式忽略 */ }
    applyLang(next);
  });
  try {
    const storedMap = localStorage.getItem(MAP_KEY);
    if (storedMap) MAP = MAP_LIST.find((m) => m.id === storedMap) || MAP;
  } catch { /* 隐私模式忽略 */ }
  populateMaps();
  ui.mapSelect.addEventListener('change', () => selectMap(ui.mapSelect.value));

  const firstVisit = !introSeen();
  reset();
  applyLang();
  updateRecordLine();
  if (firstVisit) openIntro();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
