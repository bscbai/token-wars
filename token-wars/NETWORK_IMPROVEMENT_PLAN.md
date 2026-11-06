# Token Wars 网络架构审查与改进方案

**审查日期**: 2026-05-21  
**审查人**: UnityMultiplayerEngineer  
**项目**: Token Wars: 算力征途  

---

## 执行摘要

现有Socket.IO网络架构实现了基础的多人游戏功能，但在**生产环境部署**和**服务稳定性**方面存在关键缺陷。本方案提供分阶段的改进计划，包括中间件强化、游戏循环优化、监控部署配置。

**关键发现**：
- ✅ 服务端权威架构已建立
- ✅ 事件驱动设计合理
- ❌ 缺少生产级中间件（认证/限流/验证）
- ❌ 游戏循环精度不足
- ❌ 无监控系统
- ❌ 无部署配置

---

## 1. 架构审查 (Architecture Review)

### 问题 1A: 缺少Socket.IO中间件
**位置**: `server/index.js` L30-32  
**严重性**: 🔴 High

**当前状态**:
```javascript
const io = new Server(server, {
  cors: { origin: '*' },  // ← 过于宽松
});
```

**问题**:
1. CORS配置允许所有来源
2. 无认证中间件（依赖事件级认证）
3. 无速率限制（易遭受DDoS攻击）
4. 无输入验证（恶意客户端可发送恶意数据）

**风险**:
- 任何客户端都可连接WebSocket
- 可以发送高频恶意事件耗尽服务器资源
- 输入数据未验证可能导致注入攻击或崩溃

**推荐方案**: 添加三层中间件

```javascript
// server/middleware/auth.js
function authMiddleware(socket, next) {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error('Authentication required'));
  }
  const player = verifySession(token);
  if (!player) {
    return next(new Error('Invalid session'));
  }
  socket.player = player;
  next();
}

// server/middleware/rateLimit.js
const rateLimit = new Map(); // socketId -> { count, resetTime }

function rateLimitMiddleware(socket, next) {
  const now = Date.now();
  const record = rateLimit.get(socket.id) || { count: 0, resetTime: now + 60000 };
  
  if (now > record.resetTime) {
    record.count = 0;
    record.resetTime = now + 60000;
  }
  
  record.count++;
  rateLimit.set(socket.id, record);
  
  if (record.count > 100) {  // 每分钟100个事件
    return next(new Error('Rate limit exceeded'));
  }
  
  next();
}

// 使用
io.use(authMiddleware);
io.use(rateLimitMiddleware);
```

---

### 问题 1B: 游戏循环精度不足
**位置**: `server/game/GameEngine.js` L20-25  
**严重性**: 🟡 Medium

**当前状态**:
```javascript
start() {
  this.interval = setInterval(() => {
    this.tick();
  }, TICK_MS);  // 50ms = 20Hz
}
```

**问题**:
- `setInterval` 不保证精确执行
- 累积误差会导致时钟漂移
- 高负载时tick可能跳过

**推荐方案**: 使用 `performance.now()` + 动态补偿

```javascript
// server/game/GameEngine.js (改进版)
start() {
  if (this.running) return;
  this.running = true;
  this.lastTick = performance.now();
  this.accumulator = 0;
  
  const tick = () => {
    if (!this.running) return;
    
    const now = performance.now();
    const delta = now - this.lastTick;
    this.lastTick = now;
    this.accumulator += delta;
    
    // 执行所有到期的tick
    while (this.accumulator >= TICK_MS) {
      this.tick();
      this.accumulator -= TICK_MS;
      this.tickCount++;
    }
    
    // 使用requestAnimationFrame风格的精确循环
    setImmediate(tick);
  };
  
  tick();
  console.log(`[GameEngine] Started at ${TICK_RATE} Hz`);
}
```

---

### 问题 1C: 会话管理不安全
**位置**: `server/routes/auth.js` L10  
**严重性**: 🔴 High

**当前状态**:
```javascript
const sessions = new Map(); // ← 内存存储，重启丢失
```

**问题**:
1. 会话存储在内存中，服务器重启后所有用户需要重新登录
2. 无会话过期机制
3. 无会话吊销机制

**推荐方案**: 使用Redis或JWT

