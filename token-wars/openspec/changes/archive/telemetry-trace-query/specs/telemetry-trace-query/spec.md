# 遥测 Trace 查询开放 — 能力规约

## 核心要求

1. **归属隔离**：trace 仅参赛双方玩家可查；非参赛方 403，对局不存在 404。
2. **数据保真**：查询返回 runner 原始记录，不重算、不伪造；内置/训练对局
   无 trace 时返回空数组与 null stats，不得以 log 冒充 trace。
3. **服务端权威**：trace 由服务端计量落盘（内存历史），查询只读。

## 查询面

- `GET /api/ai-arena/agents/:agentId/matches`（JWT）：仅本人 agent；
  返回近期对局摘要列表（最近 20 场，新→旧），含 `external`、`traceCount`、
  查询者一侧 `stats`。
- `GET /api/ai-arena/matches/:matchId/trace`（JWT）：参赛双方可查；
  返回 `result`（查询者视角 win/loss/draw）、`stats`（查询者一侧）、
  `trace` 全量或按 `?side=A|B` 过滤。
- 无 JWT / JWT 无效 → 401。

## Replay 兼容

- `ai_arena:replay` 对非参赛方返回 `{ error: 'forbidden' }`。
- 参赛方载荷在既有字段（map/log/totalTicks 等）之上追加 `trace` 与 `stats`；
  既有字段语义不变。

## 边界

- trace 为进程内内存数据（cap 1000 场），重启后历史不可查——持久化
  不在本能力范围。
- 限流：REST 层不限流（与既有 REST 路由一致）；trace 大载荷由 list 端点
  的 traceCount + side 过滤缓解。
