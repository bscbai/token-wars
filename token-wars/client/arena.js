/**
 * Token Wars — 公开观战页（无需登录）
 *
 * 数据源（均为公开只读 REST）：
 *   GET /api/ai-arena/leaderboard?track=&limit=
 *   GET /api/ai-arena/matches/recent?track=&limit=
 *
 * 设计目标：分享到 X / Reddit / Discord 后，任何人打开链接即可看到
 * AI agent 的实时排名与最近对局，无需注册、无需安装。
 */

const LANGS = {
  en: {
    title: 'AI AGENT ARENA',
    subtitle: 'Live standings and results — no account needed',
    play: 'Play / Deploy an agent',
    protocol: 'Bring your own agent',
    standings: 'Standings',
    matches: 'Recent matches',
    all: 'All tracks',
    hardware: 'Hardware',
    model: 'Model',
    agent: 'Agent',
    rank: '#',
    agentCol: 'Agent',
    aelo: 'AELO',
    record: 'W/L',
    none: 'No agents on this track yet',
    noMatches: 'No matches yet — the arena is warming up',
    live: 'Live now',
    liveNone: 'No match running right now — the next one starts soon',
    liveStarted: 'running',
    tick: 'ticks',
    updated: 'updated',
    loading: 'Loading…',
    failed: 'Could not load arena data',
    external: 'external agent',
    builtin: 'built-in',
    draw: 'draw',
    won: 'won',
    joinTitle: 'Put your agent in the ring',
    joinLead: 'Any language — clone, install, then one command registers an account, mints a bot token and starts the sample competitor:',
    joinCopy: 'Copy',
    joinCopied: 'Copied',
    joinDocs: 'Protocol & client examples',
    joinNote: 'Node 22.13+ · Python and LLM bots included',
    replayTitle: 'Match replay',
    replayPlay: 'Play',
    replayPause: 'Pause',
    replayClose: 'Close',
    replayLoading: 'Loading replay…',
    replayMissing: 'No replay stored for this match',
    replayHint: 'Click a recent match to replay it',
  },
  zh: {
    title: 'AI 傀儡竞技场',
    subtitle: '实时排名与对局结果 — 无需账号',
    play: '开始游戏 / 部署 AI',
    protocol: '接入你的 agent',
    standings: '排行榜',
    matches: '最近对局',
    all: '全部赛道',
    hardware: '算力组',
    model: '模型组',
    agent: '车手组',
    rank: '#',
    agentCol: 'AI',
    aelo: 'AELO',
    record: '胜/负',
    none: '本赛道暂无上榜 AI',
    noMatches: '暂无对局 — 竞技场正在热身',
    live: '正在直播',
    liveNone: '当前没有进行中的对局 — 下一场很快就来',
    liveStarted: '已进行',
    tick: 'tick',
    updated: '更新于',
    loading: '加载中…',
    failed: '竞技场数据加载失败',
    external: '外部 agent',
    builtin: '内置',
    draw: '平局',
    won: '胜',
    joinTitle: '把你的 agent 送上擂台',
    joinLead: '任何语言 — 克隆、安装后，一条命令即可注册账号、签发 botToken 并拉起示例参赛 bot：',
    joinCopy: '复制',
    joinCopied: '已复制',
    joinDocs: '协议与客户端示例',
    joinNote: 'Node 22.13+ · 含 Python 与 LLM bot',
    replayTitle: '对局回放',
    replayPlay: '播放',
    replayPause: '暂停',
    replayClose: '关闭',
    replayLoading: '回放加载中…',
    replayMissing: '该对局没有回放数据',
    replayHint: '点击最近对局即可回放',
  },
};

const REFRESH_MS = 5000;
const LIVE_REFRESH_MS = 2000;
// 竞技场地图名（服务端 AI_MAPS 只带中文名；观战页按语言本地化）
const MAP_NAMES = {
  en: {
    data_mine: 'Data Mine',
    compute_square: 'Compute Square',
    cache_maze: 'Cache Maze',
    arena_dome: 'Arena Dome',
    data_torrent: 'Data Torrent',
  },
  zh: {},
};
const DOC_URL = {
  en: 'https://github.com/bscbai/token-wars/blob/main/token-wars/docs/bot-protocol.en.md',
  zh: 'https://github.com/bscbai/token-wars/blob/main/token-wars/docs/bot-protocol.md',
};

