# 阶段 1：外部 Agent 接入协议 — 提案

## Why

愿景白皮书（`docs/ai-arena-vision.md`）将 Token Wars 定位为「AI 大模型行业的
F1」，三赛道中**车手组（Agent）的核心前提是「带你的 agent 来参赛」**。当前
`AIArenaManager` 的 agent 全部由内置权重脚本驱动（`AIAgent.getWeight` +
`simulateMatch` 内联决策），无任何外部接入通道——这是愿景的根缺口。

竞品调研（白皮书 §10）确认：MCP Arena / ARC-AGI-Arcade 已验证「外部 agent 经
标准协议参赛」可行；且全场无人建立 parity 度量体系（延迟/token 成本/申报抽查）。
本变更交付最小可用闭环：**外部 agent 能连上来、能打一场、延迟与成本被计量**。

## What Changes

- **接入协议（新）**：Socket.IO `/bot` 命名空间，JSON 消息协议
  （match_invite / state / action / match_end），版本化 schema。
- **异步对局 runner（新）**：`ExternalMatchRunner` 逐 tick 推送状态、等待动作、
  强制执行决策截止时间；超时降级为 idle，连续超时判负。
- **决策点抽象（重构）**：把 `simulateMatch` 内联的权重决策提取为
  `BuiltinBrain`（行为零变化），外部 agent 走 `ExternalBrain`（socket 往返 +
  计量）。内置 vs 内置对局保持同步瞬时模拟，现有测试不回归。
- **parity 计量（新）**：服务端计时决策延迟（P50/P99 纳入对局结果）；agent
  自报 token 消耗，超预算动作被拒；决策 trace 进 match log（遥测基础）。
- **Bot 认证（新）**：`POST /api/bot/token`（JWT 保护）签发 bot token；bot 经
  socketAuth 同款握手接入 `/bot`；token 持久化于 player 记录。

## Impact

- 新增：`server/game/BotProtocol.js`（schema+校验）、`server/game/ExternalMatchRunner.js`、
  `server/game/BuiltinBrain.js`、`server/routes/bot.js`、`test/bot-protocol.test.js`
- 修改：`shared/constants.js`（bot EVENTS + 协议常量）、
  `server/game/AIArenaManager.js`（决策提取 + runner 接入 + 外部匹配排队）、
  `server/plugins/aiarena/index.js`（bot 命名空间装配）、
  `server/models/Player.js`（botToken 持久化 + fromSave 默认）、
  `server/index.js`（bot 路由挂载）
- 不波及：战斗数值、协处理器、经济系统、PvE/PvP 插件

## Out of Scope（后续阶段）

- MCP 适配器（协议已按 MCP 可映射设计，适配器留待阶段 1.5）
- 外部 agent 进入 Peak Tournament / 排行榜混合排名
- 参赛方 Web 控制台 / 直播观战（阶段 3）
- 硬件赛道（动力单元组）与模型赛道（底盘组）建设（阶段 2）
- 模型规格申报抽查机制（仅预留 token 计量接口）
