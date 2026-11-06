# 协处理器技能激活 — 任务

## 本变更（M6 垂直切片）

- [x] `shared/constants.js`：`EVENTS` 新增 `INPUT_COPROCESSOR`、`COPROCESSOR_ACTIVATED`。
- [x] `server/models/Player.js`：新增瞬时 `coprocessorLastUsed`（构造函数 + `fromSave` 复位 + 死亡复位接线）。
- [x] `server/game/CoprocessorSystem.js`：新建，含 `activate` 校验流水 + 攻击型 4 效果处理器 + `burn` 累计。
- [x] `server/plugins/combat/index.js`：实例化 `CoprocessorSystem` 并经 `ctx.service('coprocessor', ...)` 提供。
- [x] `server/plugins/world-player/index.js`：注册 `INPUT_COPROCESSOR` 路由（`combat:resolve-context` 瀑布 + `activate` 调用）。
- [x] `server/game/CombatSystem.js`：`handlePlayerDeath` 复位 `coprocessorLastUsed`。
- [x] `test/coprocessor-activation.test.js`：覆盖槽装载缺失 / 冷却 / 消耗 / 四效果击杀与链式/穿透/分裂/灼烧累计。

## 后续增量

### M6.1 防御型（4）
- [ ] `shield_overload`（护盾 + 反射）：需在 `damagePlayer` 镜像反射百分比入口。
- [ ] `damage_to_heal`：`damagePlayer` 内在 buff 窗口内伤害转治疗。
- [ ] `rebound_barrier`：`damagePlayer` 内按 `reflectChance` 概率免伤并反弹。
- [ ] `emergency_repair`：手动 + `tickPlayer` 内 HP<20% 自动触发。

### M6.2 机动型（4）
- [ ] `stealth_field`（隐身 + 下次攻击 ×backstabMultiplier）。
- [ ] `blink`（传送，`isWalkable` 路径校验）。
- [ ] `slow_field`（范围内敌人减速 debuff）。
- [ ] `portal`（双向传送门持久地图对象）。

### M6.3 经济型（4）
- [ ] `token_magnet`（地面掉落拾取半径 —— 需地面掉落系统）。
- [ ] `token_doubler`（下次掉落翻倍 —— hook `applyLoot`）。
- [ ] `rarity_boost`（`rollRarity` 接受 bonus）。
- [ ] `offline_boost`（离线挖矿倍率 —— hook 挖矿重连结算）。