```javascript
// 选项A: Redis会话存储 (推荐生产环境)
const redis = require('redis');
const client = redis.createClient();

function setSession(token, playerId) {
  client.setex(`session:${token}`, 3600, playerId);  // 1小时过期
}

function verifySession(token) {
  return new Promise((resolve) => {
    client.get(`session:${token}`, (err, playerId) => {
      if (err || !playerId) resolve(null);
      else resolve(store.getPlayerById(playerId));
    });
  });
}

// 选项B: JWT (无状态会话)
const jwt = require('jsonwebtoken');

function createSession(playerId) {
  const token = jwt.sign({ playerId }, process.env.JWT_SECRET, { expiresIn: '1h' });
  return token;
}

function verifySession(token) {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return store.getPlayerById(decoded.playerId);
  } catch (err) {
    return null;
  }
}
```

---

## 2. 代码质量审查 (Code Quality Review)

### 问题 2A: DRY违规 - 重复的广播逻辑
**位置**: `server/game/CombatSystem.js`, `server/game/PvPManager.js`  
**严重性**: 🟡 Medium

**当前状态**:
```javascript
// CombatSystem.js L313-325
broadcastToPlayers(entities, event, data) {
  if (entities) {
    for (const [, entity] of entities) {
      if (entity.username) {
        const socket = this.playerSockets.get(entity.id);
        if (socket) socket.emit(event, data);
      }
    }
  } else {
    this.io.emit(event, data);
  }
}

// PvPManager.js L317-324
broadcastToArena(arena, event, data) {
  for (const team of arena.teams) {
    for (const pid of team) {
      const socket = this.playerSockets.get(pid);
      if (socket) socket.emit(event, data);
    }
  }
}
```

**问题**: 两个广播方法逻辑相似但不统一

**推荐方案**: 创建统一的事件总线

```javascript
// server/events/EventBus.js (新建)
class EventBus {
  constructor(io) {
    this.io = io;
    this.playerSockets = new Map();
  }
  
  registerSocket(playerId, socket) {
    this.playerSockets.set(playerId, socket);
  }
  
  unregisterSocket(playerId) {
    this.playerSockets.delete(playerId);
  }
  
  // 发送给单个玩家
  toPlayer(playerId, event, data) {
    const socket = this.playerSockets.get(playerId);
    if (socket) socket.emit(event, data);
  }
  
  // 广播给多个玩家
  toPlayers(playerIds, event, data) {
    for (const pid of playerIds) {
      this.toPlayer(pid, event, data);
    }
  }
  
  // 广播给竞技场
  toArena(arena, event, data) {
    const playerIds = arena.teams.flat();
    this.toPlayers(playerIds, event, data);
  }
  
  // 广播给所有连接的玩家
  toAll(event, data) {
    this.io.emit(event, data);
  }
}

module.exports = EventBus;
```

---

### 问题 2B: 错误处理不一致
**位置**: 多处  
**严重性**: 🟡 Medium

**当前状态**:
```javascript
// 有些地方有错误处理
try {
  // ...
} catch (err) {
  console.error('[Store] Failed to load players:', err.message);
}

// 有些地方没有
socket.on(EVENTS.INPUT_SKILL, ({ skillId, targetX, targetY }) => {
  const player = connectedPlayers.get(socket.id);
  if (!player || !player.alive) return;
  // 无try-catch
  combatSystem.useSkill(player, skillId, targetX, targetY, allEntities);
});
```

**推荐方案**: 统一的错误处理中间件

```javascript
// server/middleware/errorHandler.js
function errorHandler(socket, next) {
  const originalEmit = socket.emit;
  
  socket.emit = function(event, data) {
    try {
      originalEmit.call(this, event, data);
    } catch (err) {
      console.error(`[Socket ${socket.id}] Emit error:`, err);
      socket.emit(EVENTS.ERROR, {
        message: 'Internal server error',
        code: 'INTERNAL_ERROR'
      });
    }
  };
  
  next();
}

// 包装所有事件处理器
function wrapEventHandler(handler) {
  return async (...args) => {
    try {
      await handler(...args);
    } catch (err) {
      console.error('[Event Handler Error]', err);
      const socket = args[args.length - 1];  // 最后一个参数通常是socket
      if (socket && socket.emit) {
        socket.emit(EVENTS.ERROR, {
          message: err.message || 'Internal server error',
          code: err.code || 'INTERNAL_ERROR'
        });
      }
    }
  };
}
```

---

## 3. 性能审查 (Performance Review)

### 问题 3A: JSON文件存储不适合生产环境
**位置**: `server/data/Store.js`  
**严重性**: 🔴 High

