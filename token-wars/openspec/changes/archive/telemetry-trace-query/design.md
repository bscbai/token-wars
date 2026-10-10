# 遥测 Trace 查询开放 — 设计

## D1. 查询面：REST 优先，socket 复用

| 消费者 | 界面 |
|---|---|
| benchmark 工具链 / 参赛方控制台（阶段 3） | REST `/api/ai-arena`（JWT） |
| 游戏内客户端 | 复用既有 `ai_arena:replay` socket 事件（载荷加法扩展） |

REST 用字面量路径（与 `routes/bot.js`、`routes/player.js` 一致，不入
constants REST map——既有 router 均不读该 map）。入站不走 eventGuard
（REST 路由历来不限流，Express 层即边界）。

## D2. 归属模型：history 条目落 playerId

`matchHistory` 条目现只存 agentId。agent 可能被删（训练对手）或替换，
不能可靠反查玩家。`resolveMatch` 入 history 时补：

```js
agentAPlayerId: agentA.playerId,   // 训练对局对手为 'system'
agentBPlayerId: agentB.playerId,
```

归属判定 = `match.agentAPlayerId === playerId || match.agentBPlayerId === playerId`。

## D3. Trace 语义

- **external 对局**：`match.trace` 非空（ExternalMatchRunner 每 tick 双side 记录），
  `match.stats = { A: {...}, B: {...} }`。
- **内置/训练对局**：无 trace 字段 → 查询返回 `trace: []`、`stats: null`
  （不伪造数据；`log` 仍可经 replay 获取）。
- **查询响应**：`{ matchId, external, result（查询者视角 win/loss/draw）,
  stats（查询者一侧）, traceCount, trace[] }`。
- `?side=A|B` 过滤 trace（大对局 ~4800 条，按侧过滤省流量）；非法值忽略。

## D4. sendReplay 加固（修既有越权）

- 非参赛方 → `ai_arena:replay { error: 'forbidden' }`（原为直接放行）。
- 参赛方载荷追加 `trace`（external 对局）与 `stats`；既有字段不变，
  旧客户端忽略新字段即可（加法兼容）。

## D5. 持久化：显式 defer

内存 cap 1000，重启丢失。阶段 1 design §D4 已声明「trace 终局随对局历史存档」
为 benchmark 数据基础——本提案只开放查询，不建 Store schema。持久化 + 申报
抽查列为阶段 2b（独立 change），避免本次范围膨胀。

## 风险

| 风险 | 缓解 |
|---|---|
| trace 载荷大（2400 tick × 2 侧 ≈ 4800 条） | list 端点只返 traceCount；trace 端点支持 side 过滤 |
| 内存重启丢失 trace | 显式 defer 至 2b；文档明示 |
| 自报 token 造假 | 2b 申报抽查；本提案只做留痕查询 |
