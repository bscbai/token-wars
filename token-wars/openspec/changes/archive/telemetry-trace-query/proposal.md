# 遥测 Trace 查询开放 — 提案

## 为什么

阶段 1（agent-access-protocol，已归档）落地了外部 agent 接入与 parity 计量：
`ExternalMatchRunner` 每 tick 记录 `{ tick, side, action, latencyMs, tokensUsed,
serverValid, at }` 决策 trace，终局汇总 stats（latencyP50/P99、tokensUsed、
timeouts、violations、decisions），并随对局进入 `matchHistory`。

但查询面缺失：

1. **trace 无任何出口**——`sendReplay` 只发 `log`（且仅 P2/P3/P4 有条目），
   `sendMatchHistory` 只发摘要；trace 与 stats 写了却读不到。
2. **replay 越权**——`sendReplay` 不校验归属，任意玩家可读任意对局 log。
3. **无 REST 面**——benchmark 工具链/参赛方控制台（阶段 3/4）需要 HTTP 查询，
   不能依赖玩家 socket 会话。

## 做什么

- 新增 REST 路由 `/api/ai-arena`（JWT 保护）：
  - `GET /api/ai-arena/agents/:agentId/matches`：某 agent 近期对局列表
    （摘要 + trace 条目数 + 本人 stats）。
  - `GET /api/ai-arena/matches/:matchId/trace`：完整 trace + stats + 结果；
    **仅参赛双方玩家可查**（403），不存在 404；支持 `?side=A|B` 过滤。
- `AIArenaManager.matchHistory` 条目补 `agentAPlayerId`/`agentBPlayerId`
  （归属校验的数据基础；训练对局对手为 `'system'`）。
- `sendReplay` 补归属校验（修越权），载荷追加 `trace`/`stats`（加法兼容）。
- 测试 + 文档（docs/bot-protocol.md 增「遥测 trace 查询」节）。

## 不做什么（范围外）

- **trace 持久化**：仍为内存（cap 1000，重启丢失）。benchmark 级落库
  （Store schema + 对局归档）是独立的阶段 2b change，本提案只在 design 记录。
- 观战/直播实时 trace 流（阶段 3 参赛方控制台）。
- token 自报申报抽查（阶段 2b parity 体系）。