**当前状态**:
```javascript
save() {
  const data = Array.from(this.players.values()).map(p => p.toSave());
  fs.writeFileSync(PLAYERS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}
```

**问题**:
1. 同步I/O阻塞事件循环
2. 大文件读写性能差
3. 无并发保护（多进程会覆盖）
4. 无数据完整性保证

**推荐方案**: 使用数据库

```javascript
// 选项A: SQLite (轻量级，适合小型游戏)
const sqlite3 = require('sqlite3').verbose();

class Store {
  constructor() {
    this.db = new sqlite3.Database('./data/players.db');
    this.initDatabase();
  }
  
  initDatabase() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE,
        password_hash TEXT,
        data TEXT,  -- JSON string
        created_at INTEGER,
        last_login_at INTEGER
      )
    `);
  }
  
  savePlayer(player) {
    const data = JSON.stringify(player.toSave());
    this.db.run(`
      INSERT OR REPLACE INTO players (id, username, password_hash, data, created_at, last_login_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [player.id, player.username, player.passwordHash, data, player.createdAt, player.lastLoginAt]);
  }
  
  loadPlayer(id) {
    return new Promise((resolve) => {
      this.db.get('SELECT data FROM players WHERE id = ?', [id], (err, row) => {
        if (err || !row) resolve(null);
        else resolve(Player.fromSave(JSON.parse(row.data)));
      });
    });
  }
}

// 选项B: MongoDB (适合中型游戏)
const mongoose = require('mongoose');

const PlayerSchema = new mongoose.Schema({
  _id: String,
  username: { type: String, unique: true },
  passwordHash: String,
  data: Object,  // 存储序列化数据
  createdAt: Number,
  lastLoginAt: Number
});

const PlayerModel = mongoose.model('Player', PlayerSchema);

class Store {
  async savePlayer(player) {
    await PlayerModel.findOneAndUpdate(
      { _id: player.id },
      { 
        username: player.username,
        passwordHash: player.passwordHash,
        data: player.toSave(),
        lastLoginAt: Date.now()
      },
      { upsert: true }
    );
  }
  
  async loadPlayer(id) {
    const doc = await PlayerModel.findById(id);
    if (!doc) return null;
    return Player.fromSave(doc.data);
  }
}
```

---

### 问题 3B: 高频事件无节流
**位置**: `server/index.js` L75-85 (移动事件)  
**严重性**: 🟡 Medium

**当前状态**:
```javascript
socket.on(EVENTS.INPUT_MOVE, ({ dx, dy }) => {
  const player = connectedPlayers.get(socket.id);
  if (!player || !player.alive) return;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) return;
  // 每次移动都立即处理，无节流
  player.x += dx;
  player.y += dy;
});
```

**问题**: 恶意客户端可以高频发送移动事件（每秒数百次）

**推荐方案**: 服务端移动验证 + 客户端预测

```javascript
// server/game/MovementValidator.js (新建)
class MovementValidator {
  constructor() {
    this.lastMoveTime = new Map();  // playerId -> timestamp
    this.MIN_MOVE_INTERVAL = 50;  // 最小移动间隔50ms
  }
  
  validateMove(player, dx, dy) {
    const now = Date.now();
    const lastTime = this.lastMoveTime.get(player.id) || 0;
    
    // 检查频率
    if (now - lastTime < this.MIN_MOVE_INTERVAL) {
      return { valid: false, reason: 'move_too_fast' };
    }
    
    // 检查移动距离
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      return { valid: false, reason: 'invalid_move_distance' };
    }
    
    // 检查边界
    const newX = player.x + dx;
    const newY = player.y + dy;
    if (newX < 0 || newX >= MAP_WIDTH || newY < 0 || newY >= MAP_HEIGHT) {
      return { valid: false, reason: 'out_of_bounds' };
    }
    
    // 检查障碍物 (如果有地图数据)
    // if (map[newX][newY] === TILE.WALL) {
    //   return { valid: false, reason: 'blocked_by_wall' };
    // }
    
    this.lastMoveTime.set(player.id, now);
    return { valid: true };
  }
}

// 使用
const movementValidator = new MovementValidator();

socket.on(EVENTS.INPUT_MOVE, ({ dx, dy }) => {
  const player = connectedPlayers.get(socket.id);
  if (!player || !player.alive) return;
  
  const validation = movementValidator.validateMove(player, dx, dy);
  if (!validation.valid) {
    socket.emit(EVENTS.ERROR, { message: validation.reason });
    return;
  }
  
  player.x += dx;
  player.y += dy;
});
```

---

## 4. 测试审查 (Test Review)

### 问题 4A: 缺少自动化测试
**严重性**: 🔴 High

**当前状态**: 无测试文件

**推荐方案**: 添加单元测试和集成测试

```javascript
// test/unit/CombatSystem.test.js
const CombatSystem = require('../../server/game/CombatSystem');
const Player = require('../../server/models/Player');

describe('CombatSystem', () => {
  let combatSystem;
  let attacker;
  let defender;
  
  beforeEach(() => {
    combatSystem = new CombatSystem(io, store);
    attacker = new Player('attacker');
    defender = new Player('defender');
  });
  
  test('melee attack should damage target', () => {
    const result = combatSystem.useSkill(attacker, 0, defender.x, defender.y, new Map([
      [attacker.id, attacker],
      [defender.id, defender]
    ]));
    
    expect(result.success).toBe(true);
    expect(result.damage).toBeGreaterThan(0);
    expect(defender.hp).toBeLessThan(defender.maxHp);
  });
  
  test('attack out of range should fail', () => {
    defender.x = 100;  // 远离攻击者
    const result = combatSystem.useSkill(attacker, 0, defender.x, defender.y, new Map([
      [attacker.id, attacker],
      [defender.id, defender]
    ]));
    
    expect(result.success).toBe(false);
    expect(result.reason).toBe('out_of_range');
  });
});

// test/integration/socket.test.js
const io = require('socket.io-client');

describe('Socket.IO Integration', () => {
  let clientSocket;
  let server;
  
  beforeAll((done) => {
    server = require('../../server/index.js');
    clientSocket = new io(`http://localhost:${PORT}`);
    clientSocket.on('connect', done);
  });
  
  test('should authenticate with valid token', (done) => {
    const token = 'valid-token';  // 需要mock
    clientSocket.emit('auth:login', { token }, (response) => {
      expect(response.success).toBe(true);
      done();
    });
  });
  
  afterAll(() => {
    clientSocket.close();
    server.close();
  });
});
```

---

## 5. 部署与稳定性方案

### 5.1 进程管理 (PM2)

**文件**: `ecosystem.config.js`

```javascript
module.exports = {
  apps: [{
    name: 'token-wars-server',
    script: 'server/index.js',
    instances: 'max',  // 使用所有CPU核心
    exec_mode: 'cluster',  // 集群模式
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    // 自动重启
    autorestart: true,
    max_memory_restart: '1G',
    restart_delay: 1000,
    // 日志
    error_file: '/var/log/token-wars/error.log',
    out_file: '/var/log/token-wars/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    // 监控
    watch: false,
    ignore_watch: ['node_modules', 'logs', 'data'],
    // 环境变量
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000
    }
  }]
};
```

**使用**:
```bash
# 启动
pm2 start ecosystem.config.js --env production

