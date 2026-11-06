# Token Wars: 算力征途 — 架构与发布路线图

> **版本**: v1.0
> **更新日期**: 2026-07-03
> **状态**: 已确认，Phase 1 实施中
> **目标**: 发布到 Steam（优先）与 Epic Games Store（后续）
> **约束**: 单人开发、质量优先、无硬性发布日期、加固现有 Node 栈（不重写）

---

## 目录

1. [战略路径](#1-战略路径)
2. [现状评估](#2-现状评估)
3. [目标架构](#3-目标架构)
4. [发布路线图](#4-发布路线图)
5. [Phase 1 工程地基（详）](#5-phase-1-工程地基详)
6. [关键决策与权衡](#6-关键决策与权衡)
7. [后续阶段概要](#7-后续阶段概要)
8. [未决问题](#8-未决问题)

---

## 1. 战略路径

三条候选路径，选定 **A：地基优先**。

| 路径 | 顺序 | 风险 |
|---|---|---|
| **A. 地基优先（选定）** | 工程地基 → 核心玩法 → 留存系统 → 平台集成 → Beta/发布 | 上架稍慢，但每阶段有测试/持久化/监控兜底，适合单人质量优先 |
| B. 内容优先 | 垂直切片先好玩 → 再加固 → 平台 | 多人无可靠持久化/监控=上线即翻车 |
| C. 平台优先 | 先开 Steam 页攒愿望单 → 内容 → 加固 | 技术债大、Demo 质量难保 |

---

## 2. 现状评估

### 已具备

- 服务端权威架构：Node + Express + Socket.IO，20Hz tick（`GameEngine`），伤害/冷却/Token 消耗服务端计算。
- 反作弊基础：Socket.IO 速率限制 200 事件/60s、移动节流 80ms、墙体碰撞校验。
- 桌面打包：Electron + electron-packager（`npm run build`）可用。
- 服务端部署：Dockerfile + fly.toml（仅服务端）。
- 设计资产：GDD v2.1（`docs/game-design.md`）、发布清单（`docs/publishing-guide.md`）、网络改进方案（`NETWORK_IMPROVEMENT_PLAN.md`）。
- AI 竞技场 `AIArenaManager` 已部分落地（`ai_arena:*` 事件）。

### 缺口

| 领域 | 现状 | 问题 |
|---|---|---|
| 持久化 | `Store.js` JSON 文件 + 异步 `writeFile` | 无并发保护、重启窗口丢数据、大文件性能差 |
| 会话 | `auth.js` 内存 `Map` | 重启全员掉线、无过期/吊销 |
| 可观测 | 全 `console.log` | 无结构化日志、无指标、无 `/health` |
| 测试/CI | 无 | 任何改动无回归兜底 |
| 桌面多人模型 | `electron/main.js` 进程内起服务端 | 每个玩家跑独立世界，**非真多人** |
| 内容 | GDD 丰富但多数未实现 | 协处理器/连招/战斗三角/赛季/社交未落地 |
| 平台 | Steamworks/EOS 未开始 | 成就/云存档/Steam 认证缺失 |

---

## 3. 目标架构

加固现有 Node 栈，增量演进，不重写。

```
┌──────────────── 客户端层 ────────────────┐
│  Web:   Phaser（浏览器，Express 静态托管）│
│  桌面:  Electron + Phaser                │
│         - 默认连远程官方服务端 (SERVER_URL)│
│         - 可选内嵌服务端 = 离线/训练模式  │
│         - Phase 4 起: Steamworks SDK      │
│           (成就 / 云存档 / Rich Presence) │
└──────────────────┬───────────────────────┘
                   │ Socket.IO (WSS)
┌──────────────────▼───────────────────────┐
│  接入层: nginx (TLS / WS 反代 / 静态缓存) │  ← Phase 4
├──────────────────────────────────────────┤
│  应用层: Node + Express + Socket.IO       │
│   - 服务端权威 + 输入校验中间件            │
│   - Steam 票据认证 (Phase 4，并存用户名密码)│
│   - PM2 cluster 多实例 (Phase 4)          │
├──────────────────────────────────────────┤
│  状态层: Redis (Socket.IO adapter + 限流) │  ← Phase 4 多实例时
├──────────────────────────────────────────┤
│  持久层: SQLite (better-sqlite3)          │  ← Phase 1
│         → PostgreSQL (生产可选，后续)     │
├──────────────────────────────────────────┤
│  可观测: Pino 日志 + /health (+ 指标 P4)  │  ← Phase 1
└──────────────────────────────────────────┘
```

### 演进项

| 现状 | 目标 | 阶段 |
|---|---|---|
| JSON 文件 | SQLite (`node:sqlite` 内置) | Phase 1 |
| 内存会话 Map | JWT 无状态会话 | Phase 1 |
| `console.log` | Pino 结构化日志 | Phase 1 |
| 无健康检查 | `/health` 端点 | Phase 1 |
| 无测试 | Vitest + 核心单测 | Phase 1 |
| 无 CI | GitHub Actions | Phase 1 |
| 进程内服务端 | 桌面连远程服务端（保留可选内嵌） | Phase 1 |
| 单实例 | Redis adapter + PM2 + nginx | Phase 4 |
| 用户名密码 | + Steam 票据认证 | Phase 4 |
| 无 SDK | Steamworks 成就/云存档 | Phase 4 |

---

## 4. 发布路线图

| 阶段 | 目标 | 主要交付 | 退出标准 |
|---|---|---|---|
| **Phase 1 工程地基** | 生产级基础 | SQLite、JWT、Pino、/health、Vitest、CI、dotenv、桌面连远程 | 重启不丢数据/会话；核心单测通过；CI 绿 |
| **Phase 2 核心玩法** | 可玩深度 | 新手教程、战斗三角+连招、协处理器收集/升级/协同、技能变体 | 教程→一场有策略深度的 PvP |
| **Phase 3 留存系统** | 留得住人 | 赛季(4周三幕)、社交(好友/聊天/组队)、AI竞技场深化、每日轮换 | 7日留存可观测 |
| **Phase 4 平台集成** | Steam 就绪 | Steamworks SDK、Steam票据认证、商店素材、Redis+PM2+nginx扩容 | Steam 上传构建通过 |
| **Phase 5 Beta+发布** | 上架 | 封闭Beta、愿望单页(提前2周)、审核、定价、社区 → Steam 发布 | Steam 商店上线 |
| **后续** | 第二曝光窗 | Epic EOS 移植 + 审核(2-3月) | Epic 上线 |

---

## 5. Phase 1 工程地基（详）

> 原则：零外部基础设施依赖（SQLite + JWT 即够单实例），降低单人运维负担。Redis/PM2/nginx/指标留 Phase 4。

### 5.1 任务清单

1. **dotenv 配置管理**
   - `PORT / DATA_PATH / JWT_SECRET / CORS_ORIGIN / LOG_LEVEL`，`.env.example` 入库，`.env` 忽略。
2. **SQLite 持久化**
   - 内置 `node:sqlite`（`DatabaseSync`）重写 `server/data/Store.js`：`players` 表（id, username, password_hash, data JSON, created_at, last_login_at）。
   - 运行时仍用内存 Map 作权威缓存，`save()` 周期性 upsert 到 SQLite（替代 JSON 写文件）。
   - 首次启动从 `players.json` 导入并备份原文件为 `.bak`。
   - 选用内置 `node:sqlite` 而非 `better-sqlite3`：零原生编译、单人机无 VS C++ 工具链即可装；Node 22+/24 均内置。后续如需可切 `better-sqlite3`/PostgreSQL。
   - 桌面端默认连远程服务端，不在客户端打包服务端依赖（规避 Electron 原生模块重建）；可选内嵌模式启用时再处理 `electron-rebuild`。
3. **JWT 会话**
   - `jsonwebtoken` 替换 `auth.js` 内存 `Map`；`JWT_SECRET` 来自 env，过期 7 天。
   - 登出 = 客户端丢弃 token；封禁 = DB `banned` 标志，`verifySession` 查库。
4. **Pino 结构化日志**
   - 新建 `server/utils/logger.js`，替换 `index.js`/`Store.js`/`auth.js`/各 manager 的 `console.*`。
5. **`/health` 端点**
   - `GET /health`：uptime、内存、在线数、tick 运行态、DB 连接。
6. **Vitest 测试基线**
   - `vitest` + 配置；单测：`CombatSystem` 伤害/冷却/范围、`Store` 存取/迁移、`auth` 注册/登录/JWT 校验/封禁。
7. **GitHub Actions CI**
   - `.github/workflows/ci.yml`：install → `vitest run` → `npm run build:win` 烟雾测试。
8. **桌面端连远程服务端**
   - `electron/main.js`：读 `SERVER_URL`（默认官方端点，dev 可覆盖），加载该 URL；进程内服务端仅在 `START_EMBEDDED_SERVER=1` 时启动（为离线模式预留）。

### 5.2 实施顺序

```
dotenv → Vitest+当前行为测试 → Pino → /health
  → SQLite Store（更新测试）→ JWT auth（更新测试）→ 桌面远程 → CI
```

先写测试锁定现有行为，再做迁移，降低回归风险。

---

## 6. 关键决策与权衡

1. **桌面端改连远程官方服务端**：真多人的前提。保留 `START_EMBEDDED_SERVER` 开关为离线模式预留，Phase 1 默认关闭。
2. **Phase 1 用 JWT 而非 Redis**：单人单实例零外部依赖；多实例时再引 Redis（adapter + 限流共享）。
3. **SQLite 用内置 `node:sqlite`**：零原生编译，Node 22+/24 内置，单人机无 VS 工具链可用；生产单实例足够，后续可切 `better-sqlite3`/PostgreSQL。
4. **Phase 1 不动玩法**：只做地基；玩法从 Phase 2 起，避免地基未稳时叠加内容债。
5. **桌面端不打包服务端依赖**：默认远程连接规避 Electron 原生模块重建；离线模式启用时再处理。

---

## 7. 后续阶段概要

- **Phase 2 核心玩法**：新手教程("第一次同步")、战斗三角(Q/E/R克制)+连招(2s窗口)、协处理器(12-16个,★→★★★升级,二/三阶协同)、技能变体(Token驱动)、4×4技能盘套装。
- **Phase 3 留存系统**：赛季(4周三幕+软重置)、社交(好友/聊天/组队→公会/公会战)、AI竞技场深化(训练/AELO/回放/巅峰赛)、每日轮换增幅。
- **Phase 4 平台集成**：Steamworks SDK(Greenworks)、Steam票据认证、成就(15-30)、云存档、Rich Presence、商店素材(主视觉2560×1440/5+截图/预告片30-120s)、Redis+PM2+nginx。
- **Phase 5 Beta+发布**：封闭Beta、Steam"即将推出"页(提前2周攒愿望单)、审核(1-5天)+30天等待期、定价、Discord/QQ社区、Steam发布。
- **后续 Epic**：EOS 认证/成就/云存档、BuildPatchTool 上传、审核(2-3月)。

---

## 8. 未决问题

- [ ] 官方服务端托管位置（Fly.io 现有 / 阿里云 / 自建）——Phase 4 前定。
- [ ] 离线/训练模式是否上线（影响桌面端原生模块策略）——Phase 5 评估。
- [ ] 定价与付费模型（买断 / 免费+商城 / 战斗通行证）——Phase 5 前 定，GDD 已设计"付费加速不付费制胜"。
- [ ] 数据库是否迁 PostgreSQL（取决于 Phase 5 后的玩家规模）。
- [ ] 年龄评级 IARC（Epic 必需，Steam 推荐）——Phase 4/5。

---

> **文档版本**: v1.0
> **最后更新**: 2026-07-03
> **变更日志**:
> - v1.0: 初版，整合 GDD/publishing-guide/NETWORK_IMPROVEMENT_PLAN 为统一架构与路线图，启动 Phase 1。
