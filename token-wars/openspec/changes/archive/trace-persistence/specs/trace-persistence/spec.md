# 对局遥测 Trace 持久化 — 能力规约

## 核心要求

1. **重启存活**：对局终局的 trace/stats/归属记录落 SQLite，服务重启后经
   `getMatchTrace` / `getAgentMatches` / `sendReplay` 查询的结果与重启前一致
   （恢复最近 1000 场，与内存 cap 同界）。
2. **交易点写穿**：终局入 history 即落库（write-through）；单条落库失败不
   阻塞对局流程，仅记录错误日志。
3. **语义不变**：持久化对查询层透明——恢复条目与内存条目同构，归属校验、
   `?side` 过滤、`result` 视角、内置对局 `trace: []` + `stats: null` 兜底
   全部不变。

## 存储

- `ai_matches` 表：`id`（主键）/ `data`（matchHistory 条目 JSON）/ `saved`
  （时间戳，排序裁剪用）；`Store` 构造器自动建表（`IF NOT EXISTS`）。
- 保留上限与 `AIArenaManager.maxHistoryLength` 同为 1000：超限旧行在每次
  落库后裁剪。

## 恢复

- `AIArenaManager` 构造时恢复：最近 1000 场按旧→新顺序载入 `matchHistory`。
- 坏行（非法 JSON）跳过并记日志，不阻断其余恢复。
- `Store` 已关闭时读写接口安全返回空/false，不抛。