# 查看状态
pm2 status

# 查看日志
pm2 logs token-wars-server

# 重启
pm2 restart token-wars-server

# 停止
pm2 stop token-wars-server
```

---

### 5.2 反向代理 (nginx)

**文件**: `/etc/nginx/sites-available/token-wars`

```nginx
upstream token_wars_backend {
    ip_hash;  # 确保同一IP连接到同一后端实例
    server 127.0.0.1:3000;
    server 127.0.0.1:3001;
    server 127.0.0.1:3002;
}

server {
    listen 80;
    server_name game.yourdomain.com;
    
    # 重定向到HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name game.yourdomain.com;
    
    # SSL配置
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    
    # Socket.IO WebSocket代理
    location /socket.io/ {
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Host $host;
        proxy_pass http://token_wars_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket超时
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
    
    # 静态文件
    location / {
        root /var/www/token-wars/client;
        try_files $uri $uri/ /index.html;
        
        # 缓存策略
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }
    
    # 安全头
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
}
```

---

### 5.3 监控 (Prometheus + Grafana)

**文件**: `server/monitoring/prometheus.js`

```javascript
const prometheus = require('prom-client');
const collectDefaultMetrics = prometheus.collectDefaultMetrics;

// 创建自定义指标
const gameMetrics = {
  // 在线玩家数
  onlinePlayers: new prometheus.Gauge({
    name: 'token_wars_online_players',
    help: 'Number of online players'
  }),
  
  // 活跃竞技场数
  activeArenas: new prometheus.Gauge({
    name: 'token_wars_active_arenas',
    help: 'Number of active PvP arenas'
  }),
  
  // 技能使用次数
  skillUsage: new prometheus.Counter({
    name: 'token_wars_skill_usage_total',
    help: 'Total number of skill uses',
    labelNames: ['skill_id']
  }),
  
  // 游戏循环tick耗时
  tickDuration: new prometheus.Histogram({
    name: 'token_wars_tick_duration_seconds',
    help: 'Game loop tick duration',
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1]
  })
};

