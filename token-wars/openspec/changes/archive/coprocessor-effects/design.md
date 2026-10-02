# 协处理器剩余效果 — 设计

## 1. 总体架构

沿用 M6：`CoprocessorSystem.activate(player, tx, ty, entities, mapData)` 统一校验
（装载/拥有/冷却/Token 消耗）后按 `EFFECT_HANDLERS[id]` 分发。本变更新增 12 个处理器，
并在现有战斗/移动/掉落/挖矿子系统的接缝处读取协处理器状态。

## 2. 状态归属

### 玩家瞬态字段（Player.js，不落盘，死亡复位）
| 字段 | 类型 | 所属效果 |
|------|------|---------|
| `copReflect` | number 0-1 | shield_overload：护盾激活时反射吸收伤害的比例 |
| `copDamageToHealUntil` | number(ms) | damage_to_heal：窗口到期时间 |
| `copReboundUntil` | number(ms) | rebound_barrier 窗口 |
| `copReboundChance` | number 0-1 | rebound_barrier 反弹概率 |
| `copBackstabMult` | number | stealth_field：下次攻击伤害倍率 |
| `copStealthUntil` | number(ms) | stealth_field：隐身到期 |
| `copLootMult` | number | token_doubler：下次掉落倍率 |
| `copLootMultUntil` | number(ms) | token_doubler：窗口到期 |
| `copRarityBonus` | number | rarity_boost：稀有率加成 |
| `copRarityUntil` | number(ms) | rarity_boost：窗口到期 |

### 玩家持久化字段（toSave/fromSave）
| 字段 | 类型 | 所属效果 |
|------|------|---------|
| `copOfflineBoostUntil` | number(ms) | offline_boost：跨离线的倍率到期时间 |
| `copOfflineBoostMult` | number | offline_boost：离线挖矿倍率 |

### CoprocessorSystem 实例状态
- `this.burn: Map<entityId, stacks>`（M6 已有）
- `this.slowDebuffs: Map<entityId, { until, factor }>` — slow_field
- `this.portals: Map<portalId, { x, y, pairId, ownerId, until }>` — portal

## 3. 效果语义表

### 防御型（M6.1）

| id | 语义 | 接线点 |
|----|------|-------|
| shield_overload | 设 `shield=absorbAmount`、`shieldActive=true`、`copReflect=reflectPercent` | `executeShield`-like 内联；`damagePlayer` 护盾吸收后按 `copReflect` 反射 `absorbed*reflectPercent` 给源实体 |
| damage_to_heal | `copDamageToHealUntil=now+duration` | `damagePlayer`：若窗口内，`hp=min(maxHp, hp+damage)`，返回 0 |
| rebound_barrier | `copReboundUntil=now+duration`、`copReboundChance` | `damagePlayer`：若窗口内且 `roll<chance`，全额反弹伤害给源实体，自身免伤 |
| emergency_repair | 立即 `hp=min(maxHp, hp+maxHp*healPercent)`；`tickPlayer` 中 HP<20% 且冷却就绪自动触发 | `tickPlayer` |

### 机动型（M6.2）

| id | 语义 | 接线点 |
|----|------|-------|
| stealth_field | `stealthed=true`、`copBackstabMult`、`copStealthUntil` | `executeMelee`/`executeAoe` 伤害计算时若 `stealthed` 则 `damage*=copBackstabMult` 并解除隐身；`tickPlayer` 到期解除 |
| blink | 沿玩家→目标方向步进最多 `range` 格，遇墙停止，更新坐标 | 内联，`isWalkable` 校验 |
| slow_field | 对 `radius` 内所有敌人写入 `slowDebuffs[entityId]={until: now+5000, factor: slowPercent}` | `PvEManager.dungeonTick`：若怪物有 slow 且未到 `until`，跳过 `moveMonsterToward`（等效减速） |
| portal | 在目标点与玩家当前点各建一个传送门（pairId 互指），持续 `duration` | `world-player` INPUT_MOVE 处理后：若玩家坐标命中某传送门且其 pair 存在，则传送到 pair 坐标（防循环：传送后不重复检测） |

### 经济型（M6.3）

| id | 语义 | 接线点 |
|----|------|-------|
| token_magnet | 立即授予 `radius * 3` 个 unstable token（环境 Token 收集；地面掉落系统上线后改拾取半径） | 内联 `player.addUnstableTokens` |
| token_doubler | `copLootMult=dropMult`、`copLootMultUntil=now+15000`（15s 内下一次掉落） | `applyLoot`：若窗口内，`unstable*=copLootMult`、stable 数量 ×mult，清窗 |
| rarity_boost | `copRarityBonus=rarityBonus`、`copRarityUntil=now+duration` | `rollRarity(bonus)`：传入 `copRarityBonus`（若窗口内），提升稀有档概率 |
| offline_boost | 持久化 `copOfflineBoostUntil=now+duration`、`copOfflineBoostMult=miningMult` | `calculateOfflineMining`：离线时段与 boost 窗口重叠部分按 `miningMult` 倍率计算 |

## 4. 决策记录

- **反射目标**：`damagePlayer(player, damage, sourceId, entities)` 的 `sourceId` + `entities` 可定位源实体；若源不在 entities 中则不反射（仍照常扣血）。
- **紧急修复自动触发**：仅当 `activeCoprocessor === 'emergency_repair'` 时自动触发，与"第五槽装载"语义一致；手动激活不受此限。
- **stealth 背刺**：在 `executeMelee`/`executeAoe` 伤害计算后、`takeDamage` 前应用倍率并解除隐身；`executeDodge`/`executeShield` 不触发（非伤害技能）。
- **portal 防循环**：传送设置 500ms 免疫窗口（`copPortalImmuneUntil`），避免在 pair 点立刻被传回。
- **offline_boost 持久化**：唯一需要跨离线的效果，故 `copOfflineBoostUntil/Mult` 进 toSave/fromSave；其余均瞬态。
- **slow_field 实现**：当前怪物 AI 每 tick 移动一步，slow 通过"概率/间隔跳过移动"实现减速，不改写 Monster 结构（存在 CoprocessorSystem.slowDebuffs）。
