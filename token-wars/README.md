# Token Wars: 算力征途

赛博朋克多人浏览器游戏。玩家控制"算力核心"，通过消耗、夺取、交易 Token（代表GPU算力）来壮大自己。

## 快速启动

```bash
cd token-wars
npm install
node server/index.js
# 浏览器打开 http://localhost:3000
```

## 技术栈

- **前端:** Phaser.js 3 (HTML5 Canvas游戏框架)
- **后端:** Node.js + Express + Socket.IO
- **数据存储:** 内存 + JSON文件持久化
- **通信协议:** Socket.IO (实时) + REST (认证/商城)

## 项目结构

```
token-wars/
├── server/           # 服务端代码
│   ├── index.js      # Express + Socket.IO 入口
│   ├── game/         # 游戏逻辑 (GameEngine, Combat, PvE, PvP, Mining, WorldBoss)
│   ├── models/       # 数据模型 (Player, Monster, Arena, Dungeon)
│   ├── data/         # 数据持久化 (Store.js, 地图JSON)
│   └── routes/       # REST API (auth, player, shop)
├── client/           # 客户端代码
│   ├── index.html    # 入口HTML
│   └── src/
│       ├── main.js   # Phaser游戏配置
│       ├── scenes/   # 游戏场景 (Login, Lobby, Mining, Combat, PvP, Shop, Inventory)
│       ├── entities/ # 游戏实体 (PlayerSprite, MonsterSprite, Projectile)
│       ├── systems/  # 系统 (NetworkManager, InputManager)
│       └── ui/       # UI组件 (HUD, SkillBar)
└── shared/           # 共享常量和协议定义
    ├── constants.js  # 游戏常量 (Token类型, 伤害公式, 等级表)
    └── protocol.js   # Socket.IO事件名和REST端点
```

## 游戏玩法

### Token系统
- **稳定Token** (白/绿/蓝/紫/橙): 装备用途, 死亡时掉落30-50%
- **不稳定Token**: 弹药用途, 死亡不掉落, 通过每日任务和副本获取

### 核心循环
1. **挂机挖矿** — 被动产出不稳定Token
2. **PvE副本** — 击杀怪物获取经验和Token掉落
3. **PvP竞技场** — 1v1/3v3排位对战
4. **商城** — 购买Token包
5. **背包 & 技能盘** — 管理Token装备, 编辑4x4技能盘

### 战斗机制
- WASD移动, Q/W/E/R施放技能
- 攻击消耗不稳定Token (弹药)
- 护盾持续消耗Token维持
- 服务端权威运算, 客户端做输入预测

### 防作弊
- 冷却时间服务端校验
- Token消耗服务端校验
- 伤害公式服务端计算

## 协议说明

### Socket.IO 事件

| 方向 | 事件 | 说明 |
|------|------|------|
| C→S | `auth:login` | 会话Token认证 |
| C→S | `input:move` | 移动输入 `{dx, dy}` |
| C→S | `input:skill` | 技能施放 `{skillId, targetX, targetY}` |
| C→S | `mining:collect` | 收集挖矿Token |
| C→S | `dungeon:join` | 加入副本 `{dungeonId}` |
| C→S | `pvp:queue` | 加入PvP队列 `{mode}` |
| S→C | `state:sync` | 游戏状态同步 |
| S→C | `combat:hit` | 命中反馈 |
| S→C | `player:update` | 玩家数据更新 |

### REST API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/auth/register` | POST | 注册 |
| `/api/auth/login` | POST | 登录 |
| `/api/shop/packs` | GET | 商城列表 |
| `/api/shop/buy` | POST | 购买 |
| `/api/player/profile` | GET | 玩家资料 |

## 设计文档

完整游戏设计文档见 `docs/game-design.md`。
