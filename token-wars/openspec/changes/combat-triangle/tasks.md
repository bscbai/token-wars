# Tasks: Combat Triangle

> 全程 `npm test` 必须绿；协议只改 `shared/constants.js`。

## T1 — 常量与协议 ✅

- [x] 1.1 `shared/constants.js`：新增 `SKILL_KEYS`、`COMBAT_TRIANGLE`（meleeVsShieldMult 0.5、knockbackTiles 1）、`COMBOS`（5 配方 + windowMs 2000 + dodgeCritWindowMs 1000 + dodgeCritBonus 0.5 + aoeDamageBonus 0.3）、`BASIC_AMMO`（max 50、regenMs 30000、damageMult 0.5）；`SKILLS.SHIELD` 加 `duration: 4000`；`EVENTS` 加 `COMBAT_COMBO`/`COMBAT_KNOCKBACK`
- [x] 1.2 确认 `shared/protocol.js` 零改动（re-export shim）

## T2 — Player 模型 ✅

- [x] 2.1 `Player` 构造：`basicAmmo = BASIC_AMMO.MAX`；transient：`comboSeq = []`、`comboEffects = {}`、`lastCombatAt = 0`、`lastAmmoRegenAt = 0`、`lastShieldDrainAt = 0`、`shieldExpiresAt = 0`
- [x] 2.2 `serialize()` 加 `basicAmmo`；`toSave()` 加 `basicAmmo`；`fromSave()` 补默认值（`basicAmmo` 缺失 → 50，transient 全量重置）

## T3 — CombatSystem：弹药与连招核心 ✅

- [x] 3.1 `payTokenCost(player, cost)`：基础弹药优先 → unstable 补足 → 失败返回 null；成功返回 `{ basic, unstable, damageMult }` 并 markDirty
- [x] 3.2 `useSkill` 重构：冷却 → 连招序列记录与检测（触发键效果注入本次执行）→ 免费判定（反击连击）→ `payTokenCost`（不足 → `insufficient_tokens`）→ 分发执行（damageMult 传入 melee/aoe）
- [x] 3.3 连招匹配：`detectCombo`/`commitCombo` —— 过期剔除、追加、尾部全等匹配、触发后清空、发 `COMBAT_COMBO`（失败技能不进序列）

## T4 — CombatSystem：三角克制 ✅

- [x] 4.1 melee vs 护盾：穿透 ×0.5、不耗盾值、`penetrated: true`
- [x] 4.2 aoe vs 护盾：全吸收（min 消耗）、归零失效广播、`absorbed` 字段
- [x] 4.3 aoe vs 无盾玩家：击退 1 格（墙/边界阻挡则不动，广播 `COMBAT_KNOCKBACK`）+ 打断（目标槽位 0 进完整冷却）
- [x] 4.4 `useSkill` 签名加 `mapData`；world-player INPUT_SKILL 透传 `data.mapData`

## T5 — 护盾时长与节奏修复 ✅

- [x] 5.1 `executeShield`：`shieldExpiresAt = now + duration`；连招"完美防御" ×2、"爆破护盾"完成时当前护盾吸收 ×2
- [x] 5.2 `tickPlayer(player, now)`：cleanupBuffs → 护盾到期失效 → 流失 1/s 节流（经 payTokenCost，弹尽盾破）→ 基础弹药脱战恢复（30s）→ 过期连招效果清理
- [x] 5.3 combat 插件 `ctx.every(10)` 遍历存活玩家调 `tickPlayer`（修复 M3 遗留）

## T6 — 测试与验收 ✅（2026-09-26，159/159 用例通过）

- [x] 6.1 `test/combat-triangle.test.js`（27 用例）：三角三规则、5 连招、弹药支付/倍率/恢复、护盾时长、击退、持久化
- [x] 6.2 `test/combat.test.js` 既有用例适配（显式 `basicAmmo = 0` 锁定 unstable 路径）
- [x] 6.3 全量 `npm test` 绿（159/159，13 文件）
- [x] 6.4 启动烟雾：`/health` 200（scheduler:true）+ 注册流返回 `basicAmmo: 50`
