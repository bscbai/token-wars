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
const { simulateMatches, simulateMatchesBetween, simulateDuel } = require('../../server/game/agentSimulator');
const { AI_MAPS } = require('../../shared/arenaMaps');
const { renderAgentSource } = require('../../shared/agentTemplate');

const TICK_MS = 50;
const MATCH_MAX_MS = 120000;
const DECISION_DEADLINE_MS = 500;
const TIMEOUT_LIMIT = 3;
const VIOLATION_LIMIT = 10;
const CELL = 24;
const MAP = AI_MAPS.DATA_MINE;
const MAP_LIST = Object.values(AI_MAPS);
const { dailyInfo } = require('../../shared/dailyChallenge');
const DAILY_RULE_KEYS = ['maxMs', 'hp', 'youHp', 'enemyShield', 'enemyAtkMult'];

function dailyRules(mutator) {
  const rules = {};
  for (const key of DAILY_RULE_KEYS) {
    if (mutator[key] !== undefined) rules[key] = mutator[key];
  }
  return rules;
}
let selectedMap = MAP;
const mapNameOf = (m) => (lang === 'zh' ? m.name : (m.nameEn || m.id));
const mapLabel = () => mapNameOf(selectedMap);
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
  if (go) return go;
  // 被墙挡死时先纵向绕行（例如正中心有障碍的地图）
  const side = me.y > 0 ? -1 : 1;
  return step(0, side) || step(0, -side) || { type: 'idle' };
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
  // 被墙挡死时纵向绕行，避免在正中心障碍前卡死
  const side = me.y > 0 ? -1 : 1;
  for (const sy of [side, -side]) {
    const y = me.y + sy;
    if (y < 0 || y >= state.map.height) continue;
    if (blocked.has(me.x + ',' + y)) continue;
    return { type: 'move', x: me.x, y };
  }
  return { type: 'idle' };
}`;

const PRESETS = [
  { id: 'balanced', label: 'Balanced (chase + burst + shield)', labelZh: '均衡型（追击 + 爆发 + 护盾）', code: SAMPLE_BALANCED },
  { id: 'turtle', label: 'Shield first (turtle)', labelZh: '先盾型（龟缩换血）', code: SAMPLE_TURTLE },
];

// --- 文案（英文为默认，中文用于 ?lang=zh / 浏览器语言 / 手动切换） -------------

const I18N = {
  en: {
    subtitle: 'Write <code>decide(state)</code>, fight the arena\'s built-in AI — locally, in this tab.',
    banner: `Real rules: protocol validation, cooldowns, shield drain and damage rolls come from the same
      modules the server uses. Parity limits apply too — 500&nbsp;ms decision deadline,
      3 consecutive timeouts or &gt;10 invalid actions = loss, 120&nbsp;s draw.
      Your code never leaves the browser. <a href="./play.html">Prefer to play yourself? →</a>`,
    liveMatch: 'Live match',
    yourAgent: 'YOUR AGENT',
    yourPolicy: 'Your policy',
    presetAria: 'preset',
    mapLabel: 'Simulate / Duel map',
    editorAria: 'agent code',
    run: 'Run (Ctrl+Enter)',
    stop: 'Stop',
    reset: 'Reset',
    share: 'Copy share link',
    download: 'Download Node bot',
    simulate: 'Simulate 50',
    simAll: 'Simulate all 5 maps',
    simulatingAll: 'Simulating all 5 maps (20 matches each)…',
    shareImage: 'Share image',
    shareDuelImage: 'Share duel card',
    duelCardTitle: 'BOT DUEL',
    duelWin: 'YOU WIN THE DUEL',
    duelLoss: 'OPPONENT WINS',
    duelDraw: 'DUEL DRAW',
    duelYou: 'Your policy',
    duelThem: "Friend's policy",
    duelCardTagline: 'decide(state) vs decide(state) — offline, in one tab',
    watchDuel: 'Watch one duel',
    replayPlay: 'Play',
    replayPause: 'Pause',
    dailyRun: 'Daily challenge',
    dailyRunning: "Running today's challenge (50 matches)…",
    cardSaved: 'Card saved — post it anywhere.',
    cardShared: 'Card shared.',
    benchTitle: 'BOT BENCHMARK',
    benchTagline: 'decide(state) — the same protocol as the live arena',
    benchWin: 'win rate',
    benchYou: 'Your bot',
    benchBase: 'Balanced preset',
    llmPrompt: 'Copy LLM prompt',
    llmCopied: 'Prompt copied — paste it into ChatGPT/Claude, then paste the code back here.',
    fencesStripped: 'Markdown fences removed — the code inside was used.',
    api: `<b>state</b>: <code>{ tick, timeLeftMs, you:{ x,y,hp,maxHp,shield,shieldActive,skills[{id,cooldownRemaining}] }, enemy:{ x,y,hp,maxHp,visible }, map:{ width,height,obstacles } }</code><br>
      <b>return</b>: <code>{type:'move',x,y}</code> · <code>{type:'attack'}</code> ·
      <code>{type:'skill',id:'token_burst'|'dodge_roll'|'shield'}</code> ·
      <code>{type:'shield'}</code> · <code>{type:'idle'}</code><br>
      Note: in a real match the server streams this state at 20&nbsp;Hz and your process has
      500&nbsp;ms per decision; here everything runs synchronously in one tab.
      <b>Copy share link</b> encodes your policy in the URL (nothing is stored);
      <b>Download Node bot</b> gives you a runnable competitor for a real arena;
      <b>Simulate 50</b> runs the same rules headlessly and reports win rate,
      invalid actions, timeouts and decision time — tune the policy, then export.
      <b>Copy LLM prompt</b> copies this whole spec, so you can ask ChatGPT or Claude for a policy and paste the code back.`,
    duelTitle: 'Duel another policy (50 matches)',
    duelNote: `Paste a friend's share link — a solo link (<code>#code=…</code>) or a duel
      link — to load their policy, then duel offline. Nothing is uploaded.
      <b>Copy result</b> gives a postable summary plus the duel link.`,
    duelPlaceholder: 'https://bscbai.github.io/token-wars/sandbox.html#code=…',
    load: 'Load',
    copyDuelLink: 'Copy duel link',
    opponentAria: 'opponent code',
    duelRun: 'Duel 50',
    duelAll: 'Duel all 5 maps',
    duelingAll: 'Dueling all 5 maps (20 matches each)…',
    copyResult: 'Copy result',
    footerPlay: 'Play as a human',
    footerDaily: 'Daily challenge',
    footerMatches: 'Recorded matches',
    footerQuickstart: '5-minute quickstart',
    footerProtocol: 'Bot protocol',
    traceTitle: 'Decision trace',
    traceDownload: 'Download trace JSON',
    traceEmpty: 'Run a match to record decisions.',
    traceDownloaded: 'Trace downloaded — map, policy, result and per-tick HP.',
    resultWin: 'YOUR AGENT WINS',
    resultLoss: 'GATEKEEPER WINS',
    resultDraw: 'DRAW',
    reasonTimeouts: '3 consecutive decision timeouts',
    reasonInvalid: 'more than 10 invalid actions',
    reasonHp: 'hp reached 0',
    reasonBoth: 'both agents died on the same tick',
    reasonLimit: '120 s match limit',
    reasonThrew: 'your decide() threw',
    reasonStopped: 'stopped',
    decideMissing: 'Define a function named decide(state).',
    shareTooLarge: 'Policy too large for a link — use Download instead.',
    shareCopied: 'Share link copied — it opens this policy and runs it.',
    copyLinkPrompt: 'Copy this link',
    downloaded: 'Downloaded token-wars-agent.js — run it with BOT_TOKEN=… node token-wars-agent.js',
    simulating: 'Simulating 50 matches…',
    decodeFail: 'Could not decode an opponent policy from that link.',
    opponentLoaded: 'Opponent loaded — click "Duel 50".',
    bothLoaded: 'Both policies loaded from the link — click "Duel 50".',
    duelLinkCopied: 'Duel link copied — it opens both policies.',
    copyDuelPrompt: 'Copy this duel link',
    needDuel: 'Run a duel first — then this copies a postable result.',
    dueling: 'Dueling 50 matches…',
    resultCopied: 'Result copied — paste it in Discord, X or a PR.',
    copyResultPrompt: 'Copy this result',
    loadedShare: 'Loaded a shared policy from the link.',
  },
  zh: {
    subtitle: '编写 <code>decide(state)</code>，与竞技场内置 AI 对战——全部在本标签页本地运行。',
    banner: `真实规则：协议校验、冷却、护盾消耗与伤害掷骰都复用服务端同一套模块。
      同样执行 parity 限制——500&nbsp;ms 决策截止、连续 3 次超时或 &gt;10 次非法动作判负、
      120&nbsp;s 平局。你的代码不会离开浏览器。
      <a href="./play.html">想亲自上场？→</a>`,
    liveMatch: '实时对局',
    yourAgent: '你的 AGENT',
    yourPolicy: '你的策略',
    presetAria: '预设策略',
    mapLabel: '模拟 / 对战地图',
    editorAria: 'agent 代码',
    run: '运行 (Ctrl+Enter)',
    stop: '停止',
    reset: '重置',
    share: '复制分享链接',
    download: '下载 Node bot',
    simulate: '模拟 50 场',
    simAll: '模拟五张地图',
    simulatingAll: '正在模拟五张地图（各 20 场）…',
    shareImage: '生成基准图',
    shareDuelImage: '生成对战图',
    duelCardTitle: 'BOT 对战',
    duelWin: '你赢下对战',
    duelLoss: '对手获胜',
    duelDraw: '对战平局',
    duelYou: '你的策略',
    duelThem: '对方策略',
    duelCardTagline: 'decide(state) vs decide(state) —— 离线单页对战',
    watchDuel: '看一场对战',
    replayPlay: '播放',
    replayPause: '暂停',
    dailyRun: '每日挑战',
    dailyRunning: '正在跑今日挑战（50 场）…',
    cardSaved: '基准图已保存，可直接发帖。',
    cardShared: '基准图已分享。',
    benchTitle: 'BOT 基准',
    benchTagline: 'decide(state) —— 与线上竞技场同一套协议',
    benchWin: '胜率',
    benchYou: '你的策略',
    benchBase: '均衡预设',
    llmPrompt: '复制 LLM 提示词',
    llmCopied: '提示词已复制——粘到 ChatGPT/Claude，再把生成的代码粘回编辑器。',
    fencesStripped: '已自动去掉 Markdown 代码围栏，直接使用其中的代码。',
    api: `<b>state</b>：<code>{ tick, timeLeftMs, you:{ x,y,hp,maxHp,shield,shieldActive,skills[{id,cooldownRemaining}] }, enemy:{ x,y,hp,maxHp,visible }, map:{ width,height,obstacles } }</code><br>
      <b>返回</b>：<code>{type:'move',x,y}</code> · <code>{type:'attack'}</code> ·
      <code>{type:'skill',id:'token_burst'|'dodge_roll'|'shield'}</code> ·
      <code>{type:'shield'}</code> · <code>{type:'idle'}</code><br>
      说明：真实对局中服务端以 20&nbsp;Hz 推送该 state，每个决策限时 500&nbsp;ms；
      这里全部在一个标签页内同步执行。
      <b>复制分享链接</b> 会把策略编码进 URL（不存储任何内容）；
      <b>下载 Node bot</b> 生成可直接参赛的脚本；
      <b>模拟 50 场</b> 用同一套规则无渲染跑 50 场，报告胜率、非法动作、超时与决策耗时——调好再导出。
      <b>复制 LLM 提示词</b> 会把整套说明复制走，可直接让 ChatGPT / Claude 写策略，再把代码粘回来。`,
    duelTitle: '与其他策略对战（50 场）',
    duelNote: `粘贴朋友的分享链接——单策略链接（<code>#code=…</code>）或对战链接——载入对方策略后离线对战，
      不上传任何内容。<b>复制战绩</b> 生成可直接发帖的摘要和链接。`,
    duelPlaceholder: 'https://bscbai.github.io/token-wars/sandbox.html#code=…',
    load: '载入',
    copyDuelLink: '复制对战链接',
    opponentAria: '对手代码',
    duelRun: '对战 50 场',
    duelAll: '全地图对战',
    duelingAll: '正在跑 5 张地图（每图 20 场）…',
    copyResult: '复制战绩',
    footerPlay: '亲自试玩',
    footerDaily: '每日挑战',
    footerMatches: '录制对局',
    footerQuickstart: '5 分钟上手',
    footerProtocol: 'Bot 协议',
    traceTitle: '决策轨迹',
    traceDownload: '下载轨迹 JSON',
    traceEmpty: '跑一场对局后这里会记录决策。',
    traceDownloaded: '轨迹已下载——包含地图、策略、结果与逐 tick 血量。',
    resultWin: '你的 AGENT 获胜',
    resultLoss: 'GATEKEEPER 获胜',
    resultDraw: '平局',
    reasonTimeouts: '连续 3 次决策超时',
    reasonInvalid: '非法动作超过 10 次',
    reasonHp: '血量归零',
    reasonBoth: '双方在同一 tick 阵亡',
    reasonLimit: '达到 120 秒上限',
    reasonThrew: '你的 decide() 抛错',
    reasonStopped: '已停止',
    decideMissing: '请定义名为 decide(state) 的函数。',
    shareTooLarge: '策略太大，无法放入链接——请改用下载。',
    shareCopied: '分享链接已复制——打开即可载入并运行该策略。',
    copyLinkPrompt: '复制此链接',
    downloaded: '已下载 token-wars-agent.js——用 BOT_TOKEN=… node token-wars-agent.js 运行',
    simulating: '正在模拟 50 场…',
    decodeFail: '无法从该链接解析出对手策略。',
    opponentLoaded: '对手已载入——点击“对战 50 场”。',
    bothLoaded: '已从链接载入双方策略——点击“对战 50 场”。',
    duelLinkCopied: '对战链接已复制——打开即可载入双方策略。',
    copyDuelPrompt: '复制此对战链接',
    needDuel: '先跑一场对战，再复制战绩。',
    dueling: '正在对战 50 场…',
    resultCopied: '战绩已复制——可粘贴到 Discord、X 或 PR。',
    copyResultPrompt: '复制此战绩',
    loadedShare: '已从链接载入分享的策略。',
  },
};

const FMT = {
  en: {
    compileError: (m) => `Compile error: ${m}`,
    decideThrew: (m) => `decide() threw: ${m}`,
    timeoutAction: (ms) => `idle(timeout ${Math.round(ms)}ms)`,
    simResult: (o, map) => `${o.matches} matches: ${o.wins}W / ${o.losses}L / ${o.draws}D`
      + ` (${o.winRate}% win) · avg ${o.avgTicks} ticks`
      + ` · invalid ${o.invalid} · timeouts ${o.timeouts}`
      + ` · decision avg ${o.avgDecisionMs}ms / max ${o.maxDecisionMs}ms`
      + ` · map ${map} · ${o.wallMs}ms wall`,
    simBaseline: (o) => ` · balanced preset ${o.winRate}% win for reference`,
    simAllHeader: (t) => `${t.matches} matches vs the gatekeeper (20 per map):`
      + ` ${t.wins}W / ${t.losses}L / ${t.draws}D`,
    simAllRow: (map, o) => ` · ${map}: ${o.wins}W / ${o.losses}L (${o.winRate}%)`,
    dailyPrefix: (n, map, mut) => `Daily #${n} · ${map} · ${mut}`,
    duelCardSub: (n, map) => `${n} headless matches · ${map}`,
    duelCardRecord: (o) => `you ${o.aWins}W · them ${o.bWins}W · ${o.draws}D`,
    duelCardStats: (o) => `avg ${o.avgTicks} ticks · invalid ${o.aInvalid} vs ${o.bInvalid}`
      + ` · timeouts ${o.aTimeouts} vs ${o.bTimeouts}`,
    replayTick: (t, n, a, b) => `tick ${t}/${n} · HP ${a} : ${b}`,
    benchSubSingle: (n, map) => `${n} matches vs the Gatekeeper · ${map}`,
    benchSubAll: (n) => `${n} matches vs the Gatekeeper · all 5 maps`,
    benchRecord: (o) => `${o.wins}W–${o.losses}L–${o.draws}D`,
    benchStats: (o) => `invalid ${o.invalid} · timeouts ${o.timeouts}`
      + ` · avg ${o.avgTicks} ticks · ${o.avgDecisionMs}ms / decision`,
    simFailed: (m) => `Simulation failed: ${m}`,
    duelResult: (o, map) => `Duel ${o.matches}: you ${o.aWins}W / them ${o.bWins}W / ${o.draws}D`
      + ` (${o.winRateA}% vs ${o.winRateB}%) · avg ${o.avgTicks} ticks`
      + ` · your invalid ${o.aInvalid} / timeouts ${o.aTimeouts}`
      + ` · their invalid ${o.bInvalid} / timeouts ${o.bTimeouts}`
      + ` · map ${map} · ${o.wallMs}ms`,
    duelFailed: (m) => `Duel failed: ${m}`,
    duelPost: (o, url, map) => `Token Wars duel — 50 headless matches, my decide(state) vs a friend's:`
      + ` you ${o.aWins}W / them ${o.bWins}W / ${o.draws}D`
      + ` (${o.winRateA}% vs ${o.winRateB}%), avg ${o.avgTicks} ticks on ${map}.`
      + (url ? ` Beat it: ${url}` : ''),
    duelAllStats: (o) => `${o.aWins}W / ${o.bWins}W / ${o.draws}D · ${o.winRateA}%`,
    duelAllSummary: (o) => `${o.matches} matches: you ${o.aWins}W / them ${o.bWins}W / ${o.draws}D`
      + ` (${o.winRateA}% vs ${o.winRateB}%) · ${o.wallMs}ms`,
    duelAllFailed: (m) => `All-map duel failed: ${m}`,
    stats: (o) => `tick ${o.tick} · decisions ${o.decisions} · invalid ${o.invalid}`
      + ` · timeouts ${o.timeouts} · avg ${o.avg}ms (max ${o.max}ms)`,
    lastAction: (label) => `last action: ${label}`,
    shield: (n) => `SHIELD ${n}`,
    traceSummary: (o) => `${o.ticks} ticks · invalid ${o.invalid} · timeouts ${o.timeouts}`,
  },
  zh: {
    compileError: (m) => `编译错误：${m}`,
    decideThrew: (m) => `decide() 抛错：${m}`,
    timeoutAction: (ms) => `idle(超时 ${Math.round(ms)}ms)`,
    simResult: (o, map) => `${o.matches} 场：${o.wins}胜 / ${o.losses}负 / ${o.draws}平`
      + `（胜率 ${o.winRate}%）· 平均 ${o.avgTicks} tick`
      + ` · 非法 ${o.invalid} · 超时 ${o.timeouts}`
      + ` · 决策 平均 ${o.avgDecisionMs}ms / 最大 ${o.maxDecisionMs}ms`
      + ` · 地图 ${map} · 总耗时 ${o.wallMs}ms`,
    simBaseline: (o) => ` · 参考：均衡预设胜率 ${o.winRate}%`,
    simAllHeader: (t) => `${t.matches} 场对守门 AI（每图 20 场）：`
      + `${t.wins}胜 / ${t.losses}负 / ${t.draws}平`,
    simAllRow: (map, o) => ` · ${map}：${o.wins}胜 ${o.losses}负（${o.winRate}%）`,
    dailyPrefix: (n, map, mut) => `每日挑战 #${n} · ${map} · ${mut}`,
    duelCardSub: (n, map) => `${n} 场无渲染对局 · ${map}`,
    duelCardRecord: (o) => `你 ${o.aWins}胜 · 对方 ${o.bWins}胜 · ${o.draws}平`,
    duelCardStats: (o) => `平均 ${o.avgTicks} tick · 非法 ${o.aInvalid} vs ${o.bInvalid}`
      + ` · 超时 ${o.aTimeouts} vs ${o.bTimeouts}`,
    replayTick: (t, n, a, b) => `tick ${t}/${n} · 血量 ${a} : ${b}`,
    benchSubSingle: (n, map) => `对守门 AI ${n} 场 · ${map}`,
    benchSubAll: (n) => `对守门 AI ${n} 场 · 五张地图`,
    benchRecord: (o) => `${o.wins}胜 ${o.losses}负 ${o.draws}平`,
    benchStats: (o) => `非法 ${o.invalid} · 超时 ${o.timeouts}`
      + ` · 平均 ${o.avgTicks} tick · 决策 ${o.avgDecisionMs}ms`,
    simFailed: (m) => `模拟失败：${m}`,
    duelResult: (o, map) => `对战 ${o.matches} 场：你 ${o.aWins}胜 / 对方 ${o.bWins}胜 / ${o.draws}平`
      + `（${o.winRateA}% vs ${o.winRateB}%）· 平均 ${o.avgTicks} tick`
      + ` · 你 非法 ${o.aInvalid} / 超时 ${o.aTimeouts}`
      + ` · 对方 非法 ${o.bInvalid} / 超时 ${o.bTimeouts}`
      + ` · 地图 ${map} · 总耗时 ${o.wallMs}ms`,
    duelFailed: (m) => `对战失败：${m}`,
    duelPost: (o, url, map) => `Token Wars 对战——50 场无渲染对局，我的 decide(state) vs 朋友的：`
      + ` 我 ${o.aWins}胜 / 对方 ${o.bWins}胜 / ${o.draws}平`
      + `（${o.winRateA}% vs ${o.winRateB}%），${map}，平均 ${o.avgTicks} tick。`
      + (url ? ` 来挑战：${url}` : ''),
    duelAllStats: (o) => `${o.aWins}胜 / ${o.bWins}胜 / ${o.draws}平 · ${o.winRateA}%`,
    duelAllSummary: (o) => `${o.matches} 场：你 ${o.aWins}胜 / 对方 ${o.bWins}胜 / ${o.draws}平`
      + `（${o.winRateA}% vs ${o.winRateB}%）· 总耗时 ${o.wallMs}ms`,
    duelAllFailed: (m) => `全地图对战失败：${m}`,
    stats: (o) => `tick ${o.tick} · 决策 ${o.decisions} · 非法 ${o.invalid}`
      + ` · 超时 ${o.timeouts} · 平均 ${o.avg}ms（最大 ${o.max}ms）`,
    lastAction: (label) => `最近动作：${label}`,
    shield: (n) => `护盾 ${n}`,
    traceSummary: (o) => `${o.ticks} tick · 非法 ${o.invalid} · 超时 ${o.timeouts}`,
  },
};

