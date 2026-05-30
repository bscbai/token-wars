# Design: Complete 5 Core TODO Items

## Architecture Overview

所有变更都在现有模块内完成，不引入新模块。变更遵循现有架构模式：服务端权威验证 + 客户端输入预测。

## 1. 技能盘装备服务端同步 (`skill-disk-equip`)

### 数据流

```
InventoryScene (拖拽) → C→S: skill_disk:equip({tokenId, slotIndex})
  → server/index.js 接收事件
  → CombatSystem.validateEquip() 校验
  → Player.equipToken(tokenId, slotIndex)
  → S→C: skill_disk:update({equippedTokens})
  → S→C: inventory:update({stableTokens, unstableTokens, equippedTokens})
```

### 服务端校验逻辑

1. `slotIndex` 必须在 0-15 范围内
2. `slotIndex` 对应的格子必须已解锁（`player.unlock.gridSize`）
3. `tokenId` 必须存在于 `player.stableTokens` 中
4. 装备时：从 `stableTokens` 移除 → 存入 `equippedTokens[slotIndex]`
5. 该 slot 已有 Token 时：旧的回到 `stableTokens`，新的装备上去
6. 之后无需手动触发 ATK/DEF 重算 — Player 的 `atk`/`def` 是计算属性 getter

### 关键编码位置

- `server/index.js` L88-115 附近：新增 `socket.on(EVENTS.SKILL_DISK_EQUIP, ...)`
- `server/models/Player.js`：新增 `equipToken(tokenId, slotIndex)` 方法
- `client/src/scenes/InventoryScene.js` L166：替换 `console.log` 为 `net.emit('skill_disk:equip', ...)`

## 2. 协处理器 Token 背包逻辑 (`coprocessor-inventory`)

### 数据结构

Player 模型新增字段：
```js
this.coprocessorTokens = []; // ['lightning_surge', 'shield_overload', ...]
```

### 购买流程修改

`server/routes/shop.js` L62-65：
- 从 `COPROCESSORS` 中随机选取一个（或按 `rollRarity` 加权）
- 调用 `player.coprocessorTokens.push(coprocessorId)`
- `toSave()` 中序列化 `coprocessorTokens`
- `fromSave()` 中还原 `coprocessorTokens`

### 后续扩展（不在本次范围）

- 协处理器 Token 的技能槽位（当前 Q/W/E/R 技能栏如何嵌入协处理器技能）
- 免费版 vs 付费版的选择逻辑
- 碰撞时展示

## 3. Boss P2/P3 阶段技能执行 (`boss-phase-abilities`)

### 阶段检测

Monster.takeDamage() 已在 L137-145 实现 `currentPhase` 更新，阶段过渡时机已正确。需要的是在 `dungeonTick()` 中检查当前阶段并执行对应技能。

### 阶段技能定义

| 阶段 | HP | 技能 | 效果 | 冷却 |
|------|-----|------|------|------|
| P1 | 100% | melee_swing | 基础近战（已有） | 1s |
| P2 | 60% | token_drain | 拉近玩家(范围3)+消耗3不稳定Token | 8s |
| P3 | 30% | enrage | ATK×1.5，攻击冷却减半，持续10s | 一次性 |
| P3 | 30% | melee_swing | 攻速更快 | 0.5s |

### 实现位置

`server/game/PvEManager.js` `dungeonTick()` L118-170 内的怪物 AI 循环：
- 在现有 `monster.attackCooldown` 检查后，增加 boss 阶段技能检查
- `if (monster.isBoss && now - monster.lastAbilityTime >= monster.abilityCooldown)` 时执行阶段技能
- `token_drain`: 范围 3 内所有玩家消耗 3 unstableToken，若不足则额外受到 20 伤害
- `enrage`: 设置 `monster.atk *= 1.5`，`monster.attackCooldown = 500`（一次性触发）
- 广播 `DUNGEON_BOSS_PHASE` 事件给客户端

## 4. PvP 缩圈实现 (`pvp-shrink-zone`)

### 缩圈机制

