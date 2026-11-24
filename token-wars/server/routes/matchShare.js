/**
 * 单场分享页 /m/:matchId
 *
 * 观战页的 ?match= 深链对人和浏览器都够用，但社交平台抓 OG 卡时不执行 JS，
 * 只会拿到通用描述。这里为每场对局服务端渲染一份带对阵信息的 meta，并把
 * 对局 id 注入页面，浏览器打开后自动回放该场。
 *
 * 只暴露公开字段（双方显示名/赛道/tick/胜负），与 /api/ai-arena/matches/:id/replay 一致。
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { resolveOrigin, rewriteOrigin } = require('../lib/originRewrite');

const CLIENT_DIR = path.join(__dirname, '..', '..', 'client');

const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** 注入 <script> 的字符串：转义 `<`，否则名字里的 </script> 会截断脚本块 */
const jsString = (s) => JSON.stringify(String(s)).replace(/</g, '\\u003c');

/**
 * 把对阵信息注入已重写 origin 的 arena.html。
 * @param {string} html 已做 origin 替换的页面
 * @param {object} replay getMatchReplay 的返回值
 * @param {string} origin 请求 origin
 * @param {string} matchId
 */
function renderMatchPage(html, replay, origin, matchId) {
  const a = replay.agentA?.name || '?';
  const b = replay.agentB?.name || '?';
  const outcome = replay.winner === 'A' ? `${a} wins`
    : replay.winner === 'B' ? `${b} wins` : 'draw';
  const title = `${a} vs ${b} — Token Wars arena`;
  const desc = `${replay.ticks || 0} ticks · ${replay.track || 'arena'} · ${outcome}. Replay this AI-agent match frame by frame.`;
  const url = `${origin}/m/${matchId}`;

  const tags = [
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(desc)}">`,
    `<meta property="og:url" content="${escapeHtml(url)}">`,
    `<meta name="twitter:title" content="${escapeHtml(title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(desc)}">`,
    `<link rel="canonical" href="${escapeHtml(url)}">`,
    `<script>window.__TW_MATCH__ = ${jsString(matchId)};` +
      `document.addEventListener('DOMContentLoaded', function () { document.title = ${jsString(title)}; });</script>`,
  ].join('\n  ');

  // 同名 meta 后出现的为准：追加到 </head> 前即覆盖模板里的通用 OG。
  // /m/<id> 下相对路径会解析成 /m/arena.js，脚本必须改成绝对路径。
  return html
    .replace('src="arena.js"', 'src="/arena.js"')
    .replace('</head>', `  ${tags}\n</head>`);
}

function makeMatchShareRouter({ aiarena }) {
  const router = express.Router();

  router.get('/:matchId', (req, res, next) => {
    const replay = aiarena.getMatchReplay(req.params.matchId);
    if (!replay) {
      return res.status(404).type('html').send(
        '<!doctype html><meta charset="utf-8"><title>Match not found</title>' +
        '<p style="font-family:monospace">Match not found. <a href="/arena">Back to the arena</a></p>'
      );
    }
    const origin = resolveOrigin(req);
    if (!origin) return next();
    fs.readFile(path.join(CLIENT_DIR, 'arena.html'), 'utf8', (err, html) => {
      if (err) return next(err);
      res.type('html').send(renderMatchPage(rewriteOrigin(html, origin), replay, origin, req.params.matchId));
    });
  });

  return router;
}

module.exports = { makeMatchShareRouter, renderMatchPage };
