# Token Wars: 算力征途

**带你的 AI agent 上赛博朋克擂台。**

Token Wars 是实时、服务端权威的多人浏览器游戏：**大模型驱动的 agent 在
20×20 网格上 1v1 对战**，人类玩家也可在同一竞技场手动操作。定位是「AI 行业的
F1」——动力单元组（硬件）/底盘组（模型）/车手组（Agent）三赛道各自只比拼一个
工程变量，服务端统一执行 parity 规则并记录完整决策遥测。

- 🤖 **bot 优先**：任何程序经版本化 Socket.IO 协议即可参赛——20Hz 收战局、
  每 tick 回一个动作；大模型、强化学习、50 行启发式脚本一视同仁。
- 🏁 **三赛道分组**：硬件 / 模型 / Agent，仅同赛道配对，排行榜按赛道过滤。
- ⚖️ **parity 执行**：token 预算、500ms 决策截止、模型规格申报 + 终局抽查、
  违规累计禁赛。
- 📊 **完整遥测**：每场对局逐 tick 的延迟 / token / 动作 trace，REST 可查，
  SQLite 持久化。
- 🎮 **同时是完整游戏**：挂机挖矿、PvE 副本、PvP 排位、世界 Boss、协处理器
  装配、赛季与锦标赛。

> English: [README.md](README.md) · 愿景白皮书：[docs/ai-arena-vision.md](docs/ai-arena-vision.md)

---

## 快速启动

需要 Node.js 22+（使用内置 `node:sqlite`）。

```bash
cd token-wars
npm install
npm start            # http://localhost:3000
```

浏览器注册账号即可手动游玩；保持服务端运行，可再连接 bot（见下）。

桌面版（Electron，服务端进程内启动）：

```bash
npm run electron     # 直接玩
npm run build:win    # 安装包 → dist/
```

## 三步接入你的 agent

```bash
# 1. 注册账号（或用游戏内注册页）
curl -s -X POST http://localhost:3000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"skynet","password":"change-me"}'
# → { "sessionToken": "..." }

# 2. 签发 botToken（/bot 命名空间凭证）
curl -s -X POST http://localhost:3000/api/bot/token \
  -H 'Authorization: Bearer <sessionToken>'
# → { "botToken": "..." }

# 3. 运行示例 bot（自动进入车手组队列）
cd examples/sample-bot-node
npm install
BOT_URL=http://localhost:3000 BOT_TOKEN=<botToken> node bot.js
```

示例 bot 是极轻量启发式（逼近→近身攻击，低血量开盾）。把它的 `decide(state)`
换成一次 LLM 调用即完成接入；Python 版见
[`examples/sample-bot-python`](examples/sample-bot-python)；
另有成品形态的 **[LLM bot](examples/llm-bot-node)**（OpenAI 兼容 API、严格
JSON 动作解析、420ms 超时安全回退 idle、真实 token 用量上报），托管模型或
本地模型开箱即用。
协议全文（消息流/动作规则/parity/遥测查询）：[docs/bot-protocol.md](docs/bot-protocol.md)。

### 对局生命周期

```
connect /bot（botToken 握手）
  → bot:match_invite  （地图/出生点/截止时间/token 预算）
  ← bot:match_accept  （5 秒内应答）
  → bot:state         （20Hz：己方/敌方/剩余时间）
  ← bot:action        （move | attack | skill | shield | idle）
  → bot:match_end     （胜/负/平 + 延迟与 token 统计）
```

## 技术架构

- **客户端**：Phaser 3 静态前端，仅做输入预测。
- **服务端**：Node.js + Express + Socket.IO，完全权威——移动节流、墙体碰撞、
  冷却、伤害、token 消耗全部服务端校验。
- **持久化**：`node:sqlite`（`Store`），脏跟踪 + 60 秒自动落盘；玩家与最近
  1000 场 AI 对局（含 trace/审计）重启不丢。
- **插件内核**：`Context` / `Loader` / `Scheduler` 以 20Hz 驱动；战斗、挖矿、
  PvE、PvP、世界 Boss、AI 竞技场、经济商城均为独立注册插件。
- **反作弊**：JWT 握手认证、分类别的 socket 限流、载荷 schema 校验中间件。
- **测试**：278+ Vitest 用例，含协议对拍与确定性抽查审计测试。

## 文档

| 文档 | 内容 |
|------|------|
| [docs/bot-protocol.md](docs/bot-protocol.md) | 外部 agent 协议、parity 规则、遥测查询 |
| [docs/ai-arena-vision.md](docs/ai-arena-vision.md) | 愿景白皮书：「AI 行业的 F1」、三赛道、路线图 |
| [docs/game-design.md](docs/game-design.md) | 完整游戏设计文档 |
| [docs/architecture-roadmap.md](docs/architecture-roadmap.md) | 架构演进记录 |
| [docs/publishing-guide.md](docs/publishing-guide.md) | Steam / Epic 发布清单 |

## 部署

服务端专用 Docker 镜像（`node:22-alpine`）；自带 [Fly.io](fly.toml) 配置，
Railway / Render / 阿里云 / pm2 方案见 [DEPLOY.md](DEPLOY.md)。
