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
    noMatches: 'No matches yet — start the server or connect a bot',
    tick: 'ticks',
    updated: 'updated',
    loading: 'Loading…',
    failed: 'Could not load arena data',
    external: 'external agent',
    builtin: 'built-in',
    draw: 'draw',
    won: 'won',
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
    noMatches: '暂无对局 — 启动服务端或接入一个 bot',
    tick: 'tick',
    updated: '更新于',
    loading: '加载中…',
    failed: '竞技场数据加载失败',
    external: '外部 agent',
    builtin: '内置',
    draw: '平局',
    won: '胜',
  },
};

const REFRESH_MS = 5000;
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

const state = { lang: detectLang(), track: null, timer: null };
const t = (key) => (LANGS[state.lang] || LANGS.en)[key] || key;

const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
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
    const aWin = m.winner === 'A', bWin = m.winner === 'B';
    const a = el('span', `side ${aWin ? 'win' : ''}`, m.agentA.name || '?');
    const b = el('span', `side ${bWin ? 'win' : ''}`, m.agentB.name || '?');
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

function schedule() {
  if (state.timer) clearInterval(state.timer);
  state.timer = setInterval(load, REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearInterval(state.timer);
    else { load(); schedule(); }
  });
}

function bind() {
  $('lang-btn').addEventListener('click', () => {
    state.lang = state.lang === 'zh' ? 'en' : 'zh';
    try { localStorage.setItem('tw-lang', state.lang); } catch { /* ignore */ }
    renderChrome();
    load();
  });
  for (const btn of document.querySelectorAll('[data-track]')) {
    btn.addEventListener('click', () => {
      state.track = btn.getAttribute('data-track') || null;
      renderChrome();
      load();
    });
  }
}

renderChrome();
setStatus(t('loading'));
bind();
load();
schedule();
