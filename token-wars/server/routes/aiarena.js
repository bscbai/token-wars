/**
 * aiarena 路由 — 遥测 trace 查询（阶段 2a，openspec/changes/telemetry-trace-query）
 *
 *   GET /api/ai-arena/agents/:agentId/matches   某 agent 近期对局列表（仅本人）
 *   GET /api/ai-arena/matches/:matchId/trace    完整 trace + stats（仅参赛双方，?side=A|B 过滤）
 *
 * 归属校验在 AIArenaManager（history 条目带 agentAPlayerId/agentBPlayerId）；
 * 本文件只做 JWT 认证与错误码映射。REST 层不限流（与既有 REST 路由一致）。
 */

'use strict';

const express = require('express');

function makeAiarenaRouter({ aiarena, verifySession }) {
  const router = express.Router();

  const authenticate = (req) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return { status: 401, body: { error: 'No session token' } };
    const player = verifySession(token);
    if (!player) return { status: 401, body: { error: 'Invalid session' } };
    return { player };
  };

  // GET /api/ai-arena/agents/:agentId/matches
  router.get('/agents/:agentId/matches', (req, res) => {
    const auth = authenticate(req);
    if (auth.status) return res.status(auth.status).json(auth.body);

    const result = aiarena.getAgentMatches(auth.player.id, req.params.agentId);
    if (result.error === 'forbidden') return res.status(403).json({ error: 'Not your agent' });
    res.json(result);
  });

  // GET /api/ai-arena/matches/:matchId/trace
  router.get('/matches/:matchId/trace', (req, res) => {
    const auth = authenticate(req);
    if (auth.status) return res.status(auth.status).json(auth.body);

    const side = ['A', 'B'].includes(req.query.side) ? req.query.side : null;
    const result = aiarena.getMatchTrace(auth.player.id, req.params.matchId, { side });
    if (result.error === 'forbidden') return res.status(403).json({ error: 'Not a participant' });
    if (result.error === 'match_not_found') return res.status(404).json({ error: 'Match not found' });
    res.json(result);
  });

  return router;
}

module.exports = { makeAiarenaRouter };
