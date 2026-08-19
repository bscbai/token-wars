/**
 * world-player 插件 — 在线世界与玩家档案（原 server/index.js:59,87-89,107-148 的装配）
 *
 * M2 起持有在线注册表三 Map 与 registerPlayer 流程：
 *   auth:authenticated（宿主广播，握手/AUTH_LOGIN 两路同源）
 *     → registerPlayer（会话顶替踢旧 → 三表更新 → player:join → AUTH_SUCCESS）
 *   socket:disconnect（宿主广播）
 *     → 持有者守卫 → player:leave → 三表清理
 *
 * 事件 payload：{ player, socket }。内部事件不进 shared/constants.js（design.md 决策 5）。
 */

'use strict';

const { makePlayerRouter } = require('../../routes/player');
const { EVENTS } = require('../../../shared/protocol');

module.exports = {
  name: 'world-player',
  dependsOn: ['persistence', 'identity'],
  provides: ['players'],

  setup(ctx) {
    const store = ctx.get('store');

    const router = makePlayerRouter({ store, verifySession: ctx.get('auth') });
    ctx.route('/api/player', router);

    // --- 在线注册表（原 server/index.js:87-89） -----------------------------
    const connectedPlayers = new Map(); // socketId -> player
    const socketToPlayerId = new Map(); // socketId -> playerId
    const playerToSocket = new Map();   // playerId -> socketId（会话唯一）

    ctx.service('players', { connectedPlayers, socketToPlayerId, playerToSocket });

    /**
     * 注册玩家（原 server/index.js registerPlayer，行为逐行等价）：
     * 会话顶替踢旧 → 三表更新 → 广播 player:join（各插件自注册）→ 回发 AUTH_SUCCESS。
     * 注意：踢旧发生在三表更新之前 —— 旧 socket 的同步 disconnect 里
     * playerToSocket 仍指向旧 socket，持有者守卫放行，旧注册被注销
     * （socket.io v4 现状时序，M0 ③ 已锁定）。
     */
    function registerPlayer(socket, player) {
      const existingSocketId = playerToSocket.get(player.id);
      if (existingSocketId && existingSocketId !== socket.id) {
        const existingSocket = ctx.io.sockets.sockets.get(existingSocketId);
        if (existingSocket) {
          existingSocket.emit(EVENTS.SESSION_REPLACED, {
            message: 'Session replaced by a new connection',
          });
          existingSocket.disconnect(true);
          ctx.logger.info(
            { playerId: player.id, oldSocketId: existingSocketId, newSocketId: socket.id },
            '[WS] Replaced existing session'
          );
        }
      }

      playerToSocket.set(player.id, socket.id);
      connectedPlayers.set(socket.id, player);
      socketToPlayerId.set(socket.id, player.id);

      ctx.emit('player:join', { player, socket });

      socket.emit(EVENTS.AUTH_SUCCESS, { playerId: player.id, player: player.serialize() });
      ctx.logger.info({ username: player.username, socketId: socket.id }, '[WS] Player authenticated');
    }

    // 认证完成（握手 / AUTH_LOGIN 兼容路径）→ 统一注册流
    ctx.on('auth:authenticated', ({ socket, player }) => {
      registerPlayer(socket, player);
    });

    // 断开 → 持有者守卫 → player:leave → 三表清理（原 server/index.js:262-288）
    ctx.on('socket:disconnect', ({ socket }) => {
      const player = connectedPlayers.get(socket.id);
      const playerId = socketToPlayerId.get(socket.id);
      if (playerId) {
        // 仅当该 socket 仍是玩家的当前持有者才注销 —— 会话顶替时旧 socket
        // 的 disconnect 晚于 playerToSocket 更新（异步路径）会被守卫拦下
        if (playerToSocket.get(playerId) === socket.id) {
          ctx.emit('player:leave', { player, socket });
          playerToSocket.delete(playerId);
        }
        socketToPlayerId.delete(socket.id);
      }
      if (player) {
        ctx.logger.info({ username: player.username }, '[WS] Player disconnected');
        connectedPlayers.delete(socket.id);
      }
    });
  },
};
