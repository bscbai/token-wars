const logger = require('../utils/logger');

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
 * @param {function} verifySession  — (token) => Player | null
 * @returns {function} Socket.IO middleware  — (socket, next) => void
 */
function makeSocketAuth({ verifySession }) {
  return function socketAuth(socket, next) {
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
