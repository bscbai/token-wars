# 协处理器剩余效果执行 — 规约

## 核心要求

1. **统一入口**：所有 16 个协处理器效果经 `CoprocessorSystem.activate(player, targetX, targetY, entities, mapData)` 执行，完成装载/拥有/冷却/Token 消耗校验后分发。
2. **服务端权威**：所有状态变更（护盾、隐身、位置、Token、倍率）由服务端计算并经 `syncPlayer`/广播同步。
3. **死亡复位**：玩家死亡后所有协处理器瞬态状态清零，冷却复位（`coprocessorLastUsed=0`）。
4. **持久化兼容**：`fromSave` 对缺失的协处理器相关字段补默认值（瞬态=0/null，offline_boost=0）。

## 防御型

- **shield_overload**：激活后 `shield=absorbAmount`、`shieldActive=true`，受击时护盾吸收的伤害按 `reflectPercent` 反弹给攻击者（若攻击者可定位）。
- **damage_to_heal**：激活后 `duration` 毫秒内受到的伤害转为等量治疗（不超过 `maxHp`）。
- **rebound_barrier**：激活后 `duration` 毫秒内每次受击以 `reflectChance` 概率全额免伤并将原伤害反弹给攻击者。
- **emergency_repair**：激活立即回复 `healPercent*maxHp`；`tickPlayer` 中若 HP<20% 且冷却就绪且为装载协处理器，自动激活。

## 机动型

- **stealth_field**：激活后隐身 `duration` 毫秒；隐身期间下一次攻击伤害 ×`backstabMultiplier` 并解除隐身；到期自动解除。
- **blink**：沿玩家→目标方向移动最多 `range` 格，遇不可通行格停止，不穿墙。
- **slow_field**：目标点 `radius` 内所有敌人获得减速 debuff（5s），期间移动频率降低。
- **portal**：在玩家当前点与目标点各建一个传送门，持续 `duration`；玩家踩踏任一门时传送到配对门，含短暂免疫避免回传。

## 经济型

- **token_magnet**：立即获得 `radius*3` 个 unstable token（环境收集语义）。
- **token_doubler**：激活后 15s 内下一次 loot 掉落的 unstable 与 stable 数量 ×`dropMult`。
- **rarity_boost**：激活后 `duration` 毫秒内 `rollRarity` 传入 `rarityBonus` 提升稀有掉落概率。
- **offline_boost**：持久化倍率与到期时间；离线挖矿时段与 boost 窗口重叠部分按 `miningMult` 计算。
