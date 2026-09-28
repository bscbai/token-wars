# Design: Coprocessor System（数据层）

> 数值全部取自 `docs/game-design.md` §3，不重新设计。本文档只定义实现语义与 GDD 未写明的边界裁决。

## 1. 旧 `COPROCESSORS` 常量的迁移策略

旧常量 4 条目（`LIGHTNING_SURGE`/`SHIELD_OVERLOAD`/`STEALTH_FIELD`/`TOKEN_MAGNET`，带 `freeVersion`）正是 GDD §3.2"现有"列——按名称一一对应新 16 条目中的 4 个。裁决：**整体替换，不做双轨兼容**。

理由：

1. **无运行时消费方**：全仓 grep 确认旧常量只被 `client/src/shared.js` 无脑 re-export（形态无关）引用；`AIArenaManager`/`AIAgent`/`Monster` 命中的是无关的 "coprocessor" 字样；
2. **无存档迁移需求**：`Player` 模型历史上从未有过协处理器字段（`openspec/changes/complete-5-todo-items/` 提案里的 `coprocessorTokens` 从未落码），players.json 里不存在旧形态数据；
3. 旧 4 条目的大写键（`LIGHTNING_SURGE` 等）在新表中保留同名字段，`COPROCESSORS.LIGHTNING_SURGE.id === 'lightning_surge'` 不变，唯一变化是值形态 `freeVersion` → `stars`。

`openspec/changes/complete-5-todo-items/` 的 coprocessor-inventory 规范（随机重摇避免重复的 `coprocessorTokens` 数组设计）由本设计取代，保持原样不归档。

## 2. 数据结构（`shared/constants.js`）

```js
COPROCESSORS = {
  LIGHTNING_SURGE: {
    id: 'lightning_surge', name: '闪电链', category: 'attack',
    stars: [ { damageMult, chainCount, cooldown, tokenCost }, // ★
             { ... },                                        // ★★
             { ... } ],                                      // ★★★
  },
  // ×16
}
COPROCESSOR_CATEGORIES = { ATTACK, DEFENSE, MOBILITY, ECONOMY }
COPROCESSOR_STARS   = { MAX: 3, UPGRADE_COSTS: [3, 8] }  // ★→★★ 3 碎片, ★★→★★★ 8 碎片
COPROCESSOR_FRAGMENT_SOURCES = { SOLO_BOSS: { rate: 0.15 }, TEAM_BOSS: { rate: 0.30 },
                                 WORLD_BOSS: { byContribution: true }, PVP_STREAK: { rate: 0.10 },
                                 DAILY_TASK: { pool: true } }
COPROCESSOR_SHOP    = { DUPLICATE_FRAGMENTS: 3 }  // 礼包开出已拥有 → 折 3 碎片
```

- `stars` 按下标 0/1/2 = ★/★★/★★★；每个 star 块只含该协处理器自己的参数（不强行统一字段名），共有的 `cooldown`（ms）与 `tokenCost` 每档必有；
- 掉落助手按 `COPROCESSOR_FRAGMENT_SOURCES[source].rate` 读数；`byContribution`/`pool` 两个非概率来源本变更不接线，常量先声明（GDD §3.4 完整性）。

## 3. 星级数值裁决规则

GDD 只给了闪电链的完整三星表（§3.4），其余 15 个只有"免费版 vs 主表"两列。统一定义：

| 星级 | 取值 |
|------|------|
| ★ | GDD"免费版"列（更弱参数 + 更长冷却） |
| ★★ | GDD 主表列（效果全强度、冷却/消耗如所列） |
| ★★★ | **推展裁决值**：主效参数提升一档；冷却 −2s（下限 4s，经济型的 24h 长冷却除外）；`tokenCost` 在 ★★ ≥1 时 −1（下限 0） |

以闪电链验证规则自洽：★=(1.0x,2,10s,2) → ★★=(1.3x,3,8s,2) → ★★★=(1.5x,4,6s,1)，与 GDD §3.4 示例表逐格一致。★★★ 的推展值是**数据层占位**，M6 效果执行落地前允许按平衡调整；调整只改 constants，不动逻辑。

个别条目 GDD 完全没给的参数（分裂弹弹片伤害倍率、减速力场半径、反弹屏障持续时长、瞬移距离）取裁决值并在 constants 注释标注，见 §6。

## 4. Player 模型

三个**持久化**字段（`toSave`/`fromSave`；旧存档缺失 → 空）：

```js
this.coprocessors = [];         // [{ id, star }] 已拥有（star ∈ 1..3）
this.fragments = {};            // { [coprocessorId]: count }
this.activeCoprocessor = null;  // 装载中的协处理器 id（单一装载；协同槽多装载是 M6）
```

方法（全部服务端权威，返回结构化结果供调用方广播/持久化）：