function detectLang() {
  try {
    const saved = localStorage.getItem('tw-lang');
    if (saved === 'en' || saved === 'zh') return saved;
    return String(navigator.language || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en';
  } catch {
    return 'en';
  }
}

// 分享链接可带 ?track=agent 定位赛道、?lang=en|zh 指定语言
const TRACK_IDS = ['hardware', 'model', 'agent'];
const QUERY = new URLSearchParams(location.search);
const initialTrack = QUERY.get('track');
const initialLang = QUERY.get('lang');

const state = {
  lang: (initialLang === 'en' || initialLang === 'zh') ? initialLang : detectLang(),
  track: TRACK_IDS.includes(initialTrack) ? initialTrack : null,
  timer: null,
};

// 对局回放（点击最近对局 / ?match=<id> 深链）
const replay = { data: null, idx: 0, timer: null, playing: false };
const t = (key) => (LANGS[state.lang] || LANGS.en)[key] || key;

const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** agent 名称链接到战绩页 /a/<name>；阻止冒泡，避免触发整行的回放点击 */
function agentLink(name, className) {
  const a = el('a', className, name);
  a.href = `/a/${encodeURIComponent(name)}`;
  a.addEventListener('click', (e) => e.stopPropagation());
  return a;
}

function trackName(id) {
  return id ? t(id) : t('all');
}

function renderChrome() {
  document.documentElement.lang = state.lang === 'zh' ? 'zh-CN' : 'en';
  document.title = `Token Wars — ${t('title')}`;
  $('title').textContent = t('title');
  $('subtitle').textContent = t('subtitle');
  $('play-link').textContent = t('play');
  $('protocol-link').textContent = `${t('protocol')} ↗`;
  $('protocol-link').href = DOC_URL[state.lang] || DOC_URL.en;
  $('lang-btn').textContent = state.lang === 'zh' ? 'EN' : '中文';
  $('standings-title').textContent = t('standings');
  $('matches-title').textContent = t('matches');
  $('live-label').textContent = t('live');
  $('join-title').textContent = t('joinTitle');
  $('join-lead').textContent = t('joinLead');
  $('join-docs').textContent = `${t('joinDocs')} ↗`;
  $('join-docs').href = DOC_URL[state.lang] || DOC_URL.en;
  $('join-note').textContent = t('joinNote');
  if (!copyTimer) $('join-copy').textContent = t('joinCopy');
  $('replay-title').textContent = t('replayTitle');
  $('replay-toggle').textContent = replay.playing ? t('replayPause') : t('replayPlay');
  $('replay-close').textContent = t('replayClose');
  for (const btn of document.querySelectorAll('[data-track]')) {
    const id = btn.getAttribute('data-track');
    btn.textContent = id ? t(id) : t('all');
    btn.classList.toggle('active', (id || null) === state.track);
  }
}

function setStatus(text, isError) {
  const node = $('status');
  node.textContent = text;
  node.classList.toggle('error', !!isError);
}

function renderStandings(entries) {
  const host = $('standings');
  host.replaceChildren();
  if (!entries.length) {
    host.appendChild(el('p', 'empty', t('none')));
    return;
  }
  const head = el('div', 'row head');
  head.append(el('span', 'rank', t('rank')), el('span', 'name', t('agentCol')),
    el('span', 'num', t('aelo')), el('span', 'num', t('record')));
  host.appendChild(head);

  entries.forEach((e, i) => {
    const row = el('div', 'row');
    const mark = e.aelo >= 1000 ? '◆' : '◇';
    row.append(
      el('span', 'rank', String(i + 1)),
      el('span', 'name', `${mark} ${e.name}`),
      el('span', 'num', String(e.aelo)),
      el('span', 'num dim', `${e.wins}/${e.losses}`)
    );
    host.appendChild(row);
  });
}

function renderMatches(entries) {
  const host = $('matches');
  host.replaceChildren();
  if (!entries.length) {
    host.appendChild(el('p', 'empty', t('noMatches')));
    return;
  }
  for (const m of entries) {
    const row = el('div', 'match');
    if (m.matchId) {
      row.classList.add('clickable');
      row.title = t('replayHint');
      row.addEventListener('click', () => openReplay(m.matchId));
    }
    const aWin = m.winner === 'A', bWin = m.winner === 'B';
    const a = agentLink(m.agentA.name || '?', `side ${aWin ? 'win' : ''}`);
    const b = agentLink(m.agentB.name || '?', `side ${bWin ? 'win' : ''}`);
    const line = el('div', 'duel');
    line.append(a, el('span', 'vs', m.winner === 'draw' ? t('draw') : 'vs'), b);
    row.appendChild(line);

    const meta = el('div', 'meta');
    const bits = [trackName(m.track), `${m.ticks} ${t('tick')}`];
    if (m.durationMs) bits.push(`${(m.durationMs / 1000).toFixed(1)}s`);
    const mapName = (MAP_NAMES[state.lang] || {})[m.mapId] || m.map;
    if (mapName) bits.push(mapName);
    meta.textContent = bits.join(' · ');
    if (m.external) meta.appendChild(el('span', 'badge', t('external')));
    row.appendChild(meta);
    host.appendChild(row);
  }
}

/** 小棋盘：障碍 + 双方位置（服务端快照，2s 刷新） */
function drawBoard(canvas, m) {
  const cell = Math.max(8, Math.floor(300 / Math.max(m.width, m.height)));
  canvas.width = m.width * cell;
  canvas.height = m.height * cell;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#06060f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // 细网格：让空场地也能看出格数与移动
  ctx.strokeStyle = 'rgba(0, 255, 136, 0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < m.width; i++) {
    ctx.moveTo(i * cell + 0.5, 0);
    ctx.lineTo(i * cell + 0.5, canvas.height);
  }
  for (let j = 1; j < m.height; j++) {
    ctx.moveTo(0, j * cell + 0.5);
    ctx.lineTo(canvas.width, j * cell + 0.5);
  }
  ctx.stroke();
  ctx.fillStyle = '#17242e';
  for (const [x, y] of m.obstacles || []) {
    ctx.fillRect(x * cell, y * cell, cell - 1, cell - 1);
  }
  const dot = (a, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(a.x * cell + 1, a.y * cell + 1, cell - 2, cell - 2);
  };
  dot(m.agentA, m.agentA.alive ? '#00ff88' : '#2a5a44');
  dot(m.agentB, m.agentB.alive ? '#ff4466' : '#5a2a36');
}

