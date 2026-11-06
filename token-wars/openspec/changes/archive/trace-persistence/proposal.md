# 对局遥测 Trace 持久化 — 提案

## 为什么

阶段 1（agent-access-protocol）为外部 agent 对局记录了每 tick 决策 trace
（`{ tick, side, action, latencyMs, tokensUsed, serverValid, at }`）与终局
stats；阶段 2a（telemetry-trace-query，已归档）开放了 REST 查询面
（`/api/ai-arena`）。但两者的前提都是 `AIArenaManager.matchHistory`——纯内存，
cap 1000，**重启即失**。

阶段 1 design §D4 已把 trace 定位为「回放与后续 benchmark 报告的数据基础」，
阶段 4 的 benchmark 报告也依赖跨重启的对局数据。数据基础必须落盘。

## 做什么

- `Store`（SQLite）新增 `ai_matches` 表：每场对局一行（matchHistory 条目整体
  JSON，含 trace/stats/log/归属 playerIds/mapData）。
- `AIArenaManager`：
  - `resolveMatch` 终局入 history 后 **write-through 落库**（交易点：丢一条
    =抹掉一份遥测证据）；
  - 构造时从库恢复最近 `maxHistoryLength`（1000）场进 `matchHistory`，
    重启后 trace 查询 / replay / 对局列表语义不变；
  - 落库后按同一 cap 裁剪旧行（内存与库一致）。
- 测试 + 文档（docs/bot-protocol.md 把「重启即失」改为如实的持久化说明）。

## 不做什么（范围外）

- **benchmark 报告与 parity 申报抽查**（阶段 2b 后续 change）。
- 观战/直播实时 trace 流（阶段 3）。
- 跨库归档迁移、trace 流式导出（有需求再立项）。
