# Token Wars: 算力征途 — 部署指南

本文档涵盖 Token Wars 在四种平台上的部署方案：Fly.io、Railway、Render 和自托管（阿里云）。

---

## 目录

1. [Fly.io](#1-flyio)
2. [Railway](#2-railway)
3. [Render](#3-render)
4. [自托管 (阿里云)](#4-自托管-阿里云)
5. [通用配置](#5-通用配置)

---

## 1. Fly.io

### 前置条件

```bash
# 安装 Fly CLI
# macOS / Linux
curl -L https://fly.io/install.sh | sh

# Windows
powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"

# 登录
fly auth login
```

### 初始部署

```bash
# 在项目根目录执行
fly launch

# 交互式配置
# App name: token-wars
# Region: nrt (Tokyo)
# Would you like to deploy now? Yes
# Would you like to set up a Postgres database? No
# Would you like to set up an Upstash Redis database? No
```

`fly.toml` 已预配置好（位于项目根目录），核心配置：

```toml
app = "token-wars"
primary_region = "nrt"

[build]
  image = "node:22-alpine"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 0

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 512
```

### 后续部署

```bash
# 更新部署
fly deploy

# 查看状态
fly status

# 查看日志
fly logs

# SSH 进入实例
fly ssh console
```

### 环境变量

```bash
# 设置密钥
fly secrets set SESSION_SECRET="your-secret-key-here"
fly secrets set NODE_ENV="production"

# 设置普通变量
fly secrets set CORS_ORIGIN="https://token-wars.fly.dev"

# 查看已设置的变量
fly secrets list

# 删除变量
fly secrets unset VARIABLE_NAME
```

### 扩展

```bash
# 增加实例数（需先移除 auto_stop_machines 配置）
fly scale count 2

# 增加内存
fly scale memory 1024

# 查看当前规格
fly scale show
```

### 自定义域名

```bash
# 添加域名（需先完成 DNS 验证）
fly certs create token-wars-game.com

# 获取 DNS 配置说明
fly certs show token-wars-game.com
```

---

## 2. Railway

### 前置条件

- GitHub 账号
- Railway 账号 (https://railway.app)
- 项目已推送到 GitHub

### 部署步骤

1. 登录 [Railway Dashboard](https://railway.app/dashboard)
2. 点击 **New Project** → **Deploy from GitHub repo**
3. 选择 `bscbai/token-wars` 仓库
4. Railway 自动检测 Dockerfile 并开始构建
5. 构建完成后自动部署

### 环境变量配置

在 Railway Dashboard 中:

1. 进入项目 → **Variables** 标签
2. 添加以下变量:

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `NODE_ENV` | `production` | 运行环境 |
| `PORT` | `3000` | 服务端口 |
| `SESSION_SECRET` | `[生成随机字符串]` | 会话密钥 |
| `CORS_ORIGIN` | `[你的Railway域名]` | CORS白名单 |

### 自定义域名

1. 项目 → **Settings** → **Public Networking**
2. 点击 **Generate Domain** 获取自动域名
3. 点击 **Custom Domain** 添加自己的域名
4. 在 DNS 提供商添加 CNAME 记录指向 Railway 提供的域名

### 健康检查

Railway 自动检测端口绑定。为确保健康检查工作：

- 应用必须监听 `process.env.PORT`
- 返回 200 OK 到根路径或 `/health`
- 如 `server/index.js` 中使用 `app.get('/health', ...)`

示例健康检查代码（已在 `server/index.js` 中包含）:

```javascript
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: Date.now()
  });
});
```

### 自动部署

Railway 默认启用自动部署：
- 推送代码到 `main` 分支 → 自动构建部署
- 也可以在 Settings 中关闭自动部署

---

## 3. Render

### 前置条件

- GitHub 账号
- Render 账号 (https://render.com)
- 项目已推送到 GitHub

### Blueprint 部署（推荐）

如果项目根目录有 `render.yaml` 文件，可以使用 Blueprint：

```yaml
# render.yaml
services:
  - type: web
    name: token-wars
    env: node
    region: singapore
    buildCommand: npm ci
    startCommand: node server/index.js
    healthCheckPath: /health
    envVars:
      - key: NODE_ENV
        value: production
      - key: PORT
        value: "3000"
```

### 手动部署步骤

1. 登录 [Render Dashboard](https://dashboard.render.com)
2. 点击 **New +** → **Web Service**
3. 连接 GitHub 并选择 `bscbai/token-wars` 仓库
4. 配置以下选项:

| 配置项 | 值 |
|--------|-----|
| Name | token-wars |
| Region | Singapore (离国内最近) 或 Oregon |
| Runtime | Node |
| Build Command | `npm ci` |
| Start Command | `node server/index.js` |
| Health Check Path | `/health` |
| Instance Type | Free (或 Starter: $7/月) |

5. 点击 **Create Web Service**

### 环境变量

在 Render Dashboard:

1. 进入服务 → **Environment** 标签
2. 添加环境变量：

| 变量名 | 值 |
|--------|-----|
| `NODE_ENV` | `production` |
| `PORT` | `3000` |
| `SESSION_SECRET` | `[生成随机字符串]` |
| `CORS_ORIGIN` | `[你的Render域名]` |

### 健康检查说明

Render 使用 `/health` 路径进行健康检查。确保服务器在健康检查失败时不进入循环重启。

### 扩展

- Starter plan: 512MB RAM, 1 shared CPU ($7/月)
- 可在 Settings 中调整实例类型

---

## 4. 自托管 (阿里云)

### 前置条件

- 阿里云 ECS 实例（推荐 2vCPU, 4GB RAM）
- Ubuntu 22.04 LTS
- 已配置安全组规则（开放 80, 443, 3000 端口）

### 4.1 服务器初始化

```bash
# SSH 登录
ssh root@your-server-ip

# 更新系统
apt update && apt upgrade -y

# 安装 Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

# 验证安装
node --version  # 应输出 v22.x.x
npm --version

# 安装 Git
apt install -y git

# 安装 PM2 (进程管理器)
npm install -g pm2

# 安装 Nginx
apt install -y nginx

# 安装 Certbot (SSL 证书)
apt install -y certbot python3-certbot-nginx
```

### 4.2 部署应用

```bash
# 创建应用目录
mkdir -p /opt/token-wars
cd /opt/token-wars

# 克隆代码
git clone https://github.com/bscbai/token-wars.git .

# 安装依赖（仅生产环境）
npm ci --omit=dev

# 创建 .env 文件
cat > .env << 'EOF'
NODE_ENV=production
PORT=3000
SESSION_SECRET=$(openssl rand -hex 32)
CORS_ORIGIN=https://your-domain.com
EOF

# 使用 PM2 启动
pm2 start server/index.js --name token-wars

# 设置 PM2 开机自启
pm2 startup
pm2 save
```

### 4.3 Nginx 反向代理

```bash
# 创建 Nginx 配置
cat > /etc/nginx/sites-available/token-wars << 'NGINX'
server {
    listen 80;
    server_name your-domain.com;

    # 客户端文件
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    # WebSocket 支持
    location /socket.io/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    # 健康检查端点
    location /health {
        proxy_pass http://localhost:3000/health;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }

    # 静态资源缓存
    location /assets/ {
        proxy_pass http://localhost:3000;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
NGINX

# 启用站点
ln -s /etc/nginx/sites-available/token-wars /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# 测试配置
nginx -t

# 重载 Nginx
systemctl reload nginx
```

### 4.4 SSL 证书配置

```bash
# 使用 Certbot 获取 Let's Encrypt 证书
certbot --nginx -d your-domain.com

# 证书自动续期（已自动配置定时任务）
certbot renew --dry-run  # 测试续期
```

### 4.5 Docker 部署（替代方案）

```bash
# 安装 Docker
curl -fsSL https://get.docker.com | bash

# 构建镜像
cd /opt/token-wars
docker build -t token-wars:latest .

# 运行容器
docker run -d \
  --name token-wars \
  --restart unless-stopped \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e SESSION_SECRET=$(openssl rand -hex 32) \
  -e CORS_ORIGIN=https://your-domain.com \
  token-wars:latest

# 查看日志
docker logs -f token-wars

# 停止容器
docker stop token-wars
docker rm token-wars
```

### 4.6 日常维护

```bash
# 查看应用状态
pm2 status

# 查看日志
pm2 logs token-wars

# 重启应用
pm2 restart token-wars

# 更新代码
cd /opt/token-wars
git pull origin main
npm ci --omit=dev
pm2 restart token-wars

# 查看系统资源
htop
df -h
```

### 4.7 安全加固

```bash
# 设置防火墙 (UFW)
ufw allow 22    # SSH
ufw allow 80    # HTTP
ufw allow 443   # HTTPS
ufw deny 3000   # 禁止直接访问应用端口
ufw enable

# 查看防火墙状态
ufw status

# 配置 Fail2Ban 防止暴力破解
apt install -y fail2ban
systemctl enable fail2ban
systemctl start fail2ban
```

---

## 5. 通用配置

### 5.1 CORS 配置

在 `server/index.js` 中配置 CORS：

```javascript
const cors = require('cors');
const express = require('express');
const app = express();

const corsOptions = {
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST'],
  credentials: true
};

app.use(cors(corsOptions));
```

**注意事项：**
- 生产环境必须设置具体的 `CORS_ORIGIN` 值，不要使用 `*`
- 如果使用多个域名，可以设置多个值（逗号分隔）

### 5.2 端口绑定

服务器必须监听 `process.env.PORT` 或默认端口：

```javascript
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

### 5.3 健康检查端点

所有部署平台都需要健康检查端点，已在 `server/index.js` 中实现：

```
GET /health
Response: 200 OK
Content-Type: application/json

{
  "status": "ok",
  "uptime": 12345.678,
  "timestamp": 1234567890000,
  "players": 42
}
```

### 5.4 WebSocket 支持

Socket.IO 需要 WebSocket 连接，确保反向代理的以下配置：

```nginx
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection 'upgrade';
proxy_read_timeout 86400s;
proxy_send_timeout 86400s;
```

### 5.5 环境变量参考

| 变量名 | 必需 | 默认值 | 说明 |
|--------|------|--------|------|
| `NODE_ENV` | 是 | `development` | 运行环境 |
| `PORT` | 否 | `3000` | 服务端口 |
| `SESSION_SECRET` | 是 | — | 会话加密密钥（至少32字符） |
| `CORS_ORIGIN` | 否 | `*` | CORS 允许的源域名 |

### 5.6 故障排查

| 问题 | 可能原因 | 解决方案 |
|------|----------|----------|
| 应用无法启动 | 端口被占用 | `lsof -i :3000` 检查端口，`kill` 占用进程 |
| WebSocket 连接失败 | Nginx 未配置升级头 | 检查 Nginx 配置中的 `Upgrade` 和 `Connection` 头 |
| SSL 证书错误 | 证书过期或配置错误 | `certbot renew` 或 `fly certs check` |
| 健康检查失败 | 应用端口未正确绑定 | 确认应用监听 `0.0.0.0` 而非 `127.0.0.1` |
| 高延迟 | 服务器地理位置远 | 选择离用户最近的区域（nrt/sin 适合亚洲） |
| 内存不足 | 玩家数超过实例容量 | 增加内存或实例数 |

### 5.7 监控建议

- **Fly.io:** 使用内置 `fly metrics` 查看 CPU/内存
- **Railway:** Dashboard 自带性能图表
- **Render:** Metrics 标签提供实时数据
- **自托管:** 推荐搭配 Grafana + Prometheus 或使用 PM2 Plus

---

> **最后更新:** 2026-06-19
> **维护者:** Token Wars 开发团队