function renderLive(entries) {
  const host = $('live');
  host.replaceChildren();
  if (!entries.length) {
    host.appendChild(el('p', 'empty', t('liveNone')));
    return;
  }
  for (const m of entries.slice(0, 2)) {
    const wrap = el('div', 'live-match');
    const canvas = document.createElement('canvas');
    canvas.className = 'live-canvas';
    drawBoard(canvas, m);
    wrap.appendChild(canvas);

    const meta = el('div', 'live-meta');
    const line = el('div', 'duel');
    line.append(
      agentLink(`◆ ${m.agentA.name}`, `side ${m.agentA.alive ? 'win' : ''}`),
      el('span', 'vs', 'vs'),
      agentLink(`${m.agentB.name} ◇`, `side ${m.agentB.alive ? 'win' : ''}`)
    );
    meta.appendChild(line);
    meta.appendChild(el('div', 'hp', `HP ${m.agentA.hp}/${m.agentA.maxHp} · ${m.agentB.hp}/${m.agentB.maxHp}`));
    const mapName = (MAP_NAMES[state.lang] || {})[m.mapId] || m.map;
    meta.appendChild(el('div', '', `${trackName(m.track)} · ${mapName}`));
    meta.appendChild(el('div', '', `${t('liveStarted')} ${(m.elapsedMs / 1000).toFixed(1)}s`));
    wrap.appendChild(meta);
    host.appendChild(wrap);
  }
}

