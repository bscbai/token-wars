# Design: Combat Triangle

> 数值全部取自 `docs/game-design.md` §4.1/§4.4/§2.2，不重新设计。本文档只定义实现语义与 GDD 未写明的边界裁决。

## 1. 技能键位映射

客户端按键 → 技能槽（`Player.skills` 数组下标）：

| 键 | 槽位 | 技能 | 类型 |
|----|------|------|------|
| Q | 0 | 基础攻击 | melee |
| W | 1 | 闪避翻滚 | movement |
| E | 2 | 算力护盾 | shield |
| R | 3 | 算力爆发 | aoe |

`shared/constants.js` 新增 `SKILL_KEYS = { Q: 0, W: 1, E: 2, R: 3 }` 供连招配方引用，避免魔法数字。

## 2. 战斗三角（§4.1）

三条克制规则都是**攻击方技能类型 × 目标护盾状态**的判定，在 `CombatSystem` 内完成：

### Q 克 E —— 攻击穿透护盾，造成 50% 伤害

`executeMelee` 命中有 `shieldActive` 的玩家目标时：
- 伤害先按 `COMBAT_TRIANGLE.MELEE_VS_SHIELD_MULT`（0.5）缩放（暴击在缩放前判定，顺序：基础伤害 → 暴击 ×1.5 → 穿透 ×0.5，全部向下取整，最低 1）；
- **不消耗目标护盾值**，直接扣血（"穿透"语义）；
- `COMBAT_HIT` 事件附带 `penetrated: true`。

### E 克 R —— 护盾吸收爆发的全部 AOE 伤害

`executeAoe` 命中有 `shieldActive` 的玩家目标时：
- 不扣血；按 `absorbed = min(damage, target.shield)` 消耗护盾值；
- 护盾归零则 `shieldActive = false` 并广播 `COMBAT_SHIELD { active: false }`；
- 广播 `COMBAT_HIT { absorbed, damage: 0 }`。

### R 克 Q —— 爆发打断攻击并击退

`executeAoe` 命中**无护盾**的玩家目标时，除正常伤害外：
- **击退**：沿攻击者→目标方向 `sign(dx), sign(dy)` 推 1 格；目标格出界或是墙（用战斗上下文的 `mapData`，缺省大厅边界墙）则不动；广播 `COMBAT_KNOCKBACK`；
- **打断**：目标的基础攻击（槽位 0）`lastUsed = Date.now()`，进入完整 500ms 冷却。

`mapData` 来源：world-player 的 `combat:resolve-context` 瀑布结果本就含 `mapData`（pve 认领时填副本地图），INPUT_SKILL handler 透传给 `useSkill` 第 6 参。大厅/无地图时 `isWalkable` 回退大厅边界墙逻辑（复用 world-player 的判定语义，在 CombatSystem 内实现等价的越界+墙检查）。

### W —— 通用应对

闪避不加克制逻辑（3s CD 已是约束），仅作为连招组件参与序列。

## 3. 连招系统（§4.4）

### 序列记录

- `player.comboSeq`（transient，不持久化）：`[{ key, at }]`，`useSkill` 成功执行后追加该技能的键位；
- 每次追加前剔除 `now - at > COMBO_WINDOW_MS`（2000）的过期项；序列上限 4（最长配方 3，留 1 冗余）。

### 匹配规则

追加后检查：序列尾部是否**恰好等于**某配方的 `seq`（按键序全等）。命中即触发该连招，触发后**清空序列**（一次按键流只触发一次，防止 Q→Q→R 后继续按 Q 产生歧义重叠）。

### 5 个配方的效果语义（GDD 只写了效果，语义裁决如下）

| 连招 | 序列 | 实现 |
|------|------|------|
| 蓄力爆发 | Q→Q→R | 本次 R（触发键）AOE 伤害 ×1.3。触发键即结算键，无延迟 |
| 反击连击 | E→Q→Q | 第二个 Q（触发键）免费：不消耗任何弹药，且不受 0.5x 倍率。触发键即生效 |
| 闪避反击 | W→Q | W 触发后挂 `player.comboEffects.dodgeCrit = { expiresAt: now + 1000 }`；窗口内下一次 Q 暴击率按 `+COMBO.dodgeCritBonus`（0.5）叠加（基础 0.1 → 0.6），用后清除 |
| 爆破护盾 | R→E→Q | Q（完成键）生效：当前激活护盾的剩余吸收量 ×2（20→40）并重播 `COMBAT_SHIELD`。GDD 表述为"E 吸收量翻倍"，但配方完成键是 Q，裁决为完成时翻倍当前护盾 |
| 完美防御 | E→W→E | 第二个 E（触发键）时长 ×2（本次 8s）。触发键即生效 |

触发时：向该玩家 socket 发 `COMBAT_COMBO { comboId, name }`；`player.comboSeq = []`。

**设计裁决**：全部"触发键即结算"——不做"挂等待效果给未来按键"的两段式（除闪避反击的 1s 窗口，那是 GDD 明文）。理由：服务端单线程顺序处理 `useSkill`，触发键结算无竞态、可单测、客户端提示（发光）只是锦上添花。

## 4. 基础弹药（§2.2）

### 数据

- `player.basicAmmo`：数值，上限 `BASIC_AMMO.max`（50），**持久化**（toSave/fromSave；旧存档缺失 → 默认 50，新手满弹药）；
- `serialize()` 输出 `basicAmmo`（客户端 HUD 用）；
- 初始值：新角色 50（满弹药开局，新手永远能战斗）。