```
0-90s: 全场可走
90s+: 从边缘向内缩圈
  - shrinkRadius 从 maxDist 逐渐缩小到 0（线性，30s 内缩到中心）
  - 距离地图中心 > shrinkRadius 的格子设为 TILE.HAZARD
  - 玩家站在 HAZARD 上每 tick 受到 5 HP 伤害
120s: 数据核心在中心生成（已有 `dataCoreSpawned` 逻辑）
```

### Arena 模型变更

```js
this.shrinkRadius = MAP_WIDTH / 2 + MAP_HEIGHT / 2; // 初始全图
this.hazardTiles = new Set(); // 当前危险格子坐标 "x,y"
```

### arenaTick 修改

`server/game/PvPManager.js` L143-147：
```js
if (elapsed >= PVP.SHRINK_TIME) {
  const shrinkProgress = (elapsed - PVP.SHRINK_TIME) / 30000;
  const maxDist = MAP_WIDTH / 2 + MAP_HEIGHT / 2;
  const newRadius = Math.max(0, maxDist * (1 - shrinkProgress));
  if (newRadius !== arena.shrinkRadius) {
    arena.shrinkRadius = newRadius;
    this.updateHazardTiles(arena);
    this.broadcastToArena(arena, 'pvp:shrink_update', { hazardTiles: [...arena.hazardTiles] });
  }
}
```

### 客户端渲染

`CombatScene.js` 在 `renderMap()` 中已支持 `TILE.HAZARD` (使用 `tile_hazard` 纹理)。需要接受 `pvp:shrink_update` 事件来增量更新地图格子。

### 数据核心损伤

已有的 `dataCoreSpawned` 逻辑保留。新增：玩家在数据核心相邻格攻击时对核心造成伤害。核心 HP = PVP.CORE_HP (500)。击破核心的队伍直接获胜。

## 5. 赛季重置 & 匹配扩圈

### 5a. 赛季重置 (`season-reset`)

**服务端全局状态**（Store 或独立 module）：

```js
server/data/season.js
  seasonNumber: 1
  seasonStartTime: Date.now()
  checkSeasonRollover(): 比较 now - seasonStartTime > 4 * 7 * 24 * 3600 * 1000
```

**重置逻辑**（在 GameEngine tick 或玩家登录时检查）：

```js
function applySeasonReset(player) {
  player.level = Math.max(1, Math.floor(player.level * 0.7));
  player.xp = 0;
  player.pvpRating = Math.floor((player.pvpRating + 1000) / 2);
  player.winStreak = 0;
  // 保留: equippedTokens, stableTokens, coprocessorTokens, miningLevel
}
```

### 5b. 匹配扩圈 (`matchmaking-expansion`)

**PvPManager 变更**：

```js
// queueEntry 新增 joinTime 字段
this.queues[mode].push({ playerId, rating, socket, joinTime: Date.now() });
```

**tryMatch() 修改**：
- 正常匹配：按评分排序取前 N 人
- 若队首玩家等待 > 120s：扩大匹配范围，从 ±200 评分差放宽到 ±500，按队列长度取最近 N 人

```js
if (now - queue[0].joinTime > 120000) {
  // Expanded match: take N players closest in rating (within ±500)
  const firstRating = queue[0].rating;
  const expanded = queue.filter(q => Math.abs(q.rating - firstRating) <= 500);
  if (expanded.length >= requiredPlayers) {
    const matched = expanded.slice(0, requiredPlayers);
    // ... proceed
  }
}
```

## Risk Assessment

| 风险 | 缓解 |
|------|------|
| 装备操作并发（多次快速拖拽） | 服务端 power-on 校验，socket 串行处理 |
| Boss 阶段技能过强导致副本不可过 | 数值先保守，后期可根据数据调整 |
| 缩圈过快导致 PvP 体验差 | 30s 线性缩圈，数值可通过常量调整 |
| 赛季重置导致玩家流失 | 保留装备 Token，等级软重置（70%），提前公告 |
| 匹配扩圈导致评分失衡匹配 | 扩圈仅在等待 > 2 分钟时触发，±500 仍有下限保证 |
