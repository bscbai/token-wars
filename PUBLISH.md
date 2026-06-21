# Token Wars: 算力征途 — Demo 发布完全指南

**版本:** v0.3.0  
**目标平台:** 浏览器 (primary) + Steam/Electron (secondary)  
**代码健康评分:** 88/100 (14/15 QA 问题已修复)

---

## 发布前检查清单

- [ ] 服务端模块加载正常 (`npm start` 无错误)
- [ ] 静态文件服务正常 (`/`, `/src/`, `/shared/` 路径可访问)
- [ ] Socket.IO 连接正常 (客户端可连接并收发事件)
- [ ] PvP 战斗同步正常 (远程玩家移动/攻击/射击可见)
- [ ] AI 竞技场匹配正常 (部署代理→匹配队列→对战→结果)
- [ ] 浏览器 Console 无 JS 错误
- [ ] Phaser 渲染无 crash

---

## 第一步：安装依赖

```bash
cd token-wars
npm install
```

已自动完成（`node_modules/` 已存在则跳过）。

---

## 第二步：本地运行测试

### 2.1 启动服务器

```bash
# 方式一：直接启动
npm start

# 方式二：指定端口
PORT=8080 npm start

# 方式三：使用 dev 脚本（含错误处理）
node scripts/dev-server.js
```

输出：
```
[Token Wars] Server running on 0.0.0.0:3000
[Token Wars] Static files from: .../client/public
```

### 2.2 打开浏览器

访问 `http://localhost:3000`，应该看到：
- 赛博朋克风格主菜单（网格背景、霓虹绿标题）
- "⚔️ PvP 战斗大厅" 按钮
- "🤖 AI 竞技场" 按钮

### 2.3 验证功能

| 测试项 | 操作 | 预期结果 |
|--------|------|----------|
| 连接 | 打开页面 | 顶部显示 "已连接" |
| 战斗大厅 | 点击 PvP 按钮 | 进入战斗场景，WASD 可移动 |
| 攻击 | 按 J 键 | 显示弧形斩击特效 |
| 射击 | 按 K 键 | 显示发光弹射物 |
| 闪避 | 按 Space | 快速冲刺 + 拖尾 |
| ESC 返回 | 按 ESC | 回到主菜单 |
| AI 竞技场 | 点击 AI 竞技场按钮 | 进入竞技场界面 |
| 创建代理 | 点击 "创建代理" | 弹出输入对话框 |
| 部署代理 | 点击代理 "部署" 按钮 | 加入匹配队列 |
| 多人测试 | 打开第二个浏览器标签 | 两个玩家应互相可见 |

---

## 第三步：导出 Steam 素材

### 3.1 生成 Steam 规格截图

```bash
npm run export-steam
```

输出到 `dist/screenshots/`：

| 文件 | 尺寸 | 用途 |
|------|------|------|
| `01-steam-library-capsule.png` | 616×353 | Steam 库胶囊图 |
| `02-steam-header-capsule.png` | 460×215 | Steam 头部胶囊图 |
| `03-steam-small-capsule.png` | 231×87 | Steam 小胶囊图 |
| `04-steam-main-capsule.png` | 616×353 | Steam 主胶囊图 |
| `05-screenshot-combat.png` | 1920×1080 | 战斗场景截图 |
| `06-screenshot-lobby.png` | 1920×1080 | 大厅截图 |

### 3.2 额外截图需求（手动静帧）

Steam 要求至少 5 张游戏内截图，建议在游戏运行时用浏览器 DevTools 截取：

1. **主菜单全屏** — `F12` → 全屏截图
2. **战斗场景（多人）** — 两人同时在线战斗
3. **AI 竞技场面板** — 代理列表 + 详情 + 排行榜
4. **战斗特效特写** — 射击、闪避拖尾
5. **对局结果** — AI 竞技场得分面板

> **技巧:** 使用 Chrome DevTools → Device Toolbar → 设置 1920×1080 → 截图。

---

## 第四步：云端部署

### 方式 A：Fly.io（推荐，免费额度）

```bash
# 1. 安装 flyctl
# macOS: brew install flyctl
# Windows: https://fly.io/docs/hands-on/install-flyctl/

# 2. 登录
fly auth login

# 3. 创建应用（首次）
fly launch

# 4. 设置环境变量
fly secrets set CORS_ORIGIN="https://your-app.fly.dev"

# 5. 部署
fly deploy

# 6. 打开
fly open
```

**预估耗时:** 5 分钟 | **费用:** $0（免费额度内）