### 消耗优先级与 0.5x 倍率

一切"弹药型"消耗统一走 `CombatSystem.payTokenCost(player, cost)`：

```
basic = min(basicAmmo, cost)
unstable = cost - basic
若 unstableTokens < unstable → 支付失败（技能拒绝，返回 'insufficient_tokens'）
basicAmmo -= basic; unstableTokens -= unstable
damageMult = basic > 0 ? BASIC_AMMO.damageMult(0.5) : 1.0   // 按发数比例：只要用了基础弹药就 0.5x
```

**裁决**：GDD 说"基础弹药攻击力为正常的 50%"。混合支付（如 cost=3，basic=1+unstable=2）按"含基础弹药即整发 0.5x"还是"按比例加权"都有解释空间。取**简单可解释**方案：只要本次消耗动用了基础弹药，本次伤害 ×0.5。这鼓励玩家把基础弹药用尽或用完再上 unstable，行为可预期。

适用面：
- `useSkill` 的 `tokenCost`（Q 的 1、R 的 3）；
- 护盾流失 `processShieldDrain`（1/s）同样优先扣基础弹药——护盾是"弹药驱动"的，与 §5.2 一致；流失不产生伤害，无倍率问题。

**免费例外**：连招"反击连击"让 Q 完全免费（跳过 `payTokenCost`，倍率 1.0）。

### 恢复

- `player.lastCombatAt`（transient）：`useSkill` 成功执行时刷新；
- `CombatSystem.tickPlayer(player, now)`（combat 插件 `ctx.every(10)` 每 0.5s 调）：
  - `now - lastCombatAt >= 30000` 且 `basicAmmo < 50` → `basicAmmo += 1`，并把 `lastCombatAt` 推到 `now - 29000`……

  **裁决（恢复节奏）**：GDD 说"1 发/30s"。实现为：脱战满 30s 后 +1 发，并把"脱战计时器"重置（`lastAmmoRegenAt = now`），下一发再等 30s。用独立字段 `lastAmmoRegenAt`（transient）记录上次恢复点，避免与 `lastCombatAt` 互相污染：
  ```
  if (basicAmmo < 50 && now - max(lastCombatAt, lastAmmoRegenAt) >= 30000) {
    basicAmmo++; lastAmmoRegenAt = now; markDirty;
  }
  ```
  登录时 `lastAmmoRegenAt = now`（不做离线恢复——GDD 只说脱战恢复，离线挂机已有挖矿，不叠加福利）。

## 5. 护盾时长化与节奏修复

### 为什么要加时长

GDD §4.4"完美防御"（E→W→E 第二次 E 持续时间 +100%）隐含护盾有**持续时间**概念；现实现护盾只靠流失和手动重开维持，无时长字段。补上：

- `SKILLS.SHIELD.duration = 4000`（基础 4s，GDD 未写明，取与闪避 3s CD 同量级的裁决值）；
- `executeShield`：`shieldExpiresAt = now + duration`（连招加成直接乘 duration）；
- `tickPlayer`：`shieldActive && now >= shieldExpiresAt` → 护盾失效广播。

### 流失节奏修复

原 `processShieldDrain` 每 10 tick（0.5s）扣 1 = **2/s**，与 GDD"1/s"不符；且 M3 后根本没人调用。修复：
- `tickPlayer` 内按墙钟节流：`now - lastShieldDrainAt >= 1000` 才扣 1（经 `payTokenCost`，优先基础弹药）；
- 弹药耗尽（支付失败）→ 护盾立即失效（原语义保留）。

### 节奏修复（M3 遗留）

combat 插件补：

```js
ctx.every(10, (now) => {
  for (const [, player] of store.players) {
    if (player.alive) combat.tickPlayer(player, now);
  }
});
```

`tickPlayer` 统一做：`cleanupBuffs` → 护盾流失/到期 → 弹药恢复 → 过期连招效果清理（`dodgeCrit` 窗口）。

## 6. 持久化策略

| 字段 | 持久化 | 理由 |
|------|--------|------|
| `basicAmmo` | ✅ toSave/fromSave | 经济状态，重启不应重置（否则刷重启补弹药） |
| `comboSeq`/`comboEffects`/`lastCombatAt`/`lastAmmoRegenAt`/`lastShieldDrainAt`/`shieldExpiresAt` | ❌ transient | 战斗瞬时状态；fromSave 补默认值 |

热路径：弹药消耗 `store.markDirty(player)`；恢复 +1 也 markDirty（60s 自动保存兜底，不值得每发 persist）。

## 7. 协议新增（只改 constants.js）

```js
COMBAT_COMBO: 'combat:combo',         // → 触发玩家：{ comboId, name }
COMBAT_KNOCKBACK: 'combat:knockback', // → 战斗上下文内玩家：{ targetId, x, y, attackerId }
```

`COMBAT_HIT` payload 向后兼容地**新增**可选字段：`penetrated`（bool）、`absorbed`（number）。

## 8. 测试策略

- `test/combat-triangle.test.js`（新）：三角三规则各正反用例、5 连招各触发/不触发（窗口过期、序列错误）、弹药支付优先级/倍率/拒绝、恢复节奏（假时钟）、护盾时长到期、击退墙体阻挡、持久化字段；
- `test/combat.test.js` 3 个既有用例显式 `basicAmmo = 0`（它们断言的是 unstable 弹药路径，新玩家默认 50 发基础弹药会改变其断言前提——这是有意的行为变更，用例显式锁定路径）；
- 全量 `npm test` ≥ 132 + 新增全绿。
