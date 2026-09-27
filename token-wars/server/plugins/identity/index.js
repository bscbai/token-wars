/**
 * identity 插件 — 账号与会话（原 server/index.js:57,74 的装配）
 *
 * 提供 ctx.auth（verifySession）；挂载 /api/auth 路由与 Socket.IO
 * 握手认证中间件（io.use 的顺序语义不变：仍在任何连接建立之前）。
 *
 * M4 起还持有两个连接级（先于认证的）协议事件：
 *   - AUTH_LOGIN 兼容路径（socketAuth 中间件要求握手即带 token，
 *     此路径实际不可达，按 tasks.md 5.2 原样保留在 identity）
 *   - PING/PONG 心跳（裸 socket.on + 手动限流，与原 index.js 逐行等价）
 * 经宿主广播的 socket:connected / socket:disconnect 挂载/回收，
 * unload 时全部回滚（INV2）。
 */

'use strict';

const { makeAuth } = require('../../routes/auth');
const { makeSocketAuth } = require('../../middleware/socketAuth');
const guard = require('../../middleware/eventGuard');
const { EVENTS } = require('../../../shared/protocol');

module.exports = {
  name: 'identity',
  dependsOn: ['persistence'],
  provides: ['auth'],

  setup(ctx) {
    const store = ctx.get('store');
    const { router, verifySession } = makeAuth({ store });

    ctx.route('/api/auth', router);
    ctx.service('auth', verifySession);
    ctx.io.use(makeSocketAuth({ verifySession }));
    // 注：io.use 中间件不可逆（socket.io 无移除 API），unload 不回滚这一项

    // --- 连接级协议事件（AUTH_LOGIN 兼容 + PING） --------------------------
    const socketOffs = new Map(); // socketId -> [off, ...]

    ctx.on('socket:connected', ({ socket }) => {
      const offs = [];

      // AUTH_LOGIN 兼容路径 —— 原 index.js 逐行等价（裸 socket.on + 手动限流：
      // 限流时回发 AUTH_FAIL 而非 guard 的 RATE_LIMITED error，语义保持）
      const onAuthLogin = ({ token }) => {
        if (socket.data.authenticated) return; // 幂等守卫

        if (!guard.rateLimiter.consume(socket.id, 'auth')) {
          socket.emit(EVENTS.AUTH_FAIL, { reason: 'Rate limited' });
          return;
        }
        const player = verifySession(token);
        if (!player) {
          socket.emit(EVENTS.AUTH_FAIL, { reason: 'Invalid session' });
          return;
        }
        socket.data.authenticated = true;
        socket.data.player = player;
        ctx.emit('auth:authenticated', { socket, player });
      };
      socket.on(EVENTS.AUTH_LOGIN, onAuthLogin);
      offs.push(() => socket.off(EVENTS.AUTH_LOGIN, onAuthLogin));

      // PING/PONG —— 裸 socket.on + 手动限流（S3 排除项：PING 是内部协议事件）
      const onPing = ({ timestamp }) => {
        if (!guard.rateLimiter.consume(socket.id, 'ping')) return;
        socket.emit(EVENTS.PONG, { timestamp });
      };
      socket.on(EVENTS.PING, onPing);
      offs.push(() => socket.off(EVENTS.PING, onPing));

      socketOffs.set(socket.id, offs);
    });

    ctx.on('socket:disconnect', ({ socket }) => {
      const offs = socketOffs.get(socket.id);
      if (offs) {
        for (const off of offs) off();
        socketOffs.delete(socket.id);
      }
    });

    // unload 回滚：清掉所有存活连接上的连接级监听（INV2）
    ctx.effect(() => {
      for (const offs of socketOffs.values()) {
        for (const off of offs) off();
      }
      socketOffs.clear();
    });
  },
};