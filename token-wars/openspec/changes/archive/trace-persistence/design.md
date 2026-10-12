# 对局遥测 Trace 持久化 — 设计

## D1. 存储介质：SQLite `ai_matches` 表（与 players 同库）

```sql
CREATE TABLE IF NOT EXISTS ai_matches (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,   -- matchHistory 条目整体 JSON
  saved INTEGER         -- Date.now()，排序/裁剪用
);
```

- **行 = matchHistory 条目整体 JSON**（含 trace/stats/log/agentAPlayerId/
  agentBPlayerId/mapData/winner/AELO），不拆列——查询面（getMatchTrace /
  getAgentMatches / sendReplay）读的就是这个形状，恢复后零适配。
- 表建在 `Store` 构造器的 `db.exec` 里（与 players 同批，`IF NOT EXISTS`，
  旧库自动补表，无迁移步骤）。
- 不做玩家/agent 分列索引：当前查询全走内存 history；benchmark 报告（阶段 4）
  的聚合查询形态定了再加列/索引，避免现在猜。

## D2. 写路径：resolveMatch 交易点 write-through

对局终局（`resolveMatch` 入 history 后）立即 `store.saveMatch(entry)`：

- 与 `Store.persist(player)` 同属**交易点**语义——丢一条 match 记录 = 抹掉
  一份遥测证据（trace 是 parity/benchmark 的数据基础）。
- 失败处理与 player 不同：**不进 dirty 集重试**。原因：match 记录无「授予
  物品丢失」式的公平性损失，且 dirty 集是按 playerId 的玩家通道；失败仅
  `logger.error` 记录（`saveMatch` 返回 false 不抛），对局流程不受影响。

## D3. 读路径：构造时恢复

`AIArenaManager` 构造器末尾 `_restoreMatches()`：`store.loadMatches(maxHistoryLength)`
按 `saved DESC` 取最近 N 条，倒序推入 `matchHistory`（保持旧→新的 push 顺序）。

- 恢复条目与内存条目同构（JSON round-trip 纯数据），`getMatchTrace` /
  `getAgentMatches` / `sendReplay` / `_ownsMatch` 语义不变。
- 无字段兜底问题：旧条目缺 `trace`/`stats` 时查询层已兜底
  （`match.trace || []`、`match.stats || null`），恢复不伪造。
- 构造器恢复 vs 显式 load()：全部 4 个 `new AIArenaManager` 调用点都持真实
  Store（3 测试 + 1 插件），无 mock store 场景；构造时恢复最少移动部件，
  且与 Store 构造器自身开库建表的既有风格一致。

## D4. 保留策略：内存与库同 cap 1000

- `maxHistoryLength = 1000`（既有内存 cap）同时作为库保留上限：
  每次 saveMatch 后 `pruneMatches(maxHistoryLength)` 删旧行
  （`ORDER BY saved DESC, rowid DESC LIMIT keep` 之外全删）。
- 单 cap 简单可预期；如 benchmark 需要更长保留窗口，届时改保留策略为独立
  参数（那是阶段 4 的需求，现在不做）。

## D5. 兼容与容错

- `loadMatches` 逐行 `JSON.parse`，坏行跳过 + 日志，不阻断恢复（与
  `Store.load()` 解析 player 行的容错一致）。
- `saveMatch`/`pruneMatches` 在 `isOpen` 为假时安全返回，不抛。
- 存量开发库：旧 match 只在内存，无数据可迁，自然过渡。

## 风险

| 风险 | 缓解 |
|---|---|
| 行体积：满 tick 对局 ~4800 trace 条 ≈ 数百 KB/行，1000 行最坏数百 MB | cap 裁剪 + 典型对局远小于此；体积成问题时再引入 trace 子表压缩 |
| 坏 JSON 行阻断恢复 | 逐行容错跳过 + 日志（D5） |
| 落库失败丢遥测 | 返回 false + error 日志；不阻塞对局（D2 权衡已明示） |