async function loadLive() {
  try {
    const data = await fetch('/api/ai-arena/matches/live').then((r) => r.json());
    renderLive(data.entries || []);
  } catch {
    // 网络抖动：保留上一帧，不打扰观战
  }
}

async function load() {
  const params = (limit) => {
    const q = new URLSearchParams({ limit: String(limit) });
    if (state.track) q.set('track', state.track);
    return q.toString();
  };
  try {
    const [board, recent] = await Promise.all([
      fetch(`/api/ai-arena/leaderboard?${params(20)}`).then((r) => r.json()),
      fetch(`/api/ai-arena/matches/recent?${params(12)}`).then((r) => r.json()),
    ]);
    renderStandings(board.entries || []);
    renderMatches(recent.entries || []);
    setStatus(`${t('updated')} ${new Date().toLocaleTimeString()}`);
  } catch {
    setStatus(t('failed'), true);
  }
}

let liveTimer = null;
let copyTimer = null;
// 复制按钮给出的命令必须指向当前这个竞技场（公网部署时就是公网域名）
const ARENA_URL = /^https?:$/.test(location.protocol) ? location.origin : 'http://localhost:3000';

function schedule() {
  if (state.timer) clearInterval(state.timer);
  if (liveTimer) clearInterval(liveTimer);
  state.timer = setInterval(load, REFRESH_MS);
  liveTimer = setInterval(loadLive, LIVE_REFRESH_MS);
}

function stopTimers() {
  if (state.timer) clearInterval(state.timer);
  if (liveTimer) clearInterval(liveTimer);
}

// --- 对局回放 -------------------------------------------------------------

function setMatchParam(matchId) {
  const q = new URLSearchParams(location.search);
  if (matchId) q.set('match', matchId);
  else q.delete('match');
  const qs = q.toString();
  try {
    history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
  } catch { /* file:// 等环境下忽略 */ }
}

function stopReplayTimer() {
  if (replay.timer) clearInterval(replay.timer);
  replay.timer = null;
  replay.playing = false;
}

function renderReplayFrame() {
  if (!replay.data) return;
  const frames = replay.data.frames;
  const frame = frames[Math.min(replay.idx, frames.length - 1)];
  if (!frame) return;
  drawBoard($('replay-canvas'), {
    width: replay.data.map.width,
    height: replay.data.map.height,
    obstacles: replay.data.map.obstacles,
    agentA: frame.a,
    agentB: frame.b,
  });
  $('replay-hp').textContent =
    `HP ${frame.a.hp} / ${frame.b.hp} · ${frame.t} ${t('tick')} · ${replay.idx + 1}/${frames.length}`;
}

function playReplay() {
  if (!replay.data) return;
  stopReplayTimer();
  replay.playing = true;
  $('replay-toggle').textContent = t('replayPause');
  replay.timer = setInterval(() => {
    if (replay.idx >= replay.data.frames.length - 1) {
      stopReplayTimer();
      $('replay-toggle').textContent = t('replayPlay');
      return;
    }
    replay.idx++;
    renderReplayFrame();
  }, 100);
}

function toggleReplay() {
  if (!replay.data) return;
  if (replay.playing) {
    stopReplayTimer();
    $('replay-toggle').textContent = t('replayPlay');
    return;
  }
  if (replay.idx >= replay.data.frames.length - 1) replay.idx = 0;
  playReplay();
}

function closeReplay() {
  stopReplayTimer();
  replay.data = null;
  replay.idx = 0;
  // /m/<id> 分享页的「关闭」回到观战页；站内深链只清掉 ?match 参数
  if (window.__TW_MATCH__) {
    location.assign('/arena');
    return;
  }
  $('replay').hidden = true;
  setMatchParam(null);
}

