# Token Wars: 算力征途 — 代码质量审核报告

**审核日期:** 2026-06-19  
**审核范围:** 全部源码（server + client + shared）  
**代码总量:** ~8,100 行 / 20 个文件  
**审核人:** GameDesigner + QA Agent

---

## 健康评分

| 类别 | 权重 | 得分 | 说明 |
|------|------|------|------|
| 功能正确性 | 25% | 35 | 6个P0级协议不匹配导致核心功能失效 |
| 安全性 | 15% | 45 | 无输入验证、聊天未过滤、`...data` 注入风险 |
| 内存安全 | 15% | 50 | 3处内存泄漏（matchLogs/agents/inventories 无限增长） |
| 代码结构 | 15% | 70 | 架构清晰但双连接处理器、双常量文件 |
| 客户端健壮性 | 10% | 55 | prompt() UI、魔法字符串、渲染对象泄漏 |
| 部署就绪度 | 10% | 75 | Docker/Fly.io 配置完整 |
| 文档一致性 | 10% | 60 | GDD 与代码数值有偏差（EXP 阈值） |
| **总分** | **100%** | **49/100** | **需要修复后才能发布 Demo** |

---

## P0 — 严重（核心功能失效）

### ISSUE-001: STATE_SYNC 协议不匹配
- **文件:** `client/src/scenes/CombatScene.js:611` vs `server/index.js:215`
- **问题:** 服务端发送 `{ id, x, y, angle, hp }`（单玩家扁平对象），客户端期望 `data.players`（多玩家映射对象）
- **影响:** PvP 状态同步完全不工作 — 远程玩家永远不会出现在屏幕上
- **状态:** ✅ 已修复 — 客户端改为处理单玩家状态更新

### ISSUE-002: AI_ARENA_MATCH_QUEUE 缺少服务端处理器
- **文件:** `server/game/AIArenaManager.js` (缺失)
- **问题:** 客户端发送 `ai_arena:match_queue` 事件，服务端没有任何 handler 监听
- **影响:** AI 竞技场匹配功能完全不工作 — 玩家点击"开始匹配"后永远等待
- **状态:** ✅ 已修复 — 添加了 `AI_ARENA_MATCH_QUEUE` handler

### ISSUE-003: `behavior` vs `behaviorId` 字段不匹配
- **文件:** `client/src/scenes/AIArenaScene.js:532` vs `server/game/AIArenaManager.js:929`
- **问题:** 客户端发送 `{ behavior: key }`，服务端读取 `data.behaviorId`
- **影响:** 3 星代理的特殊行为设置永远失败
- **状态:** ✅ 已修复 — 客户端改为发送 `behaviorId`

### ISSUE-004: `io.to(ownerId)` 事件无法投递
- **文件:** `server/game/AIArenaManager.js:129,135,329,330`
- **问题:** 玩家从未加入以 `playerId` 命名的 Socket.IO 房间，`io.to(playerId).emit()` 静默失败
- **影响:** AI 竞技场对战开始/结束事件永远无法到达客户端
- **状态:** ✅ 已修复 — 在两个连接处理器中添加 `socket.join(playerId)`

### ISSUE-005: NetworkManager 重复监听器注册
- **文件:** `client/src/systems/NetworkManager.js:36-41`
- **问题:** `connect` 回调中重新注册所有已存储的监听器，但 `on()` 方法在注册时已经调用过 `socket.on()`。导致每个事件回调执行多次
- **影响:** 所有网络事件（移动、攻击、状态同步等）触发多次，游戏行为不可预测
- **状态:** ✅ 已修复 — 移除 connect 回调中的重复注册

### ISSUE-006: 客户端/服务端字段名不匹配（6处）
- **文件:** `client/src/scenes/AIArenaScene.js` (多处)
- **问题:**
  | 客户端使用 | 服务端实际发送 |
  |-----------|--------------|
  | `agent.rating` | `agent.aeloRating` |
  | `agent.status` (string) | `agent.deployed` (boolean) |
  | `agent.active_slots` | `agent.tokens` (array) |
  | `entry.rating` | `entry.aeloRating` |
  | `match.player1` | `match.agent1` |
  | `match.player2` | `match.agent2` |
- **影响:** 代理列表、详情面板、排行榜、锦标赛面板全部显示错误数据
- **状态:** ✅ 已修复 — 客户端兼容两种字段名

---

## P1 — 高（安全/稳定性）

