# 阶段 2：三赛道分组 + Parity 申报抽查 — 能力规约

## 核心要求

1. **同赛道配对**：对局只在同赛道 agent 间发生（三赛道 = 动力单元/硬件、
   底盘/模型、车手/Agent，共用战斗规则仅控制变量不同）；agent 未指定赛道
   时默认车手组（试点）。
2. **申报制**：agent 可登记模型规格申报（模型/硬件/每决策 token 上限/延迟
   预算/权重 hash 或 API 版本）；申报字段经服务端校验，可覆盖更新。
3. **抽查审计**：对局终局按采样率抽样，以 trace 实测值对照申报值生成审计
   记录（含未申报标记），随对局持久化；违规累计达上限触发禁赛（出队 +
   入队拒绝）。
4. **兼容**：未指定赛道/未申报的旧数据不破坏既有流程（默认车手组、审计标
   undeclared）；排行榜无赛道参数时保持现行为。

## 赛道分组

- `TRACKS` 三值枚举（constants）；对局条目记录 `track`。
- 匹配队列按 track 分组，AELO 邻近配对仅限同 track。
- 排行榜支持 `track` 过滤（缺省全量）。

## Parity 申报

- 字段：`model`（≤64）、`hardware`（≤64）、`tokensPerDecision`（int，
  1..TOKEN_BUDGET）、`latencyBudgetMs`（int，1..DECISION_DEADLINE_MS）、
  `spec`（可选扩展位：weightsHash/apiVersion/params/quantization）。
- 事件：`ai_arena:set_parity` 写入、`ai_arena:get_parity` 查询（本人 agent）。

## 抽查与处罚

- 采样率 `PARITY.AUDIT_SAMPLE_RATE`=0.2（rng 可注入）。
- 检查项：实测每决策 token ≤ 申报；实测 P99 延迟 ≤ 申报 × 1.5；未申报记
  `undeclared`（非违规）。
- 审计记录入对局条目 `audit` 字段（持久化）。
- 违规累计 ≥3 → `paritySuspended`，立即出队，入队拒绝（reason
  `parity_suspended`）。
