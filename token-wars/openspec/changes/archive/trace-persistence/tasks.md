# 对局遥测 Trace 持久化 — 任务

- [x] T1 `Store.js`：`ai_matches` 表（构造器 `db.exec` 建表）+ `saveMatch(entry)`（upsert、失败返 false 不抛）/ `loadMatches(limit)`（saved DESC、坏行跳过）/ `pruneMatches(keep)`（保最新 keep 行）
- [x] T2 `AIArenaManager`：`resolveMatch` 入 history 后 write-through 落库 + `pruneMatches(maxHistoryLength)`；构造器 `_restoreMatches()` 恢复最近 1000 场（旧→新入 matchHistory）
- [x] T3 `test/trace-persistence.test.js`：落库+同库新 Store 读回完整（trace/stats/playerIds）；新 AIArenaManager 恢复后 getMatchTrace/sendReplay 语义不变；prune 裁剪；坏行容错；store 关闭安全；builtin 对局落库后 [] + stats null 不变（10 项全绿）
- [x] T4 `docs/bot-protocol.md` §7「内存上限」改持久化说明 + §10 阶段规划更新（另修 `ai-arena-vision.md` 现状表两格）；tasks.md 勾选
- [x] T5 全量测试 + 提交推送 + openspec change 归档