### 方式 B：Railway（零配置）

```bash
# 1. 安装 Railway CLI
# npm i -g @railway/cli

# 2. 登录
railway login

# 3. 部署
railway up

# 4. 生成域名
railway domain
```

**预估耗时:** 3 分钟 | **费用:** $5/月 起

### 方式 C：Render

1. 访问 https://render.com
2. New Web Service → Connect GitHub Repo
3. Build Command: `npm ci --omit=dev && node scripts/build-client.js`
4. Start Command: `node server/index.js`
5. 添加环境变量: `CORS_ORIGIN`=`*`

**预估耗时:** 5 分钟 | **费用:** 免费额度内

### 方式 D：自托管 (Docker)

```bash
# 构建镜像
docker build -t token-wars .

# 运行
docker run -d \
  -p 3000:3000 \
  -e CORS_ORIGIN="*" \
  -e PORT=3000 \
  --name token-wars \
  token-wars

# 检查状态
docker logs token-wars
```

**Nginx 反向代理**（可选，配置 HTTPS）:

```nginx
server {
    listen 80;
    server_name token-wars.example.com;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

---

## 第五步：Electron 桌面打包

### 5.1 生成桌面应用

```bash
npm run package
```

输出到 `dist/Token Wars-win32-x64/`（Windows）。

**Mac/Linux:**
```bash
# Mac (需要 macOS 环境)
npx electron-packager . "Token Wars" --platform=darwin --arch=x64 --out=dist

# Linux
npx electron-packager . "Token Wars" --platform=linux --arch=x64 --out=dist
```

### 5.2 生成 .ico 图标（Windows）

```bash
# 如果有 ImageMagick
convert build/icon.png -resize 256x256 build/icon.ico

# 或在线工具: https://convertio.co/png-ico/
# 上传 build/icon.png → 下载 .ico → 放入 dist/Token Wars-win32-x64/
```

---

## 第六步：Steam 发布流程

### 6.1 Steamworks 注册 ($100)

1. 访问 https://partner.steamgames.com/
2. 创建 Steamworks 账户
3. 支付 $100 应用费（一次性，可退款当收入达 $1000）
4. 填写税务信息（W-8BEN 表格，中国开发者选"非美国纳税人"）

### 6.2 创建应用

1. Steamworks 后台 → "Create New App"
2. 应用名称: `Token Wars: 算力征途`
3. 应用类型: `Game`
4. 记录 App ID（例如: 1234560）

### 6.3 上传素材

使用 `dist/screenshots/` 中的文件：

| Steam 字段 | 使用文件 | 尺寸要求 |
|-----------|---------|---------|
| Library Capsule | `01-steam-library-capsule.png` | 600×900 或 616×353 |
| Header Capsule | `02-steam-header-capsule.png` | 460×215 |
| Small Capsule | `03-steam-small-capsule.png` | 231×87 |
| Main Capsule | `04-steam-main-capsule.png` | 616×353 |
| Screenshots (5张) | `05-screenshot-*.png` + 手动截图 | 1920×1080 或 1280×720 |

### 6.4 填写商店页面

**简短描述（~300 字符）:**
```
Token Wars: 算力征途 是一款赛博朋克主题的多人在线竞技游戏。
收集算力 Token，训练 AI 代理，在实时 PvP 战斗和异步 AI 竞技场中争夺霸权。
每场对战都是策略与反应的较量 — 你是最强的算力猎人吗？
```

**详细描述（建议 3-5 段）:**
```
【核心玩法】
Token Wars 将快节奏的 PvP 战斗与深度 AI 代理养成系统融合。
玩家在虚拟竞技场中实时移动、攻击、闪避，收集珍贵的算力 Token
来强化角色和 AI 代理。

【AI 傀儡竞技场】
训练你的 AI 代理，为其装配不同稀有度的 Token 磁盘，
通过 8 级决策树 AI 在异步竞技场中与其他玩家的代理对战。
代理拥有独立的 AELO 评级，3 星解锁专属特殊行为。

【赛季与锦标赛】
每周轮换的赛季 Buff 改变对战策略，巅峰锦标赛汇聚 Top 16 代理
进行单败淘汰对决。每日登录领取随机稀有度 Token 奖励。

