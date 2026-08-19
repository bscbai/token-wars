# Proposal: Plugin Architecture (借鉴 DeepSeek Harness 插件理念)

## Why

Token Wars 当前的服务端是**单体积木**：`server/index.js` 是特权核心，所有游戏系统（Mining/Combat/PvE/PvP/WorldBoss/AIArena）通过构造函数硬连线、手工注册。借鉴 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）的"**一切皆插件**"设计理念（基于 Cordis：插件向共享上下文贡献服务、注册即可逆效应、事件即扩展点、Profile 分层组合），可以在**不重写**的前提下解决四个具体痛点：

| 痛点 | 现状证据 | dsh 对应理念 |
|------|----------|--------------|
| 加一个系统要改 4 处 | 新 Manager 需改 `index.js`（实例化 + `registerPlayer` 里 `registerSocket`×6 + `disconnect` 里 `unregisterSocket`×6）、`GameEngine.js`（tick 分支） | 挂载一个插件即可，无特权核心 |
| 系统无法替换/裁剪 | CombatSystem 是 PvE/PvP/WorldBoss/AIArena 的硬依赖，无法换实现或禁用 | 服务接缝：定义/提供者/消费者三角色，一处替换全局生效 |
| tick 调度硬编码 | `GameEngine.tick()` 内 `tickCount % TICK_RATE === 0 → mining.tick` 等写死 | 插件声明自己的节奏（`ctx.every`） |
| 战斗上下文解析侵入内部 | `index.js` 的 INPUT_SKILL handler 直接读取 `pveManager.playerDungeons`/`pvpManager.playerArenas` 内部 Map | 事件即扩展点：瀑布事件 `combat:resolve-context` |

同时为路线图 Phase 4（PM2 cluster/Redis 多实例）铺路：插件边界即未来的进程/实例拆分边界。桌面内嵌模式（`START_EMBEDDED_SERVER=1`）可跑裁剪组合（无 WorldBoss/AIArena），测试可跑 headless 纯战斗组合。

## What Changes

- **新增极薄内核 `server/core/`**（无游戏逻辑）：`Context`（服务注册表 + 事件总线 + 可逆效应栈）、`Loader`（按 Profile 组合插件、依赖拓扑排序、挂载/卸载）、`Scheduler`（声明式节奏调度，替代 GameEngine 硬编码分支）。
- **现有 6 个 Manager + Store + auth 原样包装为插件** `server/plugins/<name>/`（绞杀者模式：M1 阶段行为零变化）。
- **玩家接入事件化**：`player:join`/`player:leave` 广播事件替代 index.js 中 ×6 的手工 register/unregister 调用。
- **Socket 路由接缝化**：`ctx.socket(event, schema, handler)` 可逆注册（eventGuard 增加 teardown 支持）；INPUT_SKILL 的"副本 or 竞技场 or 忽略"硬编码链改为 `combat:resolve-context` 瀑布事件。
- **Profile 分层组合**：`full`（=现状全量）、`embedded`（桌面内嵌裁剪）、`duel`（PvP-only 冒烟测试）等组合配置，支持 `extends`/`disable`/`overrides`。
- `server/index.js` 收缩到 ~30 行：建 ctx → 载入 profile → 挂载插件 → listen。

## Capabilities

### New Capabilities

- `plugin-runtime`: 插件契约、GameContext（服务/事件/可逆效应）、Loader 生命周期（mount/unload/依赖解析）
- `profile-composition`: Profile 声明（extends/disable/overrides）、分层组合顺序、启动时组合树 dump

### Modified Capabilities

无现有 spec 文件需要修改（本变更不改变游戏行为与协议；`EVENTS`/`REST` 仍以 `shared/constants.js` 为准，新增内部事件不进协议）。

## Impact

### 修改文件

| 文件 | 变更点 |
|------|--------|
| `server/index.js` | 收缩为入口壳：ctx → profile → mount → listen（M1 起逐步变薄） |
| `server/game/GameEngine.js` | 退化为 `core/Scheduler.js`，tick 分支删除，节奏由插件声明 |
| `server/middleware/eventGuard.js` | `on()` 返回解绑函数（teardown 支持，M4） |

### 新增文件

| 文件 | 用途 |
|------|------|
| `server/core/Context.js` | 服务注册表 + 事件总线（广播/瀑布）+ 可逆效应栈 |
| `server/core/Loader.js` | Profile 载入、依赖拓扑排序、mount/unload |
| `server/core/Scheduler.js` | 声明式节奏调度（`ctx.every`） |
| `server/core/profiles/*.js` | `full` / `embedded` / `duel` 组合声明 |
| `server/plugins/*/index.js` | 9 个插件包装层（persistence/identity/world-player/combat/movement/pve/pvp/worldboss/aiarena/mining/economy-shop） |
| `test/context.test.js`、`test/loader.test.js`、`test/profiles.test.js` | 内核单测（效应回滚、依赖排序、组合树） |

### 风险控制

- 每个迁移阶段（M1–M5）独立可合入、可回退，`npm test`（Vitest，现有 7 个测试文件）全程兜底。
- 与 `docs/architecture-roadmap.md` 的"增量演进、不重写"约束一致；不引入 Cordis 本体或任何新依赖。
