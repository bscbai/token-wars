# 阶段 2：三赛道分组 + Parity 申报抽查 — 设计

## D1. 赛道模型：三值枚举 + 同赛道配对

- `shared/constants.js` 新增 `TRACKS = { HARDWARE, MODEL, AGENT }`（id /
  中文名 / 控制变量说明，白皮书 §3 原文浓缩）。
- `AIAgent.track`：创建时指定，默认 `'agent'`（车手组 = 白皮书 §9 建议的
  首个试点赛道）。
- **匹配**：`matchQueue` 升级为按 track 分组的配对——`tryMatch` 只在同
  track 队列内取 2 个 AELO 邻近者；跨赛道永不配对（控制变量是赛道定义本身）。
- **对局条目**：`matchHistory` 条目加 `track`（随 ai_matches 持久化，恢复后
  可按赛道筛）；`getAgentMatches` 返回值带 track。
- **排行榜**：`sendLeaderboard(playerId, { track })` 可选过滤；无 track 参数
  保持现行为（全量，兼容旧客户端）。

## D2. 申报模型：结构化 spec + 服务端校验

`parityDeclaration = {
  model,            // 模型名（≤64）
  hardware,         // 硬件/部署方案（≤64，动力单元组核心变量）
  tokensPerDecision,// 每决策 token 上限（int > 0，≤ BOT_PROTOCOL.TOKEN_BUDGET）
  latencyBudgetMs,  // 单决策延迟预算 ms（int > 0，≤ BOT_PROTOCOL.DECISION_DEADLINE_MS）
  spec: {},         // 可选：weightsHash（开源）/ apiVersion（闭源）/ params / quantization
  at,               // 申报时间（服务端记）
}`

- 经 `ai_arena:set_parity`（guard schema 校验 + 业务校验双层）写入 agent；
  `ai_arena:get_parity` 返回本人 agent 申报与审计状态。
- 申报可重复提交（覆盖 + 更新 `at`）。

## D3. 抽查审计：终局采样 + 实测对照 + 违规累计禁赛

- `resolveMatch` 后按 `PARITY.AUDIT_SAMPLE_RATE`（0.2）采样（`options.rng`
  可注入，测试确定性；默认 `Math.random`）。
- 审计项（对被采样方的 agent 逐个执行，数据源 = 该场 trace/stats）：
  1. `tokensPerDecision`：实测 `stats.tokensUsed / decisions` ≤ 申报值；
  2. `latencyBudgetMs`：实测 `stats.latencyP99Ms` ≤ 申报值 × `LATENCY_TOLERANCE`（1.5）；
  3. 未申报：`parityDeclaration` 为空 → 记 `undeclared`（提示，不算违规）。
- 审计记录 `{ agentId, checks, violations, at }` 并入该场 match entry
  （`audit` 字段，随 trace 一起持久化/恢复——审计证据即遥测证据）。
- **处罚**：`violations` 非空累计进 `agent.parityFlags`；≥ `PARITY.VIOLATION_LIMIT`（3）
  → `agent.paritySuspended = true` + 立即出队；`joinQueue` 拒绝
  （reason `parity_suspended`）。禁赛不自动解除（阶段 3 赛事运营做申诉/解禁）。

## D4. 事件面

- `EVENTS.AI_ARENA_SET_PARITY`（payload：agentId + 申报字段）/ 
  `EVENTS.AI_ARENA_GET_PARITY`（payload：agentId）——经 aiarena 插件
  `ctx.socket` 注册（'economy'/'query' 类），schema 与既有 ai_arena:* 同范式。

## D5. 兼容与默认

- 新字段全部有默认：旧 agent（无 track/申报）等价 `track: 'agent'`、
  未申报；对局流程零回归（未申报仍可对局）。
- 现有 AELO/赛季/锦标赛逻辑不动（按赛道的独立积分池是阶段 3 的事）。

## 风险

| 风险 | 缓解 |
|---|---|
| 强制申报破坏既有测试/用户体验 | 申报非门槛（D5），收紧留后续（proposal 范围外明示） |
| 审计误报（延迟抖动） | P99 × 1.5 容差；违规达 3 次才禁赛 |
| 赛道分组后单赛道样本少 | 默认全进车手组试点（白皮书 §9 裁决），无碎片化 |