【核心特色】
- 实时多人 PvP 战斗（WASD + 技能按键）
- AI 代理养成 + 自动对战系统
- Token 经济系统：4 类 × 4 稀有度
- 赛博朋克视觉风格
- 支持浏览器、Electron 桌面端、Steam 多平台
```

**标签（最多 20 个）:**
- Multiplayer, PvP, Arena, Cyberpunk, Strategy, Action,
  2D Fighter, Casual, Competitive, Sci-fi, Top-Down Shooter,
  Artificial Intelligence, Resource Management

**最低配置:**
- OS: Windows 10+
- CPU: 2.0 GHz Dual Core
- RAM: 2 GB
- GPU: Any with WebGL support
- Network: Broadband
- Storage: 200 MB

**推荐配置:**
- OS: Windows 10/11
- CPU: 3.0 GHz Quad Core
- RAM: 4 GB
- GPU: Dedicated GPU
- Storage: 200 MB

### 6.5 上传构建

1. Steamworks → 你的应用 → "SteamPipe" → "Depots"
2. 创建 depot（包含 `dist/Token Wars-win32-x64/` 内容）
3. 使用 SteamCMD 上传:

```bash
# 安装 SteamCMD
# https://developer.valvesoftware.com/wiki/SteamCMD

# 编写 build.vdf 配置文件
# 运行上传
steamcmd +login YOUR_USERNAME +run_app_build build.vdf +quit
```

### 6.6 审核与发布

1. 所有素材上传完毕 → 提交审核
2. Steam 审核周期: 3-5 个工作日
3. 审核通过 → 设置发布日期
4. 建议先发布为 "即将推出"，积累愿望单后再正式上线

---

## 第七步：其他平台发布

### Epic Games Store

1. 访问 https://dev.epicgames.com/
2. 注册 Epic 开发者账号（免费）
3. 提交游戏 → Epic 审核 → 签署协议
4. 使用 Epic Online Services (EOS) + Unreal Engine 桥接（可选，用于跨平台）
5. **注意:** Epic 对独立游戏审核较严格，建议 Steam 有销量证明后再申请

### itch.io（最简路径）

```bash
# 1. 访问 https://itch.io/
# 2. 注册 → Dashboard → Create New Project
# 3. 上传 dist/ 目录（打包为 .zip）
# 4. 设置价格（免费或付费）
# 5. 点击 Publish
```

**预估耗时:** 10 分钟 | **费用:** 免费（平台抽成可选 0-30%）

---

## 第八步：预发布自检清单

### 功能完整性
- [ ] 单人战斗（移动/攻击/射击/闪避）全部有效
- [ ] 多人 PvP 同步正常（至少 2 人测试）
- [ ] AI 竞技场创建代理 → 部署 → 对战 → 结果 完整链路
- [ ] 排行榜数据正确
- [ ] 赛季信息可查询
- [ ] 锦标赛可触发（需 Top 4 代理）
- [ ] 聊天功能正常

### 稳定性
- [ ] 服务端运行 30 分钟无 crash
- [ ] 客户端刷新/重连正常
- [ ] 多个客户端同时在线无问题
- [ ] 内存使用稳定（无持续增长）

### 用户体验
- [ ] 主菜单布局正常
- [ ] 按钮悬停效果正常
- [ ] 文字颜色/字号可读
- [ ] 键盘提示正确（WASD/J/K/Space/ESC）
- [ ] 中文/英文显示正常

### 部署
- [ ] 云服务器可公网访问
- [ ] CORS 配置正确
- [ ] WebSocket 连接稳定
- [ ] 静态资源加载无 404

---

## 时间线预估

| 步骤 | 操作 | 耗时 |
|------|------|------|
| 1 | 安装依赖 | 2 分钟 |
| 2 | 本地测试 | 10 分钟 |
| 3 | 导出 Steam 素材 | 2 分钟 |
| 4 | 云端部署 | 5-10 分钟 |
| 5 | Electron 打包 | 5 分钟 |
| 6 | Steam 注册 + 上传 | 1-2 小时 |
| 7 | itch.io 发布 | 10 分钟 |
| 8 | 发布前自检 | 30 分钟 |
| **总计** | | **2-3 小时** |

---

## 快速启动命令速查

```bash
# 安装
npm install

# 本地运行
npm start                     # 默认端口 3000
PORT=8080 npm start           # 自定义端口

# 素材导出
npm run export-steam          # Steam 截图 + 胶囊图

# 生产构建
npm run build                 # 复制客户端到 dist/

# 桌面打包
npm run package               # Electron → dist/Token Wars-win32-x64/

# Docker 部署
docker build -t token-wars .
docker run -d -p 3000:3000 --name token-wars token-wars

# 云部署（Fly.io）
fly deploy
```
