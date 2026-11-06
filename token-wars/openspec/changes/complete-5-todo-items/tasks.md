# Tasks: Complete 5 Core TODO Items

## Phase 1 — 技能盘装备服务端同步 (P0)

### Task 1.1: 协议层新增 C→S 事件
- [ ] 在 `shared/protocol.js` 中新增 `SKILL_DISK_EQUIP: 'skill_disk:equip'` 事件
- [ ] 注释标注 `// C→S: { tokenId, slotIndex }`

### Task 1.2: Player 模型新增 equipToken 方法
- [ ] 在 `server/models/Player.js` 新增 `equipToken(tokenId, slotIndex)` 方法
  - 校验 slotIndex 在 0-15 范围内
  - 校验该 slot 已解锁（通过 `this.unlock.gridSize`）
  - 查找 token 在 `stableTokens` 中的索引
  - 若 slot 已有 token：旧 token push 回 `stableTokens`
  - 取出目标 token 并设置到 `equippedTokens[slotIndex]`
  - 返回 `{ success, oldToken }`

### Task 1.3: 服务端注册事件处理
- [ ] 在 `server/index.js` 中 `socket.on(EVENTS.SKILL_DISK_EQUIP, ...)` 注册处理
  - 从 socket 获取 player
  - 调用 `player.equipToken()`
  - 成功后 emit `EVENTS.SKILL_DISK_UPDATE` 和 `EVENTS.INVENTORY_UPDATE`
  - 失败时 emit `EVENTS.ERROR`

### Task 1.4: 客户端发送装备请求
- [ ] 修改 `client/src/scenes/InventoryScene.js` L166
  - 替换 `console.log` 为 `net.emit('skill_disk:equip', { tokenId: token.id, slotIndex: slot.index })`
  - 拖动结束后 snap back 位置
- [ ] 监听 `skill_disk:update` 事件刷新技能盘 UI
- [ ] 监听 `inventory:update` 事件刷新背包 UI

### Task 1.5: 测试验证
- [ ] 手动测试：拖拽 Token 到技能盘 → 确认 atk/def 属性变化
- [ ] 手动测试：替换已装备 Token → 确认旧 Token 回归背包
- [ ] 手动测试：拖拽到未解锁格子 → 确认被拒绝

---

## Phase 2 — 协处理器 Token 背包逻辑 (P0)

### Task 2.1: Player 模型扩展
- [ ] `server/models/Player.js` 构造函数新增 `this.coprocessorTokens = []`
- [ ] `toSave()` 新增 `coprocessorTokens: this.coprocessorTokens`
- [ ] `fromSave()` 处理 `data.coprocessorTokens`

### Task 2.2: 商城购买入包逻辑
- [ ] `server/routes/shop.js` L62-65 替换 TODO
  - 从 `COPROCESSORS` 常量中随机选取一个 id
  - 若玩家不拥有该协处理器：`player.coprocessorTokens.push(id)`
  - 若已拥有：重新随机（最多重试 3 次），避免重复
  - `received.coprocessor = coprocessorId`

### Task 2.3: 客户端协议同步
- [ ] `Player.serialize()` 包含 `coprocessorTokens`
- [ ] Client 端 `player:update` 事件已携带该字段（无需修改）
- [ ] InventoryScene 显示已拥有的协处理器列表（可选 UI）

### Task 2.4: 测试验证
- [ ] 购买高级/传说算力包 → 确认 coprocessorTokens 增加
- [ ] 重复购买 → 确认给予不同协处理器
- [ ] 重启服务器 → 确认协处理器 Token 持久化

---

## Phase 3 — Boss P2/P3 阶段技能执行 (P1)

### Task 3.1: Boss 阶段技能定义
- [ ] 在 `shared/constants.js` 或 Monster 模型中定义 Boss 技能配置
  - `token_drain`: range=3, unstableCost=3, damageIfNoToken=20, cooldown=8000
  - `enrage`: atkMultiplier=1.5, cooldownReduction=0.5, duration=10000 (一次性)

### Task 3.2: dungeonTick 增加 Boss 阶段逻辑
- [ ] 在 `PvEManager.js` `dungeonTick()` 中，怪物 AI 循环内增加：
  - `if (!monster.isBoss) continue;` 跳过非 Boss
  - 检查 `monster.currentPhase > 0` 且阶段技能冷却满足
  - 执行 `executeBossAbility(monster, phase, dungeon)`
- [ ] 实现 `executeBossAbility()`:
  - `token_drain`: 查找范围 3 内所有玩家，每人消耗 3 unstableToken；若不足则造成 20 伤害
  - `enrage`: `monster.atk *= 1.5`, `monster.attackCooldown = 500`, 一次性
  - 广播 `DUNGEON_BOSS_PHASE` 事件

### Task 3.3: 广播 Boss 阶段事件
- [ ] 阶段过渡时广播 `DUNGEON_BOSS_PHASE: { phase, bossHpPercent }`
- [ ] 客户端 CombatScene 监听该事件（已有 `dungeon:boss_phase` 事件定义）
- [ ] MonsterSprite 根据阶段显示不同视觉效果（P2 黄色光环 / P3 红色狂躁光圈）

### Task 3.4: 测试验证
- [ ] 副本中 Boss HP 降至 60% → 确认 token_drain 触发
- [ ] Boss HP 降至 30% → 确认 enrage 触发，攻击力翻倍
- [ ] 客户端 HUD 显示阶段变化

---

## Phase 4 — PvP 缩圈实现 (P1)