function initialLang() {
  const q = new URLSearchParams(location.search).get('lang');
  if (q === 'zh' || q === 'en') return q;
  try {
    const stored = localStorage.getItem('tw-sandbox-lang');
    if (stored === 'zh' || stored === 'en') return stored;
  } catch { /* 隐私模式忽略 */ }
  return (navigator.language || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

let lang = initialLang();
const t = (key) => (I18N[lang] && I18N[lang][key]) || I18N.en[key] || key;
const f = (key, ...args) => {
  const table = FMT[lang] || FMT.en;
  return (table[key] || FMT.en[key])(...args);
};

// 给 LLM 的提示词：把 state/动作/规则一次说清，生成结果可直接粘回编辑器
const LLM_PROMPTS = {
  en: `You are writing a competitive bot for Token Wars, a real-time 1v1 grid arena.

Output one JavaScript function and nothing else:

function decide(state) {
  // return exactly one action object
}

state fields:
- tick, timeLeftMs
- you:   { x, y, hp, maxHp, shield, shieldActive, skills: [{ id, cooldownRemaining }] }
- enemy: { x, y, hp, maxHp, visible }
- map:   { width, height, obstacles: [[x, y], ...] }

Return exactly one of:
- { type: 'move', x, y }  one orthogonal step, inside the map and not into an obstacle
- { type: 'attack' }  basic attack, only when Manhattan distance to the enemy is <= 2
- { type: 'skill', id: 'token_burst' }  burst, distance <= 2
- { type: 'skill', id: 'dodge_roll' }  dash up to 3 tiles toward the enemy
- { type: 'shield' }  absorb 20 damage (skill id 'shield' also works)
- { type: 'idle' }

Rules: 120 s match, 500 ms per decision, 3 consecutive timeouts or more than 10 invalid actions lose the match.
Read cooldownRemaining from state instead of hardcoding cooldowns. Keep decide() deterministic and side-effect free.

Strategy hints: hold distance 2 when attacking, burst whenever ready, shield before trading when hp is low,
dash to close gaps, and walk around obstacles.

Return only the function in a single code block.`,
  zh: `你在为一个实时 1v1 格子竞技游戏 Token Wars 写 bot。

只输出一个 JavaScript 函数，不要解释：

function decide(state) {
  // 返回一个动作对象
}

state 字段：
- tick, timeLeftMs
- you:   { x, y, hp, maxHp, shield, shieldActive, skills: [{ id, cooldownRemaining }] }
- enemy: { x, y, hp, maxHp, visible }
- map:   { width, height, obstacles: [[x, y], ...] }

返回且只返回一种：
- { type: 'move', x, y }  向相邻格移动一步，不能越界或进入障碍
- { type: 'attack' }  普攻，仅当与敌人的曼哈顿距离 <= 2
- { type: 'skill', id: 'token_burst' }  爆发，距离 <= 2
- { type: 'skill', id: 'dodge_roll' }  向敌人冲刺最多 3 格
- { type: 'shield' }  护盾吸收 20 点伤害（技能 id 'shield' 亦可）
- { type: 'idle' }

规则：单场 120 秒，每次决策限时 500ms；连续 3 次超时或累计超过 10 次非法动作判负。
冷却一律读 state 里的 cooldownRemaining，不要写死数值。decide() 必须确定性、无副作用。

策略建议：进攻时保持距离 2；爆发一好就用；血量低时先举盾再换血；用冲刺拉近距离；绕开障碍。

只返回单个代码块中的函数。`,
};
const llmPromptText = () => LLM_PROMPTS[lang] || LLM_PROMPTS.en;

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
let lastDuel = null;
let lastDuelMeta = null; // { mapId, mapName }，对战图用
let lastMulti = null;
let lastSim = null; // Simulate 50 / 五图结果，用于生成基准图
let duelReplay = null; // { frames, idx, timer, map, out }，「看一场对战」逐帧回放
let lastResult = null;
let lastReasonKey = null;
let trace = [];

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

// LLM 回复常带 ```js 围栏或前后说明：抽出第一个代码块再编译
function normalizePolicyCode(src) {
  const text = (src || '').trim();
  const fenced = text.match(/```[a-zA-Z0-9+#-]*[ \t]*\r?\n([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  return text.replace(/^```[a-zA-Z0-9+#-]*[ \t]*\r?\n?/, '').replace(/```[ \t]*$/, '').trim();
}

function compilePolicy(code = ui.editor.value) {
  const factory = new Function(`${normalizePolicyCode(code)}\n;return typeof decide === 'function' ? decide : null;`);
  const fn = factory();
  if (typeof fn !== 'function') throw new Error(t('decideMissing'));
  return fn;
}

function start() {
  stop();
  hideDuelReplay();
  lastError = '';
  ui.error.textContent = '';
  if (ui.shareStatus.textContent === t('fencesStripped')) ui.shareStatus.textContent = '';
  ui.result.classList.remove('show');
  ui.resultText.textContent = '';
  lastResult = null;
  lastReasonKey = null;
  trace = [];
  if (ui.traceList) {
    ui.traceList.innerHTML = '';
    ui.traceSummary.textContent = t('traceEmpty');
    ui.traceStatus.textContent = '';
  }
  ended = false;
  running = true;
  elapsed = 0;
  tick = 0;
  lastAction = '-';
  freshAgents();
  resetStats();
  try {
    policy = compilePolicy();
    if (normalizePolicyCode(ui.editor.value) !== ui.editor.value.trim()) {
      ui.shareStatus.textContent = t('fencesStripped');
    }
  } catch (err) {
    running = false;
    lastError = err.message;
    ui.error.textContent = f('compileError', err.message);
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

function renderOutcome() {
  if (!lastResult) return;
  const key = lastResult === 'win' ? 'resultWin' : (lastResult === 'loss' ? 'resultLoss' : 'resultDraw');
  ui.resultText.textContent = t(key);
  ui.result.dataset.result = lastResult;
  ui.result.classList.add('show');
  ui.reason.textContent = lastReasonKey ? t(lastReasonKey) : '';
}

function finish(result, reasonKey) {
  ended = true;
  running = false;
  stop();
  lastResult = result;
  lastReasonKey = reasonKey || null;
  renderOutcome();
  renderTrace();
  updateHud();
}

function renderTrace() {
  if (!ui.traceList) return;
  ui.traceSummary.textContent = trace.length
    ? f('traceSummary', { ticks: trace.length, invalid: stats.invalid, timeouts: stats.timeouts })
    : t('traceEmpty');
  ui.traceList.innerHTML = '';
  const from = Math.max(0, trace.length - 160);
  for (let i = from; i < trace.length; i++) {
    const e = trace[i];
    const row = document.createElement('div');
    const tick = document.createElement('span');
    tick.className = 'dim';
    tick.textContent = e.t;
    const act = document.createElement('span');
    act.textContent = e.action;
    const hp = document.createElement('span');
    hp.className = 'dim';
    hp.textContent = `${e.youHp}/${e.enemyHp}`;
    row.append(tick, act, hp);
    ui.traceList.appendChild(row);
  }
  if (trace.length) ui.traceList.scrollTop = ui.traceList.scrollHeight;
}

function downloadTrace() {
  const payload = {
    map: selectedMap.id,
    result: lastResult,
    reason: lastReasonKey,
    policy: normalizePolicyCode(ui.editor.value),
    stats: { ...stats },
    ticks: trace,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = 'token-wars-trace.json';
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 2000);
  ui.traceStatus.textContent = t('traceDownloaded');
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
    lastError = f('decideThrew', err.message);
    ui.error.textContent = lastError;
    finish('loss', 'reasonThrew');
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
    lastAction = f('timeoutAction', decideMs);
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

  trace.push({ t: tick, action: lastAction, youHp: you.hp, enemyHp: enemy.hp });

  draw();
  updateHud();

  if (stats.consecutiveTimeouts >= TIMEOUT_LIMIT) return finish('loss', 'reasonTimeouts');
  if (stats.invalid > VIOLATION_LIMIT) return finish('loss', 'reasonInvalid');
  if (!you.alive || !enemy.alive) {
    return finish(you.alive ? 'win' : (enemy.alive ? 'loss' : 'draw'),
      you.alive || enemy.alive ? 'reasonHp' : 'reasonBoth');
  }
  if (elapsed >= MATCH_MAX_MS) return finish('draw', 'reasonLimit');
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

function paramFromHash(name) {
  const re = new RegExp(`(?:^|[#&])${name}=([^&]+)`);
  const m = re.exec(location.hash || '');
  return m ? decodeCode(m[1]) : null;
}

function codeFromHash() {
  return paramFromHash('code');
}

async function copyLlmPrompt() {
  const text = llmPromptText();
  try {
    await navigator.clipboard.writeText(text);
    ui.shareStatus.textContent = t('llmCopied');
  } catch {
    window.prompt(t('llmPrompt'), text);
  }
}

async function copyShareLink() {
  const code = normalizePolicyCode(ui.editor.value);
  if (code.length > MAX_HASH_CHARS) {
    ui.shareStatus.textContent = t('shareTooLarge');
    return;
  }
  const url = `${location.href.split('#')[0]}#code=${encodeCode(code)}`;
  history.replaceState(null, '', url);
  try {
    await navigator.clipboard.writeText(url);
    ui.shareStatus.textContent = t('shareCopied');
  } catch {
    window.prompt(t('copyLinkPrompt'), url);
  }
}

function downloadAgent() {
  const src = renderAgentSource(normalizePolicyCode(ui.editor.value));
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
  ui.shareStatus.textContent = t('downloaded');
}

// 批量评估：暂停动画，直接跑 50 场，给出胜率与耗时（AI 作者调参用）
function simulateBatch() {
  let policy;
  try {
    policy = compilePolicy();
  } catch (err) {
    ui.error.textContent = f('compileError', err.message);
    return;
  }
  stop();
  ui.error.textContent = '';
  ui.simulate.disabled = true;
  ui.simResult.textContent = t('simulating');
  lastSim = null;
  ui.shareCard.hidden = true;
  const map = selectedMap;
  const mapName = mapLabel();
  // 先让浏览器画一帧，再进入同步模拟
  setTimeout(() => {
    try {
      const out = simulateMatches(policy, { count: 50, map });
      // 同一张图再跑一次内置「均衡型」预设，给胜率一个可对照的基线
      const baseline = simulateMatches(compilePolicy(SAMPLE_BALANCED), { count: 50, map });
      ui.simResult.textContent = f('simResult', out, mapName) + f('simBaseline', baseline);
      lastSim = { kind: 'single', out, baseline, mapName, mapId: map.id };
      ui.shareCard.hidden = false;
    } catch (err) {
      ui.error.textContent = f('simFailed', err.message);
      ui.simResult.textContent = '';
    } finally {
      ui.simulate.disabled = false;
    }
  }, 30);
}

// 泛化评估：同一策略在五张图各跑 20 场，看对守门 AI 的胜率是否稳定
function simulateAllMaps() {
  let policy;
  try {
    policy = compilePolicy();
  } catch (err) {
    ui.error.textContent = f('compileError', err.message);
    return;
  }
  stop();
  ui.error.textContent = '';
  ui.simulate.disabled = true;
  ui.simAll.disabled = true;
  ui.simResult.textContent = t('simulatingAll');
  lastSim = null;
  ui.shareCard.hidden = true;
  setTimeout(() => {
    try {
      const rows = MAP_LIST.map((m) => ({ map: m, out: simulateMatches(policy, { count: 20, map: m }) }));
      const total = rows.reduce((acc, { out }) => {
        acc.matches += out.matches;
        acc.wins += out.wins;
        acc.losses += out.losses;
        acc.draws += out.draws;
        acc.invalid += out.invalid;
        acc.timeouts += out.timeouts;
        acc._ticks += out.avgTicks * out.matches;
        acc._decision += out.avgDecisionMs * out.matches;
        return acc;
      }, { matches: 0, wins: 0, losses: 0, draws: 0, invalid: 0, timeouts: 0, _ticks: 0, _decision: 0 });
      total.avgTicks = Math.round(total._ticks / total.matches);
      total.avgDecisionMs = Math.round((total._decision / total.matches) * 100) / 100;
      total.winRate = Math.round((total.wins / total.matches) * 100);
      ui.simResult.textContent = `${f('simAllHeader', total)}\n`
        + rows.map(({ map, out }) => f('simAllRow', mapNameOf(map), out)).join('\n');
      lastSim = { kind: 'all', rows, total };
      ui.shareCard.hidden = false;
    } catch (err) {
      ui.error.textContent = f('simFailed', err.message);
      ui.simResult.textContent = '';
    } finally {
      ui.simulate.disabled = false;
      ui.simAll.disabled = false;
    }
  }, 30);
}

// 每日挑战：今天的图 + 规则变体（配置来自 shared/dailyChallenge.js）
function renderDailyLabel() {
  if (!ui.dailyRun) return;
  ui.dailyRun.textContent = `${t('dailyRun')} #${dailyInfo().number}`;
}

function runDaily() {
  let policy;
  try {
    policy = compilePolicy();
  } catch (err) {
    ui.error.textContent = f('compileError', err.message);
    return;
  }
  stop();
  ui.error.textContent = '';
  ui.simulate.disabled = true;
  ui.simAll.disabled = true;
  ui.dailyRun.disabled = true;
  lastSim = null;
  ui.shareCard.hidden = true;

  const info = dailyInfo();
  const map = MAP_LIST.find((m) => m.id === info.mapId) || MAP;
  const mutText = lang === 'zh' ? info.mutator.zh : info.mutator.en;
  const mapName = mapNameOf(map);
  const rules = dailyRules(info.mutator);
  selectedMap = map;
  ui.mapSelect.value = map.id;
  ui.simResult.textContent = t('dailyRunning');

  setTimeout(() => {
    try {
      const opts = { count: 50, map, rules };
      const out = simulateMatches(policy, opts);
      const baseline = simulateMatches(compilePolicy(SAMPLE_BALANCED), opts);
      ui.simResult.textContent = `${f('dailyPrefix', info.number, mapName, mutText)}\n`
        + f('simResult', out, mapName) + f('simBaseline', baseline);
      lastSim = {
        kind: 'single', out, baseline, mapName, mapId: map.id,
        daily: { number: info.number, mut: mutText },
      };
      ui.shareCard.hidden = false;
    } catch (err) {
      ui.error.textContent = f('simFailed', err.message);
      ui.simResult.textContent = '';
    } finally {
      ui.simulate.disabled = false;
      ui.simAll.disabled = false;
      ui.dailyRun.disabled = false;
    }
  }, 30);
}

// --- 基准图（1200×630 PNG，把最近一次 Simulate 结果发到 X / Discord） --------

function fitText(ctx, text, maxWidth, size, weight = '') {
  let px = size;
  do {
    ctx.font = `${weight}${px}px 'Courier New', ui-monospace, monospace`;
    if (ctx.measureText(text).width <= maxWidth) return px;
    px -= 2;
  } while (px > 10);
  return px;
}

function buildBenchCard() {
  const mono = "'Courier New', ui-monospace, monospace";
  const all = lastSim.kind === 'all';
  const stats = all ? lastSim.total : lastSim.out;
  const rate = all ? lastSim.total.winRate : lastSim.out.winRate;
  const color = rate >= 50 ? '#00ff88' : '#ff4466';

  const card = document.createElement('canvas');
  card.width = 1200;
  card.height = 630;
  const ctx = card.getContext('2d');

  ctx.fillStyle = '#06060f';
  ctx.fillRect(0, 0, 1200, 630);
  ctx.strokeStyle = 'rgba(0,255,136,0.06)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 40; x < 1200; x += 40) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, 630); }
  for (let y = 40; y < 630; y += 40) { ctx.moveTo(0, y + 0.5); ctx.lineTo(1200, y + 0.5); }
  ctx.stroke();

  ctx.fillStyle = '#00ff88';
  ctx.font = `22px ${mono}`;
  ctx.fillText('▚ TOKEN WARS', 60, 92);
  ctx.strokeStyle = 'rgba(0,255,136,0.35)';
  ctx.beginPath();
  ctx.moveTo(60, 112);
  ctx.lineTo(300, 112);
  ctx.stroke();
  ctx.fillStyle = '#88aaff';
  ctx.font = `22px ${mono}`;
  ctx.textAlign = 'right';
  ctx.fillText(t('benchTitle'), 1140, 92);
  ctx.textAlign = 'left';

  ctx.fillStyle = '#5f7a71';
  ctx.font = `18px ${mono}`;
  ctx.fillText(t('benchWin').toUpperCase(), 60, 162);
  ctx.fillStyle = color;
  ctx.font = `bold 104px ${mono}`;
  ctx.fillText(`${rate}%`, 60, 258);

  const sub = all
    ? f('benchSubAll', stats.matches)
    : (lastSim.daily
      ? f('dailyPrefix', lastSim.daily.number, lastSim.mapName, lastSim.daily.mut)
      : f('benchSubSingle', stats.matches, lastSim.mapName));
  const subSize = fitText(ctx, sub, 620, 24);
  ctx.fillStyle = '#8fb3a5';
  ctx.font = `${subSize}px ${mono}`;
  ctx.fillText(sub, 60, 308);

  ctx.fillStyle = '#cfe8dd';
  ctx.font = `26px ${mono}`;
  ctx.fillText(f('benchRecord', stats), 60, 360);

  const statLine = f('benchStats', stats);
  const statSize = fitText(ctx, statLine, 620, 20);
  ctx.fillStyle = '#5f7a71';
  ctx.font = `${statSize}px ${mono}`;
  ctx.fillText(statLine, 60, 400);

  const bar = (label, value, y) => {
    ctx.fillStyle = '#8fb3a5';
    ctx.font = `18px ${mono}`;
    ctx.fillText(label, 720, y - 10);
    ctx.fillStyle = '#0a1520';
    ctx.fillRect(720, y, 380, 16);
    ctx.strokeStyle = '#1b2a24';
    ctx.strokeRect(720.5, y + 0.5, 379, 15);
    const w = Math.max(2, Math.round((380 * Math.min(100, Math.max(0, value))) / 100));
    ctx.fillStyle = value >= 50 ? '#00ff88' : '#ff4466';
    ctx.fillRect(720, y, w, 16);
    ctx.fillStyle = '#cfe8dd';
    ctx.font = `18px ${mono}`;
    ctx.fillText(`${value}%`, 1112, y + 14);
  };

  if (all) {
    lastSim.rows.forEach(({ map, out }, i) => bar(mapNameOf(map), out.winRate, 215 + i * 56));
  } else {
    bar(t('benchYou'), lastSim.out.winRate, 300);
    bar(t('benchBase'), lastSim.baseline.winRate, 380);
  }

  ctx.strokeStyle = 'rgba(0,255,136,0.2)';
  ctx.beginPath();
  ctx.moveTo(60, 500);
  ctx.lineTo(1140, 500);
  ctx.stroke();
  ctx.fillStyle = '#8fb3a5';
  ctx.font = `20px ${mono}`;
  ctx.fillText(t('benchTagline'), 60, 536);
  ctx.fillStyle = '#00aa77';
  ctx.font = `22px ${mono}`;
  ctx.fillText('bscbai.github.io/token-wars/sandbox.html', 60, 580);

  return card;
}

function benchCardFileName() {
  const rate = lastSim.kind === 'all' ? lastSim.total.winRate : lastSim.out.winRate;
  if (lastSim.daily) return `token-wars-bot-daily-${lastSim.daily.number}-${rate}pct.png`;
  const tag = lastSim.kind === 'all' ? 'all-maps' : lastSim.mapId;
  return `token-wars-bot-${tag}-${rate}pct.png`;
}

async function shareBenchCard() {
  if (!lastSim) return;
  const blob = await new Promise((resolve) => buildBenchCard().toBlob(resolve, 'image/png'));
  if (!blob) return;
  const file = new File([blob], benchCardFileName(), { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: t('benchTagline') });
      ui.shareStatus.textContent = t('cardShared');
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  ui.shareStatus.textContent = t('cardSaved');
}

// --- 对战图（1200×630 PNG，把 50 场 duel 结果发到 X / Discord） ---------------

function buildDuelCard() {
  const o = lastDuel;
  const mono = "'Courier New', ui-monospace, monospace";
  const mine = o.aWins;
  const theirs = o.bWins;
  const outcome = mine > theirs ? 'duelWin' : (theirs > mine ? 'duelLoss' : 'duelDraw');
  const color = mine > theirs ? '#00ff88' : (theirs > mine ? '#ff4466' : '#88aaff');
  const mapName = lastDuelMeta ? lastDuelMeta.mapName : mapNameOf(selectedMap);

  const card = document.createElement('canvas');
  card.width = 1200;
  card.height = 630;
  const ctx = card.getContext('2d');

  ctx.fillStyle = '#06060f';
  ctx.fillRect(0, 0, 1200, 630);
  ctx.strokeStyle = 'rgba(0,255,136,0.06)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 40; x < 1200; x += 40) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, 630); }
  for (let y = 40; y < 630; y += 40) { ctx.moveTo(0, y + 0.5); ctx.lineTo(1200, y + 0.5); }
  ctx.stroke();

  ctx.fillStyle = '#00ff88';
  ctx.font = `22px ${mono}`;
  ctx.fillText('▚ TOKEN WARS', 60, 92);
  ctx.strokeStyle = 'rgba(0,255,136,0.35)';
  ctx.beginPath();
  ctx.moveTo(60, 112);
  ctx.lineTo(300, 112);
  ctx.stroke();
  ctx.fillStyle = '#88aaff';
  ctx.font = `22px ${mono}`;
  ctx.textAlign = 'right';
  ctx.fillText(t('duelCardTitle'), 1140, 92);
  ctx.textAlign = 'left';

  const resultText = t(outcome);
  const resultSize = fitText(ctx, resultText, 640, 76, 'bold ');
  ctx.fillStyle = color;
  ctx.font = `bold ${resultSize}px ${mono}`;
  ctx.fillText(resultText, 60, 235);

  const sub = f('duelCardSub', o.matches, mapName);
  const subSize = fitText(ctx, sub, 620, 24);
  ctx.fillStyle = '#8fb3a5';
  ctx.font = `${subSize}px ${mono}`;
  ctx.fillText(sub, 60, 288);

  ctx.fillStyle = '#cfe8dd';
  ctx.font = `26px ${mono}`;
  ctx.fillText(f('duelCardRecord', o), 60, 340);

  const statLine = f('duelCardStats', o);
  const statSize = fitText(ctx, statLine, 620, 20);
  ctx.fillStyle = '#5f7a71';
  ctx.font = `${statSize}px ${mono}`;
  ctx.fillText(statLine, 60, 382);

  const bar = (label, value, y) => {
    ctx.fillStyle = '#8fb3a5';
    ctx.font = `18px ${mono}`;
    ctx.fillText(label, 720, y - 10);
    ctx.fillStyle = '#0a1520';
    ctx.fillRect(720, y, 380, 16);
    ctx.strokeStyle = '#1b2a24';
    ctx.strokeRect(720.5, y + 0.5, 379, 15);
    const w = Math.max(2, Math.round((380 * Math.min(100, Math.max(0, value))) / 100));
    ctx.fillStyle = value >= 50 ? '#00ff88' : '#ff4466';
    ctx.fillRect(720, y, w, 16);
    ctx.fillStyle = '#cfe8dd';
    ctx.font = `18px ${mono}`;
    ctx.fillText(`${value}%`, 1112, y + 14);
  };
  bar(t('duelYou'), o.winRateA, 300);
  bar(t('duelThem'), o.winRateB, 380);

  ctx.strokeStyle = 'rgba(0,255,136,0.2)';
  ctx.beginPath();
  ctx.moveTo(60, 500);
  ctx.lineTo(1140, 500);
  ctx.stroke();
  ctx.fillStyle = '#8fb3a5';
  ctx.font = `20px ${mono}`;
  ctx.fillText(t('duelCardTagline'), 60, 536);
  ctx.fillStyle = '#00aa77';
  ctx.font = `22px ${mono}`;
  ctx.fillText('bscbai.github.io/token-wars/sandbox.html', 60, 580);

  return card;
}

function duelCardFileName() {
  const mapId = lastDuelMeta ? lastDuelMeta.mapId : selectedMap.id;
  return `token-wars-duel-${mapId}-${lastDuel.aWins}w-${lastDuel.bWins}w.png`;
}

async function shareDuelCard() {
  if (!lastDuel) return;
  const blob = await new Promise((resolve) => buildDuelCard().toBlob(resolve, 'image/png'));
  if (!blob) return;
  const file = new File([blob], duelCardFileName(), { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: t('duelCardTagline') });
      ui.shareStatus.textContent = t('cardShared');
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  ui.shareStatus.textContent = t('cardSaved');
}

// 双策略对打：粘贴朋友的分享链接（#code=… 或 #vs=…）即可离线比一场
function loadOpponentFromInput() {
  const raw = ui.duelLink.value.trim();
  if (!raw) return;
  let code = null;
  const vs = /(?:^|[#&])vs=([^&]+)/.exec(raw);
  if (vs) code = decodeCode(vs[1]);
  if (!code) {
    const own = /(?:^|[#&])code=([^&]+)/.exec(raw);
    if (own) code = decodeCode(own[1]);
  }
  if (!code) code = decodeCode(raw.replace(/^.*#/, ''));
  if (!code) {
    ui.duelResult.textContent = t('decodeFail');
    return;
  }
  ui.opponentEditor.value = code;
  const mapParam = /(?:^|[#&])map=([a-z_]+)/.exec(raw);
  if (mapParam && MAP_LIST.some((m) => m.id === mapParam[1])) {
    ui.mapSelect.value = mapParam[1];
    selectedMap = MAP_LIST.find((m) => m.id === mapParam[1]);
  }
  lastDuel = null;
  lastDuelMeta = null;
  ui.duelCard.hidden = true;
  hideDuelReplay();
  ui.duelResult.textContent = t('opponentLoaded');
}

function duelUrl() {
  const code = normalizePolicyCode(ui.editor.value);
  const opp = normalizePolicyCode(ui.opponentEditor.value);
  if (code.length + opp.length > MAX_HASH_CHARS) return null;
  return `${location.href.split('#')[0]}#code=${encodeCode(code)}&vs=${encodeCode(opp)}&map=${selectedMap.id}`;
}

function copyDuelLink() {
  const url = duelUrl();
  if (!url) {
    ui.duelResult.textContent = t('shareTooLarge');
    return;
  }
  history.replaceState(null, '', url);
  navigator.clipboard.writeText(url)
    .then(() => { ui.duelResult.textContent = t('duelLinkCopied'); })
    .catch(() => { window.prompt(t('copyDuelPrompt'), url); });
}

function copyDuelResult() {
  if (!lastDuel) {
    ui.duelResult.textContent = t('needDuel');
    return;
  }
  const url = duelUrl();
  const text = f('duelPost', lastDuel, url, mapLabel());
  navigator.clipboard.writeText(text)
    .then(() => { ui.duelResult.textContent = t('resultCopied'); })
    .catch(() => { window.prompt(t('copyResultPrompt'), text); });
}

function runDuel() {
  let mine;
  let theirs;
  try {
    mine = compilePolicy();
    theirs = compilePolicy(ui.opponentEditor.value);
  } catch (err) {
    ui.error.textContent = f('compileError', err.message);
    return;
  }
  stop();
  hideDuelReplay();
  ui.error.textContent = '';
  ui.duelRun.disabled = true;
  lastDuel = null;
  lastDuelMeta = null;
  lastMulti = null;
  ui.duelCard.hidden = true;
  ui.duelAllResult.textContent = '';
  ui.duelResult.textContent = t('dueling');
  const map = selectedMap;
  const mapName = mapLabel();
  setTimeout(() => {
    try {
      const out = simulateMatchesBetween(mine, theirs, { count: 50, map });
      lastDuel = out;
      lastDuelMeta = { mapId: map.id, mapName };
      ui.duelCard.hidden = false;
      ui.duelWatch.hidden = false;
      ui.duelResult.textContent = f('duelResult', out, mapName);
    } catch (err) {
      ui.error.textContent = f('duelFailed', err.message);
      ui.duelResult.textContent = '';
      ui.duelWatch.hidden = true;
    } finally {
      ui.duelRun.disabled = false;
    }
  }, 30);
}

// 一次真实对局的逐 tick 回放（约 100ms 一帧，可暂停/重播）
const REPLAY_MS = 100;

function stopReplay() {
  if (duelReplay && duelReplay.timer) clearInterval(duelReplay.timer);
  if (duelReplay) duelReplay.timer = null;
}

function hideDuelReplay() {
  stopReplay();
  duelReplay = null;
  if (ui.duelReplay) ui.duelReplay.hidden = true;
  if (ui.duelWatch) ui.duelWatch.hidden = true;
  if (ui.duelTick) ui.duelTick.textContent = '';
}

function setReplayButton(playing) {
  if (ui.duelPlay) ui.duelPlay.textContent = t(playing ? 'replayPause' : 'replayPlay');
}

function drawDuelFrame() {
  if (!duelReplay || !duelReplay.frames.length) return;
  const frame = duelReplay.frames[duelReplay.idx];
  const map = duelReplay.map;
  const canvas = ui.duelBoard;
  const ctx = canvas.getContext('2d');
  const w = map.width * CELL;
  const h = map.height * CELL;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  ctx.fillStyle = '#06060f';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(0,255,136,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < map.width; i++) { ctx.moveTo(i * CELL + 0.5, 0); ctx.lineTo(i * CELL + 0.5, h); }
  for (let j = 1; j < map.height; j++) { ctx.moveTo(0, j * CELL + 0.5); ctx.lineTo(w, j * CELL + 0.5); }
  ctx.stroke();
  ctx.fillStyle = '#17242e';
  for (const [x, y] of map.obstacles) ctx.fillRect(x * CELL, y * CELL, CELL - 1, CELL - 1);

  const entity = (a, color) => {
    if (!a || !a.alive) return;
    ctx.fillStyle = color;
    ctx.fillRect(a.x * CELL + 2, a.y * CELL + 2, CELL - 4, CELL - 4);
  };
  entity(frame.a, '#00ff88');
  entity(frame.b, '#ff4466');
  ui.duelTick.textContent = f('replayTick', frame.t, duelReplay.frames.length, frame.a.hp, frame.b.hp);
}

function playReplay() {
  if (!duelReplay) return;
  if (duelReplay.idx >= duelReplay.frames.length - 1) duelReplay.idx = 0;
  if (duelReplay.timer) return;
  drawDuelFrame();
  setReplayButton(true);
  duelReplay.timer = setInterval(() => {
    if (!duelReplay) return;
    duelReplay.idx++;
    if (duelReplay.idx >= duelReplay.frames.length) {
      duelReplay.idx = duelReplay.frames.length - 1;
      stopReplay();
      setReplayButton(false);
    }
    drawDuelFrame();
  }, REPLAY_MS);
}

function pauseReplay() {
  if (!duelReplay) return;
  stopReplay();
  setReplayButton(false);
}

function toggleDuelReplay() {
  if (!duelReplay) return;
  if (duelReplay.timer) pauseReplay();
  else playReplay();
}

function watchOneDuel() {
  let mine;
  let theirs;
  try {
    mine = compilePolicy();
    theirs = compilePolicy(ui.opponentEditor.value);
  } catch (err) {
    ui.error.textContent = f('compileError', err.message);
    return;
  }
  const map = selectedMap;
  let out;
  try {
    out = simulateDuel(mine, theirs, { map, recordFrames: true });
  } catch (err) {
    ui.error.textContent = f('duelFailed', err.message);
    return;
  }
  const frames = out.frames || [];
  if (!frames.length) return;
  stopReplay();
  duelReplay = { frames, idx: 0, timer: null, map, out };
  ui.duelReplay.hidden = false;
  drawDuelFrame();
  playReplay();
}

function renderAllMaps() {
  if (!ui.duelAllResult) return;
  ui.duelAllResult.innerHTML = '';
  if (!lastMulti) return;
  lastMulti.rows.forEach(({ map, out }) => {
    const row = document.createElement('div');
    row.className = 'mapline';
    const name = document.createElement('span');
    name.textContent = mapNameOf(map) + ' ';
    const stats = document.createElement('span');
    stats.textContent = f('duelAllStats', out);
    row.append(name, stats);
    ui.duelAllResult.appendChild(row);
  });
  const total = document.createElement('div');
  total.className = 'mapline total';
  total.textContent = f('duelAllSummary', lastMulti.total);
  ui.duelAllResult.appendChild(total);
}

function runDuelAll() {
  let mine;
  let theirs;
  try {
    mine = compilePolicy();
    theirs = compilePolicy(ui.opponentEditor.value);
  } catch (err) {
    ui.error.textContent = f('compileError', err.message);
    return;
  }
  stop();
  hideDuelReplay();
  ui.error.textContent = '';
  ui.duelRun.disabled = true;
  ui.duelAll.disabled = true;
  lastDuel = null;
  lastDuelMeta = null;
  lastMulti = null;
  ui.duelCard.hidden = true;
  ui.duelResult.textContent = '';
  ui.duelAllResult.textContent = t('duelingAll');
  setTimeout(() => {
    const t0 = performance.now();
    try {
      const per = 20;
      const rows = MAP_LIST.map((m) => ({
        map: m,
        out: simulateMatchesBetween(mine, theirs, { count: per, map: m }),
      }));
      const total = rows.reduce((acc, { out }) => {
        acc.matches += out.matches;
        acc.aWins += out.aWins;
        acc.bWins += out.bWins;
        acc.draws += out.draws;
        return acc;
      }, { matches: 0, aWins: 0, bWins: 0, draws: 0 });
      total.winRateA = total.matches ? Math.round((total.aWins / total.matches) * 100) : 0;
      total.winRateB = total.matches ? Math.round((total.bWins / total.matches) * 100) : 0;
      total.wallMs = Math.round(performance.now() - t0);
      lastMulti = { per, rows, total };
      renderAllMaps();
    } catch (err) {
      ui.error.textContent = f('duelAllFailed', err.message);
      ui.duelAllResult.textContent = '';
    } finally {
      ui.duelRun.disabled = false;
      ui.duelAll.disabled = false;
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
  ui.stats.textContent = f('stats', {
    tick,
    decisions: stats.decisions,
    invalid: stats.invalid,
    timeouts: stats.timeouts,
    avg: stats.decisions ? Math.round(stats.totalDecideMs / stats.decisions) : 0,
    max: Math.round(stats.maxDecideMs),
  });
  ui.lastAction.textContent = f('lastAction', lastAction);
  ui.shieldTag.textContent = you.shieldActive ? f('shield', you.shield) : '';
}

function populatePresets() {
  const prev = ui.preset.value;
  ui.preset.innerHTML = '';
  PRESETS.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = lang === 'zh' ? p.labelZh : p.label;
    ui.preset.appendChild(opt);
  });
  ui.preset.value = PRESETS.some((p) => p.id === prev) ? prev : PRESETS[0].id;
}

function populateMaps() {
  const prev = (ui.mapSelect && ui.mapSelect.value) || selectedMap.id;
  ui.mapSelect.innerHTML = '';
  MAP_LIST.forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = mapNameOf(m);
    ui.mapSelect.appendChild(opt);
  });
  const next = MAP_LIST.some((m) => m.id === prev) ? prev : MAP.id;
  ui.mapSelect.value = next;
  selectedMap = MAP_LIST.find((m) => m.id === next) || MAP;
}

function applyLang(next) {
  if (next === 'zh' || next === 'en') lang = next;
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
  ui.lang.textContent = lang === 'zh' ? 'EN' : '中文';
  ui.lang.setAttribute('aria-label', lang === 'zh' ? 'Switch to English' : '切换到中文');
  populatePresets();
  populateMaps();
  renderOutcome();
  renderTrace();
  renderAllMaps();
  renderDailyLabel();
  updateHud();
  if (duelReplay) {
    drawDuelFrame();
    setReplayButton(!!duelReplay.timer);
  }
}

// --- 启动 -------------------------------------------------------------------

function boot() {
  const $ = (id) => document.getElementById(id);
  Object.assign(ui, {
    canvas: $('board'),
    editor: $('editor'),
    preset: $('preset'),
    mapSelect: $('mapSelect'),
    run: $('run'),
    stop: $('stop'),
    reset: $('reset'),
    share: $('share'),
    download: $('download'),
    simulate: $('simulate'),
    simAll: $('simAll'),
    dailyRun: $('dailyRun'),
    shareCard: $('shareCard'),
    llm: $('llm'),
    simResult: $('simResult'),
    shareStatus: $('shareStatus'),
    opponentEditor: $('opponentEditor'),
    duelRun: $('duelRun'),
    duelAll: $('duelAll'),
    duelResult: $('duelResult'),
    duelAllResult: $('duelAllResult'),
    duelLink: $('duelLink'),
    duelLoad: $('duelLoad'),
    duelShare: $('duelShare'),
    duelCopy: $('duelCopy'),
    duelCard: $('duelCard'),
    duelWatch: $('duelWatch'),
    duelReplay: $('duelReplay'),
    duelBoard: $('duelBoard'),
    duelPlay: $('duelPlay'),
    duelTick: $('duelTick'),
    lang: $('lang'),
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
    traceDetails: $('traceDetails'),
    traceSummary: $('traceSummary'),
    traceList: $('traceList'),
    traceDownload: $('traceDownload'),
    traceStatus: $('traceStatus'),
  });

  populatePresets();
  ui.editor.value = SAMPLE_BALANCED;
  ui.opponentEditor.value = SAMPLE_TURTLE;
  const shared = codeFromHash();
  if (shared) {
    ui.editor.value = shared;
    ui.shareStatus.textContent = t('loadedShare');
  }
  const sharedOpponent = paramFromHash('vs');
  if (sharedOpponent) {
    ui.opponentEditor.value = sharedOpponent;
    ui.duelResult.textContent = t('bothLoaded');
  }
  ui.preset.addEventListener('change', () => {
    const preset = PRESETS.find((p) => p.id === ui.preset.value) || PRESETS[0];
    ui.editor.value = preset.code;
  });
  ui.mapSelect.addEventListener('change', () => {
    selectedMap = MAP_LIST.find((m) => m.id === ui.mapSelect.value) || MAP;
    lastDuel = null;
    lastDuelMeta = null;
    lastMulti = null;
    lastSim = null;
    ui.duelResult.textContent = '';
    ui.duelAllResult.textContent = '';
    ui.duelCard.hidden = true;
    hideDuelReplay();
    ui.simResult.textContent = '';
    ui.shareCard.hidden = true;
  });
  ui.run.addEventListener('click', start);
  ui.stop.addEventListener('click', () => { stop(); ui.reason.textContent = t('reasonStopped'); });
  ui.share.addEventListener('click', copyShareLink);
  ui.download.addEventListener('click', downloadAgent);
  ui.simulate.addEventListener('click', simulateBatch);
  ui.simAll.addEventListener('click', simulateAllMaps);
  ui.dailyRun.addEventListener('click', runDaily);
  ui.shareCard.addEventListener('click', shareBenchCard);
  ui.llm.addEventListener('click', copyLlmPrompt);
  ui.duelRun.addEventListener('click', runDuel);
  ui.duelAll.addEventListener('click', runDuelAll);
  ui.duelWatch.addEventListener('click', watchOneDuel);
  ui.duelPlay.addEventListener('click', toggleDuelReplay);
  ui.duelLoad.addEventListener('click', loadOpponentFromInput);
  ui.duelShare.addEventListener('click', copyDuelLink);
  ui.duelCopy.addEventListener('click', copyDuelResult);
  ui.duelCard.addEventListener('click', shareDuelCard);
  ui.traceDownload.addEventListener('click', downloadTrace);
  ui.traceDetails.addEventListener('toggle', () => {
    if (ui.traceDetails.open) renderTrace();
  });
  ui.lang.addEventListener('click', () => {
    const next = lang === 'zh' ? 'en' : 'zh';
    try { localStorage.setItem('tw-sandbox-lang', next); } catch { /* 隐私模式忽略 */ }
    applyLang(next);
  });
  ui.editor.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      start();
    }
  });
  ui.reset.addEventListener('click', () => {
    stop();
    hideDuelReplay();
    ended = false;
    elapsed = 0;
    tick = 0;
    lastResult = null;
    lastReasonKey = null;
    trace = [];
    ui.traceList.innerHTML = '';
    ui.traceSummary.textContent = t('traceEmpty');
    ui.traceStatus.textContent = '';
    resetStats();
    freshAgents();
    ui.result.classList.remove('show');
    ui.error.textContent = '';
    draw();
    updateHud();
  });

  freshAgents();
  resetStats();
  applyLang();
  const sharedMap = /(?:^|[#&])map=([a-z_]+)/.exec(location.hash || '');
  if (sharedMap && MAP_LIST.some((m) => m.id === sharedMap[1])) {
    ui.mapSelect.value = sharedMap[1];
    selectedMap = MAP_LIST.find((m) => m.id === sharedMap[1]);
  }
  draw();
  updateHud();

  // 打开页面即跑一次默认策略，先看到效果再改代码
  start();

  // ?daily=1：直接用今天的图与规则评估当前策略（分享「今天的 bot 挑战」用）
  if (new URLSearchParams(location.search).get('daily') === '1') {
    setTimeout(runDaily, 120);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
