# Proposal: Coprocessor System（协处理器数据层）

## Why

GDD（`docs/game-design.md` §3）把协处理器定义为"核心 retention 支柱"：16 个图鉴、碎片收集、★→★★→★★★ 升级。但代码里只有一个 4 条目的旧 `COPROCESSORS` 常量（闪电链/护盾超载/区域隐身/算力磁铁，带 `freeVersion`），**没有任何玩家侧数据、碎片、升级或装载逻辑**——商店里 premium/legendary 礼包的 `coprocessor: true` 是一个悬挂 TODO（`server/routes/shop.js:65`），副本/PvP 也零碎片产出。

这是垂直切片 Stage 2 的地基：先把数据层做成闭环（图鉴 + 碎片经济 + 升级 + 装载 + 三个碎片来源），收集进度才能推着玩家跑副本和 PvP。

## What Changes

- **图鉴 16 个定义**（`shared/constants.js`）：替换旧 4 条目 `COPROCESSORS`，按 GDD §3.2/§3.3 补齐攻击/防御/机动/经济各 4 个；每个定义带 `stars: [★, ★★, ★★★]` 三档数值（★=GDD"免费版"列，★★=GDD 主表列，★★★=GDD 未给出部分的推展裁决，规则见 design.md）。
- **碎片经济**（`Player` 模型）：`coprocessors`（已拥有 `[{id, star}]`）、`fragments`（`{coprocessorId: count}`）、`activeCoprocessor`（装载 id）三个持久化字段 + 旧存档兼容；`addCoprocessor`/`addFragment`/`canUpgradeCoprocessor`/`upgradeCoprocessor`/`setActiveCoprocessor` 方法。
- **升级**：★→★★ 消耗 3 个同类型碎片，★★→★★★ 消耗 8 个（GDD §3.4）；服务端扣碎片、星级 +1。
- **碎片来源接线**（GDD §3.4 概率表）：
  - 副本通关：单人 15% / 团队（≥2 人）30% 掉落 1 个随机碎片（`PvEManager.completeDungeon`）；
  - PvP 3 连胜宝箱：10% 掉落 1 个随机碎片（`PvPManager.endMatch` 连胜奖励点）；
  - 商店 premium/legendary 礼包：赠送 1 个未拥有的随机协处理器（关掉 shop.js 旧 TODO；全拥有则折为碎片）。
- **协议**：`EVENTS` 新增 `COPROCESSOR_FRAGMENT`（只改 `shared/constants.js`）。

### 明确不做（留给后续变更）

- **16 个技能的效果执行**——需要先定"协处理器技能占哪个槽位"的技能盘架构（与 skill-disk 系统耦合），单独 design；
- **协同槽**（二阶/三阶配方，GDD §3.5）、**每日轮换增幅**（§3.6）、赛季休眠（§3.7）；
- 团队 Boss/世界 Boss/每日任务的碎片接线（常量中声明概率，实现留后）；
- 升级/装载的 socket 交互入口（数据层方法先行，M6 随交互层一起上）。

## Capabilities

### New Capabilities

- `coprocessor-system`: 协处理器图鉴数据、碎片收集与升级、装载语义、碎片掉落来源。

### Modified Capabilities

- 无（不改插件内核契约；`COPROCESSORS` 常量形态变更无运行时消费方，见 design.md §1）。

## Impact

### 修改文件

| 文件 | 变更点 |
|------|--------|
| `shared/constants.js` | 替换 `COPROCESSORS` 为 16 条目三星结构；新增 `COPROCESSOR_CATEGORIES`/`COPROCESSOR_STARS`/`COPROCESSOR_FRAGMENT_SOURCES`/`COPROCESSOR_SHOP`；`EVENTS` 加 `COPROCESSOR_FRAGMENT` |
| `server/models/Player.js` | `coprocessors`/`fragments`/`activeCoprocessor` 字段 + 5 个方法；serialize/toSave/fromSave |
| `server/routes/shop.js` | `coprocessor: true` 礼包落地（替换 TODO） |
| `server/game/PvEManager.js` | `completeDungeon` 按人数 roll 碎片 |
| `server/game/PvPManager.js` | `endMatch` 连胜宝箱 roll 碎片 |

### 新增文件

| 文件 | 用途 |
|------|------|
| `server/game/CoprocessorDrops.js` | 碎片掉落共享助手（roll + 入库 + markDirty + 发事件） |
| `test/coprocessor.test.js` | 图鉴完整性、升级、装载、掉落率、存档兼容 单测 |

### 风险控制

- `COPROCESSORS` 旧形态唯一消费方是 `client/src/shared.js` 的无脑 re-export（形态无关），替换零破坏；玩家存档从未存过协处理器数据（`Player` 无相关字段），**无存档迁移需求**；
- 掉落全走服务端 `Math.random`，客户端零信任；
- `npm test` 全量回归兜底（基线 159）。
