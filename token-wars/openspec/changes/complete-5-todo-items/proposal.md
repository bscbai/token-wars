# Proposal: Complete 5 Core TODO Items

## Why

Token Wars 的代码库中散落着 5 个关键的未完成功能（TODO 注释），直接影响核心游戏循环的可玩性与经济闭环。这些功能在设计文档中已有明确定义，代码骨架也已就位，但执行路径缺失。现在填补这些缺口可以让游戏从"原型可跑"进入"玩法完整"阶段。

## What Changes

- **技能盘装备服务端同步 (P0)**：实现玩家在 InventoryScene 拖拽 Token 到技能盘格子的完整通信链路，服务端校验并持久化装备状态。
- **协处理器 Token 背包逻辑 (P0)**：补完商城购买协处理器 Token 后的入包逻辑，添加协处理器 Token 数据结构并支持装备。
- **Boss P2/P3 阶段技能执行 (P1)**：在 PvEManager.dungeonTick() 中添加 Boss 阶段过渡检测和阶段专属技能（token_drain、enrage）的执行逻辑。
- **PvP 缩圈实现 (P1)**：实现 90 秒后地图危险区域的实际生成和伤害机制，120 秒数据核心的完整交互逻辑。
- **赛季重置 & 匹配扩圈 (P2)**：实现每 4 周的赛季重置机制（等级/评分软重置），以及匹配等待超过 2 分钟后的评分范围自动扩大。

## Capabilities

### New Capabilities

- `skill-disk-equip`: 技能盘装备的完整通信与服务端持久化
- `coprocessor-inventory`: 协处理器 Token 的购买、存储与装备
- `boss-phase-abilities`: Boss 多阶段技能的检测与执行
- `pvp-shrink-zone`: PvP 缩圈机制（危险区域生成和伤害）
- `season-reset`: 赛季重置系统（等级/评分软重置）
- `matchmaking-expansion`: 匹配系统评分范围动态扩大

### Modified Capabilities

无现有 spec 文件需要修改。

## Impact

### 修改文件

| 文件 | 变更点 |
|------|--------|
| `shared/protocol.js` | 新增 `SKILL_DISK_EQUIP` C→S 事件 |
| `server/index.js` | 注册 `skill_disk:equip` 事件处理 |
| `server/models/Player.js` | 新增 `coprocessorTokens` 字段、`equipToken()` 方法、赛季 reset 方法、`toSave()`/`fromSave()` 更新 |
| `server/routes/shop.js` | 协处理器 Token 入包逻辑 |
| `server/game/PvEManager.js` | `dungeonTick()` 增加 Boss 阶段检测和技能执行 |
| `server/game/PvPManager.js` | `arenaTick()` 实现缩圈 + 匹配扩圈 |
| `server/models/Arena.js` | 新增 `shrinkZone` 和 `hazardTiles` 追踪字段 |
| `client/src/scenes/CombatScene.js` | 危险区域渲染和 HAZARD Tile 伤害反馈 |
| `client/src/scenes/InventoryScene.js` | 技能盘拖拽 → Socket 发送装备请求 |

### 新增文件

无 — 所有变更在现有文件中完成。
