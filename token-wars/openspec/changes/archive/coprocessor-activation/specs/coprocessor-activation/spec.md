# 协处理器技能激活 — 规范

## 槽装载与校验

- GIVEN 玩家未装载任何协处理器（`activeCoprocessor === null`）
- WHEN 客户端发送 `input:coprocessor`
- THEN 返回 `{ success:false, reason:'none_loaded' }`，不产生任何战斗效果。

- GIVEN 玩家装载 `lightning_surge`（★，冷却 10000ms）并成功激活一次
- WHEN 在冷却窗口内再次激活
- THEN 返回 `{ success:false, reason:'on_cooldown' }`。

- GIVEN 玩家 `basicAmmo=0` 且 `unstableTokens=0`
- WHEN 激活一个 `tokenCost>0` 的协处理器
- THEN 返回 `{ success:false, reason:'insufficient_tokens' }`，且不进入冷却。

## 攻击型效果

- GIVEN 装载 `lightning_surge`（★ damageMult=1.0, chainCount=2），主目标与 1 个相邻敌人
- WHEN 激活并指向主目标
- THEN 主目标与最近 1 个敌人各受 `calcDamage(atk, 1.0, def)` 伤害，共 2 命中。

- GIVEN 装载 `piercing_shot`，玩家正东方向直线上有 3 个敌人
- WHEN 激活并指向直线尽头
- THEN 3 个敌人各受 `calcDamage(atk, damageMult, def)` 伤害。

- GIVEN 装载 `split_round`（★ fragmentCount=2），主目标与 2 个相邻敌人
- WHEN 激活并指向主目标
- THEN 主目标受全额伤害，另外 2 个敌人各受 `calcDamage(atk, fragmentMult, def)`。

- GIVEN 装载 `burn_mark`（★ burnStacks=2）
- WHEN 连续两次激活同一目标
- THEN 首次累计 2 层、未引爆；第二次累计 ≥3 层触发引爆并复位计数。

## 未实现效果

- GIVEN 装载一个本阶段未实现的协处理器（如 `shield_overload`）
- WHEN 激活
- THEN 返回 `{ success:false, reason:'not_implemented' }`。