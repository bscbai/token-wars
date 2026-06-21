# Token Wars: 算力征途

> 赛博朋克风格多人在线竞技游戏 — Cyberpunk Multiplayer Browser Game

[![Node](https://img.shields.io/badge/Node-22-green)](https://nodejs.org)
[![Phaser](https://img.shields.io/badge/Phaser-3.85-blue)](https://phaser.io)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-4.8-black)](https://socket.io)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

## 🎮 游戏概述

Token Wars 是一款赛博朋克主题的多人在线竞技游戏。玩家收集算力 Token，训练 AI 代理，在实时 PvP 战斗和异步 AI 竞技场中争夺霸权。

- ⚔️ **实时 PvP 战斗** — WASD 操作 + 技能按键 + 闪避冲刺
- 🤖 **AI 傀儡竞技场** — 8 级决策树 AI + 3 星训练 + 4 特殊行为
- 🏆 **赛季与锦标赛** — 7 天循环赛季 + Top 16 巅峰对决
- 💎 **Token 经济系统** — 4 类别 × 4 稀有度 = 16 种 Token

## 🏗️ 技术栈

- **服务端**: Node.js 22 + Express + Socket.IO 4.8
- **客户端**: Phaser 3.85 + Socket.IO Client
- **部署**: Docker / Fly.io / Railway / Electron 桌面端
- **代码量**: ~8,500 行 JS / 15 个核心文件

## 🚀 快速开始

### 环境要求

- Node.js 22+
- npm 10+
- 现代浏览器（Chrome/Edge 推荐，WebGL 支持）

### 安装与运行

```bash
# 1. 克隆项目
git clone https://github.com/bscbai/token-wars.git
cd token-wars

# 2. 安装依赖
npm install

# 3. 启动服务器
npm start

# 4. 打开浏览器
# 访问 http://localhost:3000
```

### 一键发布素材（可选）

```bash
# 生成所有 Steam 素材（capsule + 截图 + 图标）
npm run pre-deploy

# 检查素材完整性
npm run check-assets
```

## 📁 项目结构

```
token-wars/
├── client/                          # 客户端
│   ├── public/                      # 静态资源
│   │   ├── index.html               # 游戏入口
│   │   ├── lib/                     # 本地 Phaser + Socket.IO
│   │   └── assets/                  # 图片/音频资源
│   ├── shared/constants.js          # 浏览器常量
│   └── src/
│       ├── scenes/                  # Phaser 场景
│       │   ├── LobbyScene.js        # 主菜单
│       │   ├── CombatScene.js       # PvP 战斗
│       │   └── AIArenaScene.js      # AI 竞技场
│       └── systems/
│           └── NetworkManager.js    # Socket.IO 客户端
├── server/                          # 服务端
│   ├── index.js                     # Express + Socket.IO 入口
│   ├── game/AIArenaManager.js       # AI 竞技场逻辑
│   └── models/AIAgent.js            # AI 代理模型
├── shared/constants.js              # Node 常量
├── scripts/                         # 工具脚本
│   ├── build-client.js              # 生产构建
│   ├── dev-server.js                # 开发服务器
│   ├── export-steam-assets.js       # Steam 素材导出
│   ├── generate-missing-assets.js   # 补齐缺失素材
│   ├── generate-icons.js            # 应用图标
│   ├── check-assets.js              # 素材完整性检查
│   └── check-all-syntax.js          # JS 语法检查
├── docs/game-design.md              # 完整 GDD（15 章）
├── Dockerfile / fly.toml            # 部署配置
├── DEPLOY.md                        # 部署指南（4 种方案）
├── PUBLISH.md                       # Demo 发布指南
├── qa-report.md                     # 代码质量报告
└── package.json
```

## 🎯 核心玩法

### 实时 PvP 战斗

| 按键 | 动作 |
|------|------|
| WASD / 方向键 | 移动 |
| J | 近战攻击（25 伤害，0.8s 冷却）|
| K | 远程射击（15 伤害，400 范围）|
| Space | 闪避冲刺（150px，3s 冷却）|
| E | 使用道具 |
| ESC | 返回菜单 |

### AI 傀儡竞技场

- **训练系统**: 1 星 → 2 星 (50 EXP) → 3 星 (150 EXP)
- **4 特殊行为** (3 星解锁):
  - 狂暴战士 (HP<30% 攻击翻倍)
  - 完美防御 (每 5 回合格挡一次)
  - 贪婪算法 (Token 拾取 +50%)
  - 闪避大师 (15% 概率闪避)
- **5 张地图** + **3 种赛季 Buff** + **Top 16 锦标赛**

## 🚢 部署

详细部署指南见 [DEPLOY.md](./DEPLOY.md)，支持：

- **Fly.io** — 5 分钟部署，免费额度
- **Railway** — GitHub 自动部署
- **Render** — Web Service 蓝图
- **Docker** — 自托管

Steam 发布流程见 [PUBLISH.md](./PUBLISH.md)。

## 📊 代码状态

| 指标 | 数值 |
|------|------|
| 代码健康评分 | **88 / 100** |
| P0 问题 | 0 |
| P1 问题 | 0 |
| P2 问题 | 1（持久化层，Demo 可接受）|
| 文档完整性 | 15/15 章节 |

## 📝 文档

- [游戏设计文档 (GDD)](./docs/game-design.md) — 15 章完整设计
- [发布指南](./PUBLISH.md) — Steam / itch.io / 云部署
- [部署指南](./DEPLOY.md) — 4 种部署方案
- [代码质量报告](./qa-report.md) — 15 个问题 / 14 已修复
- [项目概览](./overview.md) — 整体架构

## 📄 License

MIT License — 详见 [LICENSE](./LICENSE)

---

**当前版本**: v0.3.0 | **最后更新**: 2026-06-22
