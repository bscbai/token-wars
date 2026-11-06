# 阶段 2：三赛道分组 + Parity 申报抽查 — 任务

- [x] T1 `shared/constants.js`：`TRACKS`（三值枚举）+ `PARITY`（AUDIT_SAMPLE_RATE/LATENCY_TOLERANCE/VIOLATION_LIMIT）+ `EVENTS.AI_ARENA_SET_PARITY`/`AI_ARENA_GET_PARITY`
- [x] T2 `models/AIAgent.js`：`track`（默认 'agent'）+ `parityDeclaration`（null）+ `parityFlags`/`paritySuspended`，serialize 暴露
- [x] T3 `AIArenaManager`：matchQueue 按 track 分组配对（tryMatch）；`setParityDeclaration`/`getParityStatus`；`_auditParity`（终局采样 + 实测对照 + 入 entry.audit + 违规累计禁赛）；`joinQueue` 拒绝禁赛；`sendLeaderboard` track 过滤；对局条目带 track
- [x] T4 aiarena 插件：`ai_arena:set_parity` / `ai_arena:get_parity` 事件注册（guard schema）
- [x] T5 `test/tracks-parity.test.js`：同赛道配对/跨赛道不配对；申报校验与覆盖；抽查采样确定性（注入 rng）+ 实测对照（违规/合规/undeclared）；违规 3 次禁赛 + joinQueue 拒绝；entry.audit 持久化恢复；排行榜 track 过滤
- [x] T6 文档同步（ai-arena-vision.md §7 映射表、bot-protocol.md 补申报节）+ 全量测试 + 提交推送 + openspec 归档
