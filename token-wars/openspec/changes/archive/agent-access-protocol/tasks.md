# 阶段 1：外部 Agent 接入协议 — 任务

- [x] T1 constants.js：新增 `bot:*` EVENTS（match_invite/match_accept/match_decline/state/action/match_end/disconnect）+ `BOT_PROTOCOL` 常量（PROTOCOL_VERSION=1、DECISION_DEADLINE_MS=500、DECISION_TIMEOUT_LIMIT=3、TOKEN_BUDGET_DEFAULT=100000、MATCH_ACCEPT_TIMEOUT_MS=5000）
- [x] T2 `server/game/BotProtocol.js`：state/action/invite 序列化 + 校验（动作类型枚举、坐标范围、tokensUsed 非负整数、protocolVersion 检查），非法返回错误码
- [x] T3 `server/game/BuiltinBrain.js`：从 AIArenaManager.simulateMatch 提取 priority 1-8 权重决策为 `decide(state)`，AIArenaManager 内置对局改调 BuiltinBrain（行为零变化）
- [x] T4 `server/game/ExternalMatchRunner.js`：异步逐 tick 循环（state 推送 → race[brain.decide, deadline] → 服务端校验 → 应用 → trace → 终局判定），超时 idle/连续 3 次判负/超预算拒动作/违规>10 次判负
- [x] T5 `ExternalBrain`：socket 往返 + latency/token 计量 + 断连处理（判负）
- [x] T6 AIArenaManager：tryMatch 命中 external 走 startExternalMatch；外部 agent AELO 初始 800、同一 Elo；match log 增 external 标记与 stats；match_end 广播带 latencyP50/P99
- [x] T7 Player.js：`botToken` 持久化字段 + fromSave 默认 null
- [x] T8 `server/routes/bot.js` + index.js 挂载：`POST /api/bot/token`（JWT）签发/重置 botToken 并踢旧连接；`GET /api/bot/protocol` 返回协议 schema（参赛方接入文档）
- [x] T9 aiarena 插件：`/bot` 命名空间装配（socketAuth 同款 botToken 握手、join matchId 房间、accept/decline/action/disconnect 路由到 runner）
- [x] T10 `test/bot-protocol.test.js`：schema 校验用例；BuiltinBrain 对拍（提取前后同种子结果一致）；ExternalMatchRunner 流程（mock bot socket：正常对局/超时 idle/连续超时判负/超预算/违规判负/断连判负）；latency/token 计量正确性
- [x] T11 全量测试 + 烟雾（/health 200 + bot token 签发 + mock bot 打满一场）
- [x] T12 `docs/bot-protocol.md`：参赛方接入指南（连接、消息、示例代码 Python/JS）

## 完成情况（2026-10-10）

- 全量测试 **241/241 绿**（17 文件 = 基线 211 + 新增 `test/bot-protocol.test.js` 30 项）。
- 烟雾：真实服务器起 `/bot` 双 mock bot，邀请应答 → 20Hz state → A 击杀获胜，
  match_end 统计齐全（p50=1ms、tokens=612、decisions=204、violations=0）。
- 实现注记（与 design.md 差异，已在 D1/D6 修订）：
  - `socketAuth` 全局 `io.use` 会拦截 `/bot`，其中对 `/bot` 放行，认证交命名空间级 botToken 中间件；
  - 入站事件在 aiarena 插件层经 `guard.on(..., 'bot')` 绑定，限流为 `bot` 类 100 事件/秒；
  - BuiltinBrain 对拍取证用记录型 brain 包装器（match.log 仅 P2/P3/P4 有条目，decide 动作序列才是完整证据）；
  - P7/P8 在 else-if 链中不可达（提取前即如此，git diff 可证）→ BuiltinBrain 不消费 Math.random，种子无关。
