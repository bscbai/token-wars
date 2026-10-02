# 协处理器剩余效果 — 任务

## 基础设施
- [ ] `shared/constants.js`：`rollRarity(bonus=0)` 接受稀有率加成；EVENTS 增 `PORTAL_TELEPORT`、`SLOW_APPLIED`。
- [ ] `server/models/Player.js`：瞬态字段（copReflect/copDamageToHealUntil/copRebound*/copBackstabMult/copStealthUntil/copLoot*/copRarity*/copPortalImmuneUntil）构造+fromSave+死亡复位；持久化字段 copOfflineBoostUntil/Mult（toSave/fromSave）。
- [ ] `server/game/CombatSystem.js`：`handlePlayerDeath` 复位全部协处理器瞬态字段。

## M6.1 防御型
- [ ] CoprocessorSystem：`effectShieldOverload` / `effectDamageToHeal` / `effectReboundBarrier` / `effectEmergencyRepair`。
- [ ] CombatSystem.damagePlayer：shield_overload 反射、damage_to_heal 转治、rebound_barrier 反弹。
- [ ] CombatSystem.tickPlayer：emergency_repair HP<20% 自动触发。

## M6.2 机动型
- [ ] CoprocessorSystem：`effectStealthField` / `effectBlink` / `effectSlowField` / `effectPortal` + slowDebuffs/portals 状态。
- [ ] CombatSystem.executeMelee/executeAoe：stealth 背刺倍率 + 解除隐身；tickPlayer 隐身到期解除。
- [ ] world-player INPUT_MOVE：portal 踩踏传送（含免疫窗口）。
- [ ] PvEManager.dungeonTick：slow debuff 跳过移动。

## M6.3 经济型
- [ ] CoprocessorSystem：`effectTokenMagnet` / `effectTokenDoubler` / `effectRarityBoost` / `effectOfflineBoost`。
- [ ] CombatSystem.applyLoot：token_doubler 倍率。
- [ ] MiningManager.calculateOfflineMining：offline_boost 倍率。
- [ ] shop：`rollRarity(player.copRarityBonus)` 接线（仅窗口内）。

## 验证
- [ ] `test/coprocessor-effects.test.js`：12 效果核心语义用例。
- [ ] `npm test` 全量通过。
- [ ] 烟雾测试 `/health`。
- [ ] openspec 归档 + 提交推送。