// 收集默认指标
collectDefaultMetrics({ prefix: 'token_wars_' });

// 暴露/metrics端点
app.get('/metrics', (req, res) => {
  res.set('Content-Type', prometheus.register.contentType);
  res.end(prometheus.register.metrics());
});

// 在游戏循环中使用
tick() {
  const end = gameMetrics.tickDuration.startTimer();
  
  // ... tick逻辑 ...
  
  end();  // 记录耗时
}
```

**Prometheus配置**: `/etc/prometheus/prometheus.yml`

```yaml
scrape_configs:
  - job_name: 'token-wars'
    static_configs:
      - targets: ['localhost:3000']
    scrape_interval: 5s
```

**Grafana仪表板**: 导入预先配置的仪表板，监控：
- 在线玩家数
- CPU/内存使用率
- 游戏循环tick耗时
- Socket.IO事件速率
- 错误率

---

### 5.4 Docker容器化

**文件**: `Dockerfile`

```dockerfile
FROM node:20-alpine

WORKDIR /app

# 安装依赖
COPY package*.json ./
RUN npm ci --production

# 复制代码
COPY . .

# 创建非root用户
RUN addgroup -S tokenwars && adduser -S tokenwars -G tokenwars
RUN chown -R tokenwars:tokenwars /app
USER tokenwars

# 暴露端口
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

CMD ["node", "server/index.js"]
```

**文件**: `docker-compose.yml`

```yaml
version: '3.8'

services:
  token-wars-server:
    build: .
    ports:
      - "3000-3003:3000"
    environment:
      NODE_ENV: production
      PORT: 3000
    deploy:
      replicas: 4
      resources:
        limits:
          cpus: '1'
          memory: 1G
    networks:
      - game-network
    volumes:
      - ./data:/app/data
      - ./logs:/app/logs
  
  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    volumes:
      - redis-data:/data
    networks:
      - game-network
  
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/nginx/ssl
    depends_on:
      - token-wars-server
    networks:
      - game-network

networks:
  game-network:
    driver: overlay

volumes:
  redis-data:
```

**使用**:
```bash
# 构建
docker build -t token-wars:latest .

# 运行
docker-compose up -d

# 查看日志
docker-compose logs -f

# 扩展实例
docker-compose up -d --scale token-wars-server=4
```

---

### 5.5 日志 (Winston)

**文件**: `server/utils/logger.js`

```javascript
const winston = require('winston');
const { combine, timestamp, printf, colorize } = winston.format;

// 自定义日志格式
const logFormat = printf(({ level, message, timestamp, ...metadata }) => {
  let metaStr = '';
  if (Object.keys(metadata).length > 0) {
    metaStr = JSON.stringify(metadata);
  }
  return `${timestamp} [${level.toUpperCase()}] ${message} ${metaStr}`;
});

// 创建logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    logFormat
  ),
  transports: [
    // 控制台输出
    new winston.transports.Console({
      format: combine(colorize(), logFormat)
    }),
    // 错误日志文件
    new winston.transports.File({
      filename: '/var/log/token-wars/error.log',
      level: 'error',
      maxsize: 10485760,  // 10MB
      maxFiles: 5
    }),
    // 综合日志文件
    new winston.transports.File({
      filename: '/var/log/token-wars/combined.log',
      maxsize: 10485760,
      maxFiles: 5
    })
  ]
});

// 按日期轮转
const dailyRotateFile = require('winston-daily-rotate-file');
logger.add(new dailyRotateFile({
  filename: '/var/log/token-wars/%DATE%-game.log',
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '14d'
}));

module.exports = logger;
```

**使用**:
```javascript
const logger = require('./utils/logger');

// 替换所有console.log
logger.info('Player connected', { playerId: player.id, username: player.username });
logger.warn('Rate limit reached', { socketId: socket.id, count: record.count });
logger.error('Failed to save player', { error: err.message, playerId: player.id });
```

---

### 5.6 健康检查与自动重启

**文件**: `server/routes/health.js`

```javascript
const express = require('express');
const router = express.Router();
const store = require('../data/Store');

