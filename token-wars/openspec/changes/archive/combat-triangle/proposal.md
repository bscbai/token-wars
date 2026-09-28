# Proposal: Combat Triangle（战斗三角 + 连招 + 基础弹药）

## Why

GDD（`docs/game-design.md` §4.1/§4.4/§2.2）早已定义了战斗深度三件套，但服务端一个都没实现——当前战斗只有"按技能扣弹药算伤害"，没有决策博弈：

| GDD 设计 | 现状证据 | 后果 |
|----------|----------|------|
| 战斗三角（Q 克 E / E 克 R / R 克 Q） | `CombatSystem.executeMelee/executeAoe` 对玩家目标直接 `takeDamage`，**完全绕过护盾**；护盾只在 `damagePlayer`（怪物伤害）里生效 | 护盾在 PvP 中形同虚设，4 技能无克制关系，"读对手"不存在 |
| 连招系统（5 配方，2s 窗口） | 无任何技能序列追踪 | 无操作深度，GDD §6 的"30 小时仍有新发现"落空 |
| 基础弹药（50 发上限，脱战 1/30s，0.5x） | `Player` 只有 unstableTokens，打空即无法战斗 | 新手"弹尽粮绝"，违背 §2.2 设计意图 |

另发现一个 M3 迁移遗留回归：`GameEngine.js` 退役后，`cleanupBuffs`/`processShieldDrain` 在生产路径**无人调用**（combat 插件缺少 tasks.md 4.1 声称的 `ctx.every(10)`）——护盾流失与 buff 清理实际失效。本变更顺带修复。

这是垂直切片 Stage 1 的地基：三角克制让 PvP 有博弈，连招给操作上限，基础弹药保底新手体验。全部服务端权威计算，客户端零信任。

## What Changes

- **战斗三角**（`CombatSystem`）：
  - Q（melee）克 E：对护盾目标穿透护盾直接造伤，伤害 ×50%；
  - E（shield）克 R：护盾**完全抵消** AOE 命中（按 min(伤害, 剩余吸收) 消耗护盾，不穿透）；
  - R（aoe）克 Q：AOE 命中无护盾玩家时击退 1 格（墙体阻挡则不动）并打断——目标基础攻击进入完整冷却。
- **连招系统**：玩家身上记录技能序列（transient），2s 窗口匹配 GDD 5 配方；触发即发 `combat:combo` 事件并应用加成（详见 design.md 效果语义）。
- **基础弹药池**：`Player.basicAmmo`（上限 50，持久化）；一切 token 消耗（技能费 + 护盾流失）**优先扣基础弹药**，按比例施加 0.5x 伤害倍率；脱战 30s 后每 30s 恢复 1 发。
- **护盾时长化**：护盾增加 4s 基础时长（到期自动失效），支撑"完美防御"等连招的时长语义；修复流失节奏为真正的 1/s（原实现每 10 tick 扣 1 = 2/s，且已失效）。
- **节奏修复**：combat 插件补上 `ctx.every(10)` —— buff 清理、护盾流失/到期、弹药恢复统一走 `CombatSystem.tickPlayer`。
- **协议**：`EVENTS` 新增 `COMBAT_COMBO`、`COMBAT_KNOCKBACK`（只改 `shared/constants.js`）。

## Capabilities

### New Capabilities

- `combat-triangle`: 技能克制关系、连招序列匹配与加成、基础弹药经济与恢复、护盾时长/流失节奏。

### Modified Capabilities

无（不改动插件内核契约；`combat:resolve-context` 瀑布仅多传一个既有字段 `mapData`）。

## Impact

### 修改文件

| 文件 | 变更点 |
|------|--------|
| `shared/constants.js` | 新增 `COMBAT_TRIANGLE`/`COMBOS`/`BASIC_AMMO`/`SKILL_KEYS`；`SKILLS.SHIELD` 加 `duration`；`EVENTS` 加 `COMBAT_COMBO`/`COMBAT_KNOCKBACK` |
| `server/game/CombatSystem.js` | useSkill 重构（连招检测→免费判定→弹药结算→执行）；melee/aoe 护盾交互；击退+打断；`payTokenCost`/`tickPlayer` 新增 |
| `server/models/Player.js` | `basicAmmo` + transient 连招/节奏字段；serialize/toSave/fromSave |
| `server/plugins/combat/index.js` | `ctx.every(10)` → `combat.tickPlayer`（修复 M3 遗留） |
| `server/plugins/world-player/index.js` | INPUT_SKILL 透传 `data.mapData`（击退墙体校验） |
| `test/combat.test.js` | 3 个既有用例显式 `basicAmmo = 0` 锁定 unstable 弹药路径（行为变更） |

### 新增文件

| 文件 | 用途 |
|------|------|
| `test/combat-triangle.test.js` | 三角克制 / 连招 / 基础弹药 / 护盾时长 / 持久化 单测 |

### 风险控制

- 全程服务端权威，无协议破坏性变更（仅新增事件）；`npm test` 全量回归兜底；旧存档经 `fromSave` 默认值兼容（`basicAmmo` 缺失 → 50）。
