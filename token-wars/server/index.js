const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const config = require('./config');
const logger = require('./utils/logger');
const guard = require('./middleware/eventGuard');
const { Context } = require('./core/Context');
const { Loader } = require('./core/Loader');
const { TICK_MS } = require('../shared/constants');

const PORT = config.PORT;
const NODE_ENV = config.NODE_ENV;

// --- CLI: --profile <name> / --dump-config ---------------------------------
// --dump-config：解析组合并打印插件树后退出，不创建 http/io、不启动游戏循环
const argv = process.argv.slice(2);
function cliProfileName() {
  const i = argv.indexOf('--profile');
  return (i !== -1 && argv[i + 1]) || 'full';
}
if (argv.includes('--dump-config')) {
  const dumper = new Loader(null);
  const resolved = dumper.resolve(dumper.loadProfile(cliProfileName()), { env: process.env });
  console.log(`[Token Wars] config dump\n${dumper.dumpConfig(resolved)}`);
  process.exit(0);
}
const PROFILE_NAME = cliProfileName();

// Express setup
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'client'), { etag: false, lastModified: false, setHeaders: (res) => { res.set('Cache-Control', 'no-store'); } }));
app.use('/shared', express.static(path.join(__dirname, '..', 'shared')));

// HTTP + Socket.IO
const server = http.createServer(app);
const allowedOrigins = config.CORS_ORIGIN.split(',');
const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST'] },
});

// --- Plugin kernel boot ----------------------------------------------------
// 旧版 index.js 的装配（Store 单例、auth/player/shop 路由、socketAuth 中间件、
// 6 个 Manager 实例化、store.load + autoSave）全部迁入 plugins/<name>/；
// 此处仅建 Context、按 profile 挂载、经服务接缝取回引用。
const ctx = new Context({ io, app, server, config, logger });
const loader = new Loader(ctx);
loader.mountProfile(loader.loadProfile(PROFILE_NAME), { env: process.env });

// Game systems（经由服务接缝——M3 起节奏由插件 ctx.every 声明，Scheduler 驱动）
const store = ctx.get('store');
const pveManager = ctx.get('pve');
const pvpManager = ctx.get('pvp');
ctx.scheduler.start(TICK_MS);

// 在线注册表由 world-player 插件持有；此处仅取引用供 /health 使用
const { connectedPlayers } = ctx.get('players');

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    memoryRss: process.memoryUsage().rss,
    players: { connected: connectedPlayers.size, stored: store.players.size },
    systems: {
      scheduler: ctx.scheduler._master !== null,
      pvpArenas: pvpManager.activeArenas ? pvpManager.activeArenas.size : 0,
      pveDungeons: pveManager.activeDungeons ? pveManager.activeDungeons.size : 0,
    },
    db: path.basename(config.DB_PATH),
  });
});

// --- Host connection loop（M4 形态：三个广播，零协议事件注册） ----------------
// 宿主不再注册任何客户端协议事件（INV1：网络可见处理器全部经 ctx.socket
// 由插件注册）。宿主只广播三类事实：
//   socket:connected     → identity 挂载 AUTH_LOGIN 兼容路径 + PING
//   auth:authenticated   → world-player 注册玩家并应用全部 socket spec
//   socket:disconnect    → world-player/identity 回滚该连接的全部监听
io.on('connection', (socket) => {
  logger.info({ socketId: socket.id }, '[WS] Client connected');

  // 连接级协议事件（AUTH_LOGIN 兼容 + PING）由 identity 插件经此广播挂载
  ctx.emit('socket:connected', { socket });

  // 握手认证路径：socketAuth 中间件已写入 socket.data.player
  if (socket.data.player) {
    ctx.emit('auth:authenticated', { socket, player: socket.data.player });
  }

  // 断开 → 广播事实；world-player 据此发出 player:leave
  // （持有者守卫逻辑在 world-player 内，会话顶替时序不变）
  socket.on('disconnect', () => {
    ctx.emit('socket:disconnect', { socket });
    // Cleanup rate limit data
    guard.rateLimiter.cleanup(socket.id);
  });
});

// --- Graceful shutdown ------------------------------------------------------
// Order: stop accepting traffic -> drop sockets -> stop the tick -> flush and
// close the db (which checkpoints the WAL). Hard-exit after SHUTDOWN_TIMEOUT_MS
// so a stuck socket can never leave the WAL un-checkpointed forever.
const SHUTDOWN_TIMEOUT_MS = 5000;   // hard ceiling — force exit past this
const DRAIN_GRACE_MS = 1500;        // let in-flight requests finish
const FORCED_CLOSE_SETTLE_MS = 300; // after cutting sockets off
let shuttingDown = false;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms).unref());
}

function closeAsync(label, fn) {
  const started = Date.now();
  return new Promise((resolve) => {
    const done = () => {
      logger.debug({ label, ms: Date.now() - started }, '[Server] close step done');
      resolve();
    };
    try {
      fn(done);
    } catch (err) {
      logger.warn({ err: err.message, label }, '[Server] close step failed');
      resolve();
    }
  });
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, '[Server] Graceful shutdown started');

  // Last-resort guard: if anything hangs, still try to close the db, then bail.
  const forceExit = setTimeout(() => {
    logger.error({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, '[Server] Shutdown timed out — forcing exit');
    try { store.close(); } catch (_) {}
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  // 1) stop accepting new connections
  const httpClosed = closeAsync('http', (done) => server.close(done));
  // Idle keep-alive sockets hold server.close() open indefinitely; drop them now.
  if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();

  // 2) disconnect socket.io clients
  const ioClosed = closeAsync('socket.io', (done) => io.close(done));

  // Give in-flight work a short grace, then cut off whatever is left. A client
  // holding an open socket must never delay the db flush below.
  const networkClosed = Promise.all([httpClosed, ioClosed]);
  let drained = false;
  await Promise.race([networkClosed.then(() => { drained = true; }), delay(DRAIN_GRACE_MS)]);
  if (!drained) {
    logger.warn({ graceMs: DRAIN_GRACE_MS }, '[Server] Connections still open — forcing close');
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await Promise.race([networkClosed, delay(FORCED_CLOSE_SETTLE_MS)]);
  }

  // 3) stop the game tick
  try { ctx.scheduler.stop(); } catch (err) {
    logger.warn({ err: err.message }, '[Server] scheduler.stop failed');
  }

  // 4) final save + WAL checkpoint + db close
  try { store.close(); } catch (err) {
    logger.error({ err: err.message }, '[Server] store.close failed');
  }

  clearTimeout(forceExit);
  logger.info('[Server] Shutdown complete');
  process.exit(0);
}

process.on('SIGINT', () => { shutdown('SIGINT'); });
process.on('SIGTERM', () => { shutdown('SIGTERM'); });

// Start
server.listen(PORT, '0.0.0.0', () => {
  logger.info({ port: PORT, env: NODE_ENV, profile: PROFILE_NAME }, '[Token Wars] Server running');
});