async function openReplay(matchId) {
  stopReplayTimer();
  replay.data = null;
  replay.idx = 0;
  const panel = $('replay');
  panel.hidden = false;
  $('replay-duel').replaceChildren();
  $('replay-meta').textContent = '';
  $('replay-hp').textContent = t('replayLoading');
  $('replay-toggle').textContent = t('replayPlay');
  // /m/<id> 由服务端注入 id，保持分享链接原样；/?match= 深链则同步地址栏
  if (!window.__TW_MATCH__) setMatchParam(matchId);
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  try {
    const res = await fetch(`/api/ai-arena/matches/${encodeURIComponent(matchId)}/replay`);
    if (!res.ok) throw new Error('not found');
    const data = await res.json();
    if (!data.frames || !data.frames.length) throw new Error('empty');
    replay.data = data;

    const duel = el('div', 'duel');
    duel.append(
      agentLink(`◆ ${data.agentA.name}`, `side ${data.winner === 'A' ? 'win' : ''}`),
      el('span', 'vs', data.winner === 'draw' ? t('draw') : 'vs'),
      agentLink(`${data.agentB.name} ◇`, `side ${data.winner === 'B' ? 'win' : ''}`)
    );
    $('replay-duel').replaceChildren(duel);
    const mapName = (MAP_NAMES[state.lang] || {})[data.map.id] || data.map.name;
    $('replay-meta').textContent = `${trackName(data.track)} · ${mapName} · ${data.ticks} ${t('tick')}`;
    renderReplayFrame();
    playReplay();
  } catch {
    $('replay-hp').textContent = t('replayMissing');
  }
}

function bind() {
  // 四条命令可直接粘贴（bash / zsh / PowerShell 通用，不依赖 &&）
  $('join-code').textContent = [
    'git clone https://github.com/bscbai/token-wars.git',
    'cd token-wars',
    'npm install',
    `npm run join -- --url ${ARENA_URL}`,
  ].join('\n');
  $('join-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('join-code').textContent);
    } catch {
      // 非安全上下文（http）下剪贴板不可用：退化为选中命令文本
      const range = document.createRange();
      range.selectNodeContents($('join-code'));
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    $('join-copy').textContent = t('joinCopied');
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      copyTimer = null;
      $('join-copy').textContent = t('joinCopy');
    }, 1600);
  });
  $('replay-close').addEventListener('click', closeReplay);
  $('replay-toggle').addEventListener('click', toggleReplay);
  $('lang-btn').addEventListener('click', () => {
    state.lang = state.lang === 'zh' ? 'en' : 'zh';
    try { localStorage.setItem('tw-lang', state.lang); } catch { /* ignore */ }
    // 地址栏跟随语言，复制出去就是对应语言的观战页
    const q = new URLSearchParams(location.search);
    q.set('lang', state.lang);
    try { history.replaceState(null, '', `?${q.toString()}`); } catch { /* ignore */ }
    renderChrome();
    load();
    loadLive();
  });
  for (const btn of document.querySelectorAll('[data-track]')) {
    btn.addEventListener('click', () => {
      state.track = btn.getAttribute('data-track') || null;
      // 地址栏跟随赛道，复制出去即可分享「只看某个赛道」
      const q = new URLSearchParams(location.search);
      if (state.track) q.set('track', state.track);
      else q.delete('track');
      const qs = q.toString();
      try {
        history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
      } catch { /* file:// 等环境下忽略 */ }
      renderChrome();
      load();
    });
  }
}

renderChrome();
setStatus(t('loading'));
bind();
load();
loadLive();
schedule();

// 分享链接：/m/<id>（服务端注入 window.__TW_MATCH__）或 ?match=<id>
const initialMatch = window.__TW_MATCH__ || new URLSearchParams(location.search).get('match');
if (initialMatch) openReplay(initialMatch);

// 页面不可见时停轮询（后台标签不消耗流量），回来立即补一帧
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopTimers();
  } else {
    load();
    loadLive();
    schedule();
  }
});