### Task 4.1: Arena 模型扩展
- [ ] `server/models/Arena.js` 新增字段：
  - `this.shrinkRadius = MAP_WIDTH / 2 + MAP_HEIGHT / 2`
  - `this.hazardTiles = new Set()` (存储 "x,y" 字符串)
- [ ] `serialize()` 包含 `shrinkRadius`, `hazardTiles`

### Task 4.2: 缩圈逻辑实现
- [ ] `PvPManager.js` 新增 `updateHazardTiles(arena)` 方法
  - 遍历 mapData 所有格子
  - 距离中心 > shrinkRadius → `mapData[y][x] = TILE.HAZARD`
  - 存入 `arena.hazardTiles`
- [ ] `arenaTick()` L143-147 替换注释为实际逻辑
  - 90s 后开始计算 shrinkProgress
  - 30s 内线性缩小到 0
  - 每次半径变化时调用 `updateHazardTiles()` 并广播
- [ ] HAZARD 伤害：`arenaTick()` 中检查玩家是否在 hazard 格子上 → 每 tick 5 HP

### Task 4.3: 数据核心交互
- [ ] `arenaTick()` 中数据核心生成后，新增玩家对核心攻击的处理
  - 在 `server/index.js` 的 `INPUT_SKILL` 处理中增加数据核心目标检测
  - 或通过 `arenaTick` 中每 tick 检查邻近玩家进行持续攻击
  - 核心 HP 归零 → 攻击方队伍直接获胜
- [ ] 广播 `pvp:data_core_damage` 事件

### Task 4.4: 客户端渲染更新
- [ ] `CombatScene.js` `setupNetworkListeners()` 新增：
  - `pvp:shrink_update` 事件监听 → 调用 `renderMap()` 或增量更新 HAZARD tile
  - HAZARD tile 使用 `tile_hazard` 纹理（已定义）
  - 玩家站在 HAZARD 上时屏幕刷新红闪烁效果

### Task 4.5: 测试验证
- [ ] PvP 匹配后等待 90s → 确认四周边界变成 HAZARD
- [ ] 站在 HAZARD 上 → 确认持续掉血
- [ ] 120s 数据核心生成 → 确认可攻击
- [ ] 击破数据核心的团队直接获胜

---

## Phase 5 — 赛季重置 & 匹配扩圈 (P2)

### Task 5a.1: 赛季数据追踪
- [ ] 创建 `server/data/season.js` 模块
  - `seasonNumber`, `seasonStartTime`
  - `checkSeasonRollover()` - 判断是否超过 4 周
  - `applySeasonReset(player)` - 执行重置
  - 持久化到 `season.json`（与 Store 模式一致）

### Task 5a.2: 重置逻辑
- [ ] `server/game/GameEngine.js` tick 中增加赛季检查（每 60s 一次即可）
  - 若赛季切换：遍历所有在线玩家执行 reset
- [ ] Player 模型新增 `applySeasonReset()` 方法
  - `level = Math.max(1, Math.floor(level * 0.7))`
  - `xp = 0`
  - `pvpRating = Math.floor((pvpRating + 1000) / 2)`
  - `winStreak = 0`
  - 保留 `equippedTokens`, `stableTokens`, `coprocessorTokens`, `miningLevel`
  - `toSave()`/`fromSave()` 无需变更（字段已存在）

### Task 5a.3: 玩家通知
- [ ] 赛季切换时全服广播 `season:new { seasonNumber, rules }`
- [ ] 客户端 LobbyScene 显示当前赛季编号

### Task 5b.1: 匹配队列时间追踪
- [ ] `PvPManager.joinQueue()` - queueEntry 新增 `joinTime: Date.now()`
- [ ] `PvPManager.leaveQueue()` - 不变（filter 已保留字段）

### Task 5b.2: 匹配扩圈逻辑
- [ ] `PvPManager.tryMatch()` 修改：
  - 正常匹配：按评分排序取前 N 人（现有逻辑）
  - 若 `now - queue[0].joinTime > 120000`：
    - 取队首玩家的 rating
    - 筛选 `abs(rating - firstRating) <= 500` 的玩家
    - 若 ≥ requiredPlayers，取前 N 人匹配
  - 若扩圈后仍不足，继续等待
- [ ] 日志输出扩圈匹配事件

### Task 5b.3: 测试验证
- [ ] 两名评分差 400 的玩家同时排队 → 2 分钟后确认能匹配
- [ ] 赛季切换 → 确认等级和评分被重置
- [ ] 重启服务器 → 赛季编号和开始时间持久化正确

---

## Phase 6 — 集成验证

- [ ] 全功能烟雾测试：登录 → 购买 → 装备 → 副本 → Boss 阶段 → PvP 匹配 → 缩圈 → 数据核心
- [ ] 检查所有 TODO 注释已移除
- [ ] 检查 `openspec validate complete-5-todo-items` 通过

## 依赖关系

```
Phase 1 和 Phase 2 可并行
Phase 3 和 Phase 4 可并行  
Phase 5 在所有 Phase 之后（不依赖其他 Phase）
Phase 1 → Phase 2 无依赖（修改不同文件）
Phase 3 → Phase 4 无依赖（修改不同文件）
```

## 风险标注

| Phase | 风险 | 等级 |
|-------|------|------|
| 1.3 | 服务端校验逻辑需与客户端解锁状态同步 | 低 |
| 2.2 | 协处理器种类有限（4种），反复购买可能重复 | 中 |
| 3.2 | Boss enrage 后数值可能过强 | 中 |
| 4.2 | 缩圈+HAZARD伤害+数据核心三条路径耦合 | 中 |
| 5a.2 | 赛季重置可能导致玩家数据丢失感 | 低 |