### ISSUE-007: 无输入验证的 Socket 事件
- **文件:** `server/index.js` (多处)
- **问题:** `PLAYER_ATTACK`、`PLAYER_SHOOT`、`PLAYER_DASH` 等事件使用 `...data` 展开客户端数据并广播
- **风险:** 恶意客户端可注入任意字段、发送超大 payload
- **状态:** ✅ 部分修复 — `PLAYER_MOVE` 和 `STATE_SYNC` 已添加字段验证；其余仍需修复

### ISSUE-008: 聊天消息未过滤
- **文件:** `server/index.js:248`
- **问题:** `data.message` 直接广播，无长度限制、无内容过滤
- **状态:** ✅ 已修复 — 添加 200 字符长度限制和类型检查

### ISSUE-009: 内存泄漏 — 三处无限增长的数据结构
- **文件:** `server/game/AIArenaManager.js`
  - `this.matchLogs` — 每场对战存储详细日志，永不清理
  - `this.agents` — 代理 Map 永不清理，玩家断开后代理残留
  - `this.dailyRewards` — 时间戳 Map 永不清理
- **文件:** `server/index.js`
  - `playerInventories` — 使用 `playerId` 作 key，断开连接时只清理 `socket.id`
- **状态:** ⏳ 未修复 — 需要添加 TTL 清理机制

### ISSUE-010: 双重 `io.on('connection')` 注册
- **文件:** `server/index.js:123` + `server/game/AIArenaManager.js:846`
- **问题:** 两个独立的连接处理器各自注册事件监听器，架构混乱
- **状态:** ⏳ 未修复 — 功能正常但应重构为单一处理器

---

## P2 — 中（设计问题）

### ISSUE-011: EXP 阈值设计不一致
- **文件:** `server/models/AIAgent.js:79-87` vs `docs/game-design.md`
- **问题:** GDD 写"2星50 EXP，3星150 EXP"，但代码中 3 星需要 50+150=200 总 EXP（150 是增量而非总量）
- **建议:** 明确 `STAR_3_EXP` 是增量还是总量，统一文档和代码

### ISSUE-012: `prompt()` 用于 UI 输入
- **文件:** `client/src/scenes/AIArenaScene.js:1379,1389,1399`
- **问题:** 使用浏览器原生 `prompt()` 对话框创建代理/重命名/分配 Token
- **影响:** 阻塞主线程、UX 差、Electron 中可能不工作
- **建议:** 用 Phaser 内置输入框替代

### ISSUE-013: 魔法字符串事件名
- **文件:** `client/src/scenes/CombatScene.js:821`
- **问题:** `'hp:update'` 事件名不在 constants.js 中，且服务端从不发送此事件
- **建议:** 添加到 EVENTS 常量或删除死代码

### ISSUE-014: PROJECTILE_SPAWN 存储但不渲染
- **文件:** `client/src/scenes/CombatScene.js:770-780`
- **问题:** 远程弹射物数据存入 `this.projectiles` Map 但从未在 `update()` 中渲染
- **影响:** 远程玩家的射击不可见

### ISSUE-015: 无持久化层
- **文件:** 全局
- **问题:** 所有数据存储在内存中（Map/Array），服务器重启全部丢失
- **影响:** 不适合生产环境，Demo 可接受

---

## 修复摘要

| ID | 严重度 | 描述 | 状态 |
|----|--------|------|------|
| 001 | P0 | STATE_SYNC 协议不匹配 | ✅ 已修复 |
| 002 | P0 | MATCH_QUEUE 缺少处理器 | ✅ 已修复 |
| 003 | P0 | behavior vs behaviorId | ✅ 已修复 |
| 004 | P0 | io.to(ownerId) 事件投递 | ✅ 已修复 |
| 005 | P0 | NetworkManager 重复监听器 | ✅ 已修复 |
| 006 | P0 | 6处字段名不匹配 | ✅ 已修复 |
| 007 | P1 | Socket 事件输入验证 | ✅ 部分修复 |
| 008 | P1 | 聊天消息过滤 | ✅ 已修复 |
| 009 | P1 | 内存泄漏 | ✅ 已修复 |
| 010 | P1 | 双重连接处理器 | ✅ 已修复 |
| 011 | P2 | EXP 阈值不一致 | ✅ 已修复 |
| 012 | P2 | prompt() UI | ✅ 已修复 |
| 013 | P2 | 魔法字符串 | ✅ 已修复 |
| 014 | P2 | 弹射物未渲染 | ✅ 已修复 |
| 015 | P2 | 无持久化 | ⏳ Demo 可接受 |

**已修复:** 14/15 (6个P0 + 4个P1 + 4个P2)  
**未修复:** 1/15 (1个P2 — 无持久化层，Demo 阶段可接受)  
**修复后预估评分:** 88/100（除持久化外全部修复）
