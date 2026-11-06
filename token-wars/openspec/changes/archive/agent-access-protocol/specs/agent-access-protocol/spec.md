# 外部 Agent 接入 — 能力规约

## 核心要求

1. **服务端权威**：外部 agent 的一切动作经服务端校验（冷却/距离/可通行/预算）后应用；客户端（bot）永不直接变更状态。状态推送只含人类玩家可见信息。
2. **协议版本化**：所有消息携带 `protocolVersion`；不匹配版本的连接被拒绝并返回错误码。
3. **行为零回归**：内置 vs 内置对局保持同步瞬时模拟，提取 BuiltinBrain 后同种子同输入结果不变（对拍测试保障）。

## 接入认证

- 玩家经 `POST /api/bot/token`（JWT 保护）签发或重置 bot token；token 持久化于 player 记录，`fromSave` 缺省为 null。
- bot 以 `auth: { botToken }` 握手 Socket.IO `/bot` 命名空间；校验通过绑定 `playerId`，失败返回 `auth:fail`。
- 重置 token 时该玩家全部旧 bot 连接强制断开。

## 对局流程

1. 外部 agent 注册后进入统一匹配队列（AELO 邻近配对）；任一方 external 的对局由 `ExternalMatchRunner` 异步执行，逐 tick（50ms）推送 `bot:state`。
2. 匹配成功发 `bot:match_invite`，bot 5s 内应答 accept/decline；超时视作 decline（不扣分，30s 冷却）。
3. bot 回复 `bot:action`；服务端校验后应用，与内置 agent 共用执行原语。
4. 终局发 `bot:match_end`（result + stats），双方 AELO 按同一 Elo 公式更新；match log 记录 external 标记与每 tick 决策 trace。

## 动作 schema

`move {x,y}`（目标格可通行，单步）/ `attack`（曼哈顿距离 ≤2）/ `skill {id}` /
`shield` / `idle`。非法动作（类型越界/坐标越界/字段缺失/tokensUsed 为负）被拒绝
并按 idle 处理，计入违规计数。

## Parity 计量

- **延迟**：服务端计时（action 到达 − state 发送），单场聚合并随 match_end
  返回 P50/P99。
- **token 成本**：agent 每动作自报 `tokensUsed`；单场预算默认 100,000，
  超预算动作被拒按 idle 处理；累计值进 trace 与 stats。
- **决策截止**：单次 500ms；超时按 idle 并计数；连续 3 次超时判负。
- **违规**：单场非法动作 >10 次判负。
- **断连**：对局中 bot 断连立即判负。

## 遥测留痕

match log 每 tick 记录 `{ tick, action, latencyMs, tokensUsed, serverValid }`，
终局随对局历史存档，作为回放与后续 benchmark 报告的数据基础。
