const logger = require('../utils/logger');
const { BOT_NAMESPACE } = require('../../shared/constants');

/**
 * Socket.IO handshake authentication middleware factory.
 *
 * Validates the JWT carried in `handshake.auth.token` using the provided
 * `verifySession` function.  On success the player object is attached to
 * `socket.data.player` and `socket.data.authenticated` is set to `true`
 * so the connection handler can register the player immediately without
 * waiting for an AUTH_LOGIN event.
 *
 * On failure (missing or invalid token) the connection is rejected via
 * `next(new Error(...))` and a structured log entry is emitted.
 *
 * `/bot` 命名空间例外：外部 agent 无 JWT 会话，改用 botToken 握手
 * （命名空间级中间件校验，见 aiarena 插件）。此中间件经 io.use 全局
 * 挂载，故必须在此放行，否则 bot 连接会被 JWT 检查拦截。
 *
 * @param {function} verifySession  — (token) => Player | null
 * @returns {function} Socket.IO middleware  — (socket, next) => void
 */
function makeSocketAuth({ verifySession }) {
  return function socketAuth(socket, next) {
    if (socket.nsp && socket.nsp.name === BOT_NAMESPACE) {
      // bot 认证由 /bot 命名空间中间件负责（botToken），此处直接放行
      return next();
    }

    const token = socket.handshake.auth && socket.handshake.auth.token;

    if (!token) {
      logger.info(
        { socketId: socket.id, reason: 'missing_token' },
        '[WS] Connection rejected: no auth token in handshake'
      );
      return next(new Error('Authentication required'));
    }

    const player = verifySession(token);
    if (!player) {
      logger.info(
        { socketId: socket.id, reason: 'invalid_token' },
        '[WS] Connection rejected: invalid or expired token'
      );
      return next(new Error('Invalid session'));
    }

    socket.data.player = player;
    socket.data.playerId = player.id;
    socket.data.authenticated = true;

    logger.info(
      { socketId: socket.id, playerId: player.id, username: player.username },
      '[WS] Handshake authentication successful'
    );
    next();
  };
}

module.exports = { makeSocketAuth };