| 方法 | 语义 |
|------|------|
| `addCoprocessor(id)` | 未拥有 → 入库 ★=1，返回 `{ status: 'granted', star: 1 }`；已拥有 → 折 `COPROCESSOR_SHOP.DUPLICATE_FRAGMENTS` 碎片，返回 `{ status: 'duplicate', fragments }`；未知 id → `{ status: 'invalid' }` |
| `addFragment(id, count=1)` | 校验 id 后累加，返回 `{ coprocessorId, count, total }`；未知 id 抛错（内部 bug，非玩家输入） |
| `canUpgradeCoprocessor(id)` | `{ ok, reason?, cost? }`：未拥有 `not_owned` / 满星 `max_star` / 碎片不足 `insufficient_fragments` |
| `upgradeCoprocessor(id)` | 校验通过 → 扣碎片、`star+1`，返回 `{ ok: true, star }` |
| `setActiveCoprocessor(id\|null)` | null = 卸下；否则校验已拥有，返回 `{ ok, reason? }` |

**为何不做 socket 交互入口**：升级/装载需要图鉴 UI 与技能盘架构决策（协处理器技能占哪个槽位与 M6 skill-disk 耦合），本变更只交付数据能力与单测；`EVENTS.COPROCESSOR_FRAGMENT` 是掉落反馈（与掉落同源），`coprocessor:upgraded`/`coprocessor:equipped` 随 M6 交互层一起加，现在加就是死代码。

`serialize()` 输出 `coprocessors`/`fragments`/`activeCoprocessor`（客户端图鉴/HUD 数据源，经既有 `player:update` 广播，零协议破坏）。

## 5. 碎片来源接线

共享助手 `server/game/CoprocessorDrops.js`（无状态模块函数，不占插件服务注册）：

```js
rollCoprocessorId()                       // 16 个 id 均匀随机
rollFragmentGrant(player, source, { store, socket })
// rate = COPROCESSOR_FRAGMENT_SOURCES[source].rate
// Math.random() < rate → player.addFragment(id, 1) + store.markDirty
//   + socket.emit(COPROCESSOR_FRAGMENT, { coprocessorId, count, total, source })
// 返回 grant 结果或 null
```

三个接线点：

1. **副本通关**（`PvEManager.completeDungeon`）：每个参与玩家各 roll 一次，`source = dungeon.players.size >= 2 ? 'TEAM_BOSS' : 'SOLO_BOSS'`（GDD §3.4 单人 15%/团队 30%）。放在既有 `store.persist(player)` 事务点之前，掉落随通关奖励一起落盘；
2. **PvP 连胜宝箱**（`PvPManager.endMatch`）：连胜奖励分支内（`winStreak >= 3 && streakRewardsClaimed < cap`）以 `PVP_STREAK`（10%）roll——宝箱与碎片同一触发点，GDD §3.4"PvP 连胜宝箱 (3 连胜): 10%"；
3. **商店**（`routes/shop.js`）：`contents.coprocessor` 为真的礼包 → `pickUnownedCoprocessor(player)` 随机选一个未拥有 id 调 `player.addCoprocessor`；16 个全拥有时 `addCoprocessor` 自动折碎片（DUPLICATE_FRAGMENTS=3）。`received.coprocessor` 从布尔升级为 `{ id, status }`，关掉旧 TODO。

随机源统一 `Math.random()`（服务端），与既有 `rollRarity` 一致；测试用 `vi.spyOn(Math, 'random')` 锁定。

## 6. 持久化与兼容

| 字段 | 持久化 | 理由 |
|------|--------|------|
| `coprocessors`/`fragments`/`activeCoprocessor` | ✅ | 收集进度是跨会话状态，重启不应清零（否则刷重启刷碎片） |

`fromSave`：三个字段缺失 → `[]`/`{}`/`null`（旧存档默认空图鉴，与"从未拥有"语义一致）。热路径：掉落/升级后 `store.markDirty(player)`，60s 自动保存兜底；商店/副本/PvP 三个接线点都踩在既有 `store.persist` 事务点上，不新增事务。

## 7. 测试策略

- `test/coprocessor.test.js`（新）：
  - 图鉴完整性：16 个定义、4×4 分类、id 唯一、三星结构、`UPGRADE_COSTS` 长度 2；
  - Player：addCoprocessor 授予/重复折算/未知 id、addFragment 累加、升级链路（碎片不足拒绝/满星拒绝/成功扣碎片）、setActive 校验、serialize/toSave 字段；
  - fromSave 旧存档兼容（三字段缺失 → 空）；
  - 掉落助手：rate 边界（`Math.random` mock 0.99 不掉 / 0.01 掉）、markDirty 调用、事件 payload、均匀分布抽样；
  - 商店礼包：premium 购买后 coprocessors +1（mock Math.random 锁定 id）；
  - PvE/PvP 接线：mock 掉率后 completeDungeon/endMatch 路径产出碎片。
- 全量 `npm test` ≥ 159 绿。
