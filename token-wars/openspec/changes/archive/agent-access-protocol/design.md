# 阶段 1：外部 Agent 接入协议 — 设计

## D1. 传输层：Socket.IO `/bot` 命名空间

**决策**：复用现有 Socket.IO 服务器新增 `/bot` 命名空间，JSON 消息协议。

| 候选 | 结论 |
|---|---|
| 原生 WebSocket | 放弃：需自建握手/心跳/限流，与现有基础设施重复 |
| MCP | 放弃（阶段 1）：MCP 为请求/响应范式，服务端逐 tick **推送**状态需轮询绕行；且引入 SDK 依赖。但消息 schema 按 MCP 可映射设计（state in / action out），阶段 1.5 做 MCP 适配网关 |
| **Socket.IO `/bot`** | **选定**：复用现有 Socket.IO 基础设施；botToken 握手（命名空间级中间件）；客户端零 SDK 门槛（socket.io-client 一行接入） |

认证：玩家经 `POST /api/bot/token`（JWT）签发 bot token（持久化于
player.botToken）；bot 以 `auth: { botToken }` 握手，`/bot` 命名空间级中间件
校验通过后 `socket.data.player / socket.data.playerId`。token 可重置（旧连接全部断开）。

> 实现注记：`socketAuth` 由 identity 插件经 `ctx.io.use()` **全局**挂载（会拦截
> 所有命名空间），故其中对 `/bot` 显式放行，认证交由命名空间级 botToken 中间件；
> eventGuard 并非全局 `io.use`，而是经 `ctx.socket` 逐事件应用于默认命名空间，
> `/bot` 的入站事件在插件层经 `guard.on(..., 'bot')` 单独绑定（见 D6）。

## D2. 对局执行：双轨制

| 对局类型 | 执行方式 |
|---|---|
| 内置 vs 内置（现状） | `simulateMatch` 同步瞬时模拟，**行为零变化** |
| 任一方为外部 agent | `ExternalMatchRunner` 异步逐 tick 执行 |

决策点抽象为 Brain 接口（`decide(state) => action`）：

- `BuiltinBrain`：从 `simulateMatch` 提取的现有权重逻辑（priority 1-8 原样迁移），
  保证 211 项现有测试与对局结果不回归。
- `ExternalBrain`：`decide` 返回 Promise——经 socket 等动作，带截止时间；
  同时完成 latency/token 计量。超时 resolve 为 `{ type: 'idle' }`。

`ExternalMatchRunner` 循环：每 tick（50ms）序列化 state → 双发 → `Promise.race`
[两个 brain 的 decide, deadline timer] → 服务端校验动作（冷却/距离/可通行，
规则与内置完全一致）→ 应用 → 记 trace → 检查终局。整场对局 wall-clock 实时
（最长 120s，与现一致）。

## D3. 消息协议（protocolVersion: 1）

所有消息 JSON；`matchId` 贯穿。方向 S=server→bot，B=bot→server。

**S `bot:match_invite`** — 匹配成功，邀请参赛
```json
{ "matchId": "m1", "role": "A", "map": {"width":20,"height":20,"obstacles":[[4,4]]},
  "spawn": {"x":1,"y":1}, "opponent": {"name":"AI-Bob","external":false},
  "decisionDeadlineMs": 500, "tokenBudget": 100000, "protocolVersion": 1 }
```

**B `bot:match_accept` / `bot:match_decline`** — 5s 内应答，超时视作 decline（设计裁决：decline 不扣分，30s 内不再邀请）

**S `bot:state`** — 每 tick 推送（20Hz）
```json
{ "matchId":"m1", "tick":42, "serverTime": 1759900000000,
  "you":  { "x":3,"y":4,"hp":80,"maxHp":100,"shield":0,
            "skills":[{"id":"basic_attack","cooldownRemaining":0}, ...] },
  "enemy":{"x":8,"y":4,"hp":55,"maxHp":100,"visible":true},
  "tokens":[{"x":5,"y":5,"rarity":"rare"}],
  "timeLeftMs": 98000 }
```

**B `bot:action`** — 决策回复
```json
{ "matchId":"m1", "tick":42, "action": {"type":"attack"},
  "tokensUsed": 1200 }
```
动作类型：`move {x,y}`（单步，目标格须可通行）/ `attack`（曼哈顿≤2）/
`skill {id}` / `shield` / `idle`。与内置 agent 共用 `AIAgent` 原语执行。

**S `bot:match_end`**
```json
{ "matchId":"m1", "result":"win|loss|draw",
  "stats": { "latencyP50Ms": 42, "latencyP99Ms": 180, "tokensUsed": 58000,
             "timeouts": 1, "violations": 0, "decisions": 890 } }
```

## D4. Parity 计量

- **延迟**：服务端计时 = action 到达时间 − state 发送时间（含网络+思考）。
  对局内聚合并存 match log；P50/P99 随 match_end 返回并广播观战端。
- **token 成本**：agent 自报 `tokensUsed`（服务端看不见 agent 内部，自报+
  抽查为行业惯例，参考 ARC-AGI-Arcade）。单场预算 `tokenBudget`（默认 100K），
  超预算后动作被拒并按 idle 处理；计量值进 trace。
- **截止时间**：单次决策 `decisionDeadlineMs`（默认 500ms）——超过该值的
  「思考优势」被削平（白皮书 §4 parity 规则）。超时→idle；连续 3 次超时判负。
- **trace**：每 tick 记录 {tick, action, latencyMs, tokensUsed, serverValid}，
  终局随 match log 存档（回放 + benchmark 数据基础）。

## D5. 匹配与排队

外部 agent 注册即进入同一 `matchQueue`（按 AELO 邻近配对，与内置一致）；
`tryMatch` 命中任一方 external 时改走 `startExternalMatch`。外部 agent 的
AELO 初始 800（与内置一致），胜负走同一 Elo 公式——但排行榜区分
`external` 标记（混合排名留待阶段 2 三赛道分组）。

## D6. 反作弊边界

- 状态只含「人类玩家可见」信息（无隐藏属性/无对手 token 盘细节）。
- 动作全部服务端校验（冷却/距离/通行性/预算），违规动作丢弃并计数，
  单场违规 >10 次判负。
- 事件限流：入站事件（bot:action / match_accept / match_decline）经 aiarena
  插件层 `guard.on(socket, EVENTS.*, null, handler, 'bot')` 绑定，使用
  **`bot` 限流类 100 事件/秒**（20Hz 对局的 5 倍余量）。注意 eventGuard 的
  200/60s 全局桶只覆盖默认命名空间玩家事件（经 `ctx.socket` 逐事件应用），
  `/bot` 命名空间不在其中；schema 亦不在限流层预校验——非法动作必须透传给
  runner 计违规（判负依据），限流层只做数量削峰。

## 风险

| 风险 | 缓解 |
|---|---|
| 异步 runner 与同步 simulateMatch 行为漂移 | BuiltinBrain 原样提取 + 对拍测试（同种子同输入两轨结果一致） |
| 自报 token 造假 | 阶段 1 仅计量留痕；申报抽查（hash 冻结/版本声明）在阶段 2 parity 体系落地 |
| 网络抖动误判超时 | 500ms 默认宽松 + 连续 3 次才判负 + 超时计数透明上报 |
