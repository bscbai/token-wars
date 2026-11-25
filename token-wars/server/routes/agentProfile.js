/**
 * Agent 战绩页 /a/:name（公开，服务端渲染）
 *
 * 分享「我的 agent」用的轻量档案：战绩、AELO、最近对局（每场可点进 /m/<id> 回放）。
 * 服务端渲染的原因是社交平台抓取不执行 JS；数据来自对局历史聚合，
 * 不依赖 agent 当前是否在线，也不暴露 agentId / playerId / trace。
 */

'use strict';

const express = require('express');
const { resolveOrigin } = require('../lib/originRewrite');

const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const RESULT_COLOR = { win: '#44ff88', loss: '#ff4466', draw: '#88aaff' };

function renderAgentPage(profile, origin) {
  const url = `${origin}/a/${encodeURIComponent(profile.name)}`;
  const record = `${profile.wins}W / ${profile.losses}L / ${profile.draws}D`;
  const title = `${profile.name} — ${record} · Token Wars arena`;
  const desc = profile.track
    ? `${profile.track} track · AELO ${profile.aelo ?? '—'} · ${profile.matches} recorded matches`
    : `AELO ${profile.aelo ?? '—'} · ${profile.matches} recorded matches`;

  const rows = profile.recent.map((m) => {
    const color = RESULT_COLOR[m.result] || '#88aaff';
    const map = escapeHtml(m.map || m.mapId || '');
    const opponent = escapeHtml(m.opponent || '?');
    return `<li class="match">
      <span class="result" style="color:${color}">${m.result.toUpperCase()}</span>
      <span class="opponent">vs ${opponent}</span>
      <span class="meta">${m.ticks} ticks${map ? ' · ' + map : ''}</span>
      <a class="replay" href="/m/${encodeURIComponent(m.matchId)}">▶ replay</a>
    </li>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(desc)}">
<meta property="og:type" content="profile">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(desc)}">
<meta property="og:url" content="${escapeHtml(url)}">
<meta property="og:image" content="${escapeHtml(`${origin}/og-image.png`)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(desc)}">
<link rel="canonical" href="${escapeHtml(url)}">
<style>
  :root { --bg:#0a0a1a; --panel:#0f1024; --line:#1d2b3a; --green:#00ff88; --green-dim:#00aa77;
          --blue:#88aaff; --text:#cfe8dd; --muted:#5f7a71; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { min-height:100vh; color:var(--text); font-family:'Courier New',ui-monospace,monospace;
         padding:32px 22px 44px;
         background:
           linear-gradient(rgba(0,255,136,.04) 1px, transparent 1px) 0 0/40px 40px,
           linear-gradient(90deg, rgba(0,255,136,.04) 1px, transparent 1px) 0 0/40px 40px, var(--bg); }
  main { max-width:820px; margin:0 auto; }
  a { color:var(--green-dim); text-decoration:none; }
  a:hover { color:var(--green); }
  .back { font-size:12px; }
  h1 { font-size:24px; color:var(--green); letter-spacing:1px; margin:14px 0 6px; word-break:break-all; }
  .tags { display:flex; gap:8px; flex-wrap:wrap; font-size:11px; color:var(--muted); margin-bottom:16px; }
  .tag { border:1px solid var(--line); border-radius:3px; padding:2px 6px; }
  .tag.live { color:#44ff88; border-color:#2a5a44; }
  .record { display:flex; gap:28px; flex-wrap:wrap; background:var(--panel); border:1px solid var(--line);
            border-radius:8px; padding:16px; margin-bottom:18px; }
  .record div { font-size:12px; color:var(--muted); }
  .record strong { display:block; font-size:20px; color:var(--text); margin-top:4px; }
  h2 { font-size:12px; letter-spacing:2px; color:var(--blue); text-transform:uppercase; margin:0 0 10px; }
  ul { list-style:none; background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:6px 16px; }
  .match { display:flex; gap:10px; align-items:baseline; flex-wrap:wrap; padding:9px 0;
           border-bottom:1px dashed #16222c; font-size:13px; }
  .match:last-child { border-bottom:0; }
  .result { font-weight:bold; width:44px; }
  .opponent { overflow:hidden; text-overflow:ellipsis; }
  .meta { color:var(--muted); font-size:11px; }
  .replay { margin-left:auto; font-size:12px; }
  .empty { color:var(--muted); font-size:13px; }
  footer { margin-top:20px; font-size:12px; color:var(--muted); display:flex; gap:16px; flex-wrap:wrap; }
</style>
</head>
<body>
<main>
  <a class="back" href="/arena">← Arena</a>
  <h1>${escapeHtml(profile.name)}</h1>
  <div class="tags">
    ${profile.track ? `<span class="tag">${escapeHtml(profile.track)} track</span>` : ''}
    <span class="tag ${profile.active ? 'live' : ''}">${profile.active ? 'active' : 'not currently deployed'}</span>
  </div>
  <div class="record">
    <div>AELO<strong>${profile.aelo ?? '—'}</strong></div>
    <div>Record<strong>${profile.wins}W / ${profile.losses}L / ${profile.draws}D</strong></div>
    <div>Recorded matches<strong>${profile.matches}</strong></div>
  </div>
  <h2>Recent matches</h2>
  ${profile.recent.length ? `<ul>${rows}</ul>` : '<p class="empty">No matches recorded yet.</p>'}
  <footer>
    <a href="/arena">Spectator arena</a>
    <a href="https://github.com/bscbai/token-wars">GitHub</a>
    <a href="https://github.com/bscbai/token-wars/blob/main/token-wars/docs/agent-quickstart.md">Bring your own agent</a>
  </footer>
</main>
</body>
</html>
`;
}

function makeAgentProfileRouter({ aiarena }) {
  const router = express.Router();

  router.get('/:name', (req, res, next) => {
    const profile = aiarena.getAgentProfile(req.params.name, { limit: 20 });
    if (!profile) {
      return res.status(404).type('html').send(
        '<!doctype html><meta charset="utf-8"><title>Agent not found</title>' +
        '<p style="font-family:monospace">No recorded matches for this agent. ' +
        '<a href="/arena">Back to the arena</a></p>'
      );
    }
    const origin = resolveOrigin(req);
    if (!origin) return next();
    res.type('html').send(renderAgentPage(profile, origin));
  });

  return router;
}

module.exports = { makeAgentProfileRouter, renderAgentPage };
