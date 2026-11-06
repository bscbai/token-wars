# 遥测 Trace 查询开放 — 任务

- [x] T1 `AIArenaManager`：matchHistory 条目补 `agentAPlayerId`/`agentBPlayerId`；新增 `getMatchTrace(playerId, matchId, { side })` 与 `getAgentMatches(playerId, agentId)`（含 `_summarizeMatchFor` 复用）；`sendReplay` 补归属校验 + 载荷追加 trace/stats
- [x] T2 `server/routes/aiarena.js`（`makeAiarenaRouter({ aiarena, verifySession })`）+ aiarena 插件 `ctx.route('/api/ai-arena', ...)` 挂载
- [x] T3 `test/telemetry-trace.test.js`：REST 401/403/404/200 + side 过滤 + list 端点归属；getMatchTrace 语义（external 非空 / builtin 空数组 + stats null）；sendReplay 越权拦截与 trace 载荷；history playerIds（12 项全绿）
- [x] T4 `docs/bot-protocol.md` 增「遥测 trace 查询」节（端点 + 响应示例 + Python/JS 片段）；tasks.md 勾选
- [ ] T5 全量测试 + 提交推送 + openspec change 归档
