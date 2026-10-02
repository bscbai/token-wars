# 协处理器技能激活 — 设计

## 1. 槽架构裁决

- 协处理器**不**占据 Q/W/E/R 四槽（`SKILL_KEYS`），也**不**占用 4×4 token 网格（`equippedTokens` 16 格）。它是**第五个行动槽**——协处理器槽，槽内最多装 1 个（`activeCoprocessor`，M5 已落地装载语义）。
- 触发事件 `input:coprocessor` 与 `input:skill` 同源：由 `world-player` 插件注册，经 `combat:resolve-context` 瀑布解析战斗上下文（副本 → 竞技场 → 世界 Boss → 大厅静默忽略）。大厅/无上下文时忽略，与原 `INPUT_SKILL` 一致。
- 冷却为**瞬时**状态 `player.coprocessorLastUsed`（毫秒时间戳），死后复位为 0（与 `skills[].lastUsed` 同语义），不落盘。

## 2. CoprocessorSystem（server/game/CoprocessorSystem.js）

- 构造入参 `(io, store, combat)`——复用 `CombatSystem` 的公开助手（`findEntityAt` / `broadcastToPlayers` / `payTokenCost` / `handleEntityDeath` / `syncPlayer`），不重复实现战斗机制。
- 由 `combat` 插件 `ctx.service('coprocessor', ...)` 提供；`world-player` 依赖 `combat` 插件，因此在路由时可用 `ctx.get('coprocessor')`。

### activate(player, targetX, targetY, entities, mapData)

1. `id = player.activeCoprocessor`；空 → `{ success:false, reason:'none_loaded' }`。
2. `owned = player.getCoprocessor(id)`；无 → `not_owned`。
3. `cfg = COPROCESSORS[id].stars[owned.star - 1]`。
4. 冷却：`now - coprocessorLastUsed < cfg.cooldown` → `on_cooldown`。
5. Token 消耗：`cfg.tokenCost > 0` 时 `combat.payTokenCost`（基础弹药优先 → unstable）；付不起 → `insufficient_tokens`。
6. 提交 `coprocessorLastUsed = now`、`lastCombatAt = now`。
7. 按 `EFFECT_HANDLERS[id]` 分发；未实现 → `not_implemented`。
8. 成功后 `syncPlayer`，并广播 `EVENTS.COPROCESSOR_ACTIVATED`（含 `coprocessorId / star / targetX / targetY`）。

## 3. 攻击型效果语义（本变更）

所有伤害走 `calcDamage(atk, mult, def)`（下限 1）。目标判定基于实体 `Map`，跳过自身与非存活。

| id | 语义 | 参数（starlist） | 调优常量 |
|----|------|-----------------|---------|
| lightning_surge | 命中主目标 + 链到最近 `chainCount-1` 个敌人 | damageMult / chainCount | CHAIN_RANGE=3（曼哈顿，自主目标） |
| piercing_shot | 沿玩家→目标方向射线，命中线上所有敌人 | damageMult | PIERCE_RANGE=10 |
| split_round | 主目标满额伤害 + `fragmentCount` 弹片命中最近他人 | fragmentCount / fragmentMult | SPLIT_RANGE=5 |
| burn_mark | 立即叠 `burnStacks` 层灼烧伤害，累计 ≥3 层引爆 | burnStacks | BURN_STACK_DAMAGE_MULT=0.5、BURN_DETONATE_STACKS=3、BURN_DETONATE_DAMAGE_MULT=2.0 |

- 灼烧累计存于 `CoprocessorSystem.burn`（`entityId → stacks` Map），避免改写未知实体结构；引爆后重置该实体计数。
- 击杀经由 `handleEntityDeath` 复用现有死亡/掉落/击杀处理。

## 4. 决策记录

- **槽为第五槽**：GDD §4.3 固定 Q/W/E/R，§3.5 描述协同槽位于 4×4 网格右侧；协处理器是独立行动槽，不挤占基础技能。多协处理器协同槽属 M7。
- **冷却瞬时不落盘**：秒级冷却，与基础技能 `lastUsed` 同语义，重启/死亡复位无平衡漏洞。
- **攻击型先行**：防御型需镜像 `damagePlayer` 反射/转治疗入口，机动型需移动路径/传送校验，经济型需地面掉落与挖矿 hook，各为独立子系统，分期落地避免半成品。