router.get('/health', (req, res) => {
  const health = {
    status: 'ok',
    timestamp: Date.now(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    players: {
      connected: connectedPlayers.size,
      stored: store.players.size
    },
    systems: {
      gameEngine: gameEngine.running,
      pvpManager: pvpManager.activeArenas.size,
      pveManager: pveManager.activeDungeons.size
    }
  };
  
  // 检查关键系统
  if (!health.systems.gameEngine) {
    health.status = 'degraded';
  }
  
  res.json(health);
});

module.exports = router;
```

**PM2自动重启配置**:
```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'token-wars-server',
    script: 'server/index.js',
    // 健康检查
    exp_backoff_restart_delay: 100,
    max_restarts: 10,
    min_uptime: '10s',
    // 崩溃后重启延迟
    restart_delay: 4000,
    // 禁用自动重启（让进程管理器处理）
    autorestart: true
  }]
};
```

---

## 6. 实施计划

### Phase 1: 关键安全修复 (1-2天)
1. ✅ 添加Socket.IO认证中间件
2. ✅ 添加速率限制中间件
3. ✅ 添加输入验证
4. ✅ 修复CORS配置

**文件修改**:
- `server/index.js`
- 新建 `server/middleware/auth.js`
- 新建 `server/middleware/rateLimit.js`
- 新建 `server/middleware/inputValidation.js`

---

### Phase 2: 性能优化 (2-3天)
1. ✅ 优化游戏循环精度
2. ✅ 添加移动验证
3. ✅ 替换JSON存储为SQLite

**文件修改**:
- `server/game/GameEngine.js`
- 新建 `server/game/MovementValidator.js`
- `server/data/Store.js`

---

### Phase 3: 监控与日志 (1-2天)
1. ✅ 集成Winston日志
2. ✅ 添加Prometheus指标
3. ✅ 创建健康检查端点

**文件修改**:
- 新建 `server/utils/logger.js`
- 新建 `server/monitoring/prometheus.js`
- 新建 `server/routes/health.js`

---

### Phase 4: 部署配置 (1天)
1. ✅ 创建PM2配置
2. ✅ 创建nginx配置
3. ✅ 创建Docker配置

**新建文件**:
- `ecosystem.config.js`
- `nginx.conf`
- `Dockerfile`
- `docker-compose.yml`

---

### Phase 5: 测试 (2-3天)
1. ✅ 添加单元测试
2. ✅ 添加集成测试
3. ✅ 添加负载测试

**新建文件**:
- `test/unit/*.test.js`
- `test/integration/*.test.js`
- `test/load/loadtest.js`

---

## 7. 风险与缓解措施

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 数据库迁移失败 | 高 | 先备份JSON文件，分阶段迁移 |
| 中间件引入新bug | 中 | 充分测试，灰度发布 |
| 性能下降 | 中 | 性能测试，监控指标 |
| Docker部署复杂 | 低 | 提供详细文档，分步实施 |

---

## 8. 成功指标

实施后应该达到：

1. **安全性**:
   - ✅ 所有WebSocket连接都经过认证
   - ✅ 速率限制生效（<100 events/min）
   - ✅ 输入验证覆盖所有事件

2. **稳定性**:
   - ✅ 游戏循环精度误差 <1ms
   - ✅ 内存使用稳定（无泄漏）
   - ✅ 自动重启生效

3. **性能**:
   - ✅ 支持100+并发玩家
   - ✅ API响应时间 <50ms
   - ✅ 游戏循环tick <20ms

4. **可维护性**:
   - ✅ 统一日志系统
   - ✅ 实时监控仪表板
   - ✅ 自动化部署流程

---

## 9. 下一步行动

1. **立即开始**: Phase 1 (安全修复)
2. **并行进行**: 编写测试（Phase 5）
3. **代码审查**: 每个Phase完成后进行
4. **灰度发布**: 先在测试服务器部署，验证后再生产环境发布

---

**附录: 快速检查清单**

部署前检查：
- [ ] 所有中间件已测试
- [ ] 数据库迁移脚本已备份
- [ ] 监控仪表板可访问
- [ ] 日志文件可写入
- [ ] 健康检查端点返回200
- [ ] Docker镜像构建成功
- [ ] nginx配置测试通过
- [ ] SSL证书已配置
- [ ] 环境变量已设置
- [ ] 防火墙规则已配置

---

**文档版本**: v1.0  
**最后更新**: 2026-05-21  
**作者**: UnityMultiplayerEngineer  
