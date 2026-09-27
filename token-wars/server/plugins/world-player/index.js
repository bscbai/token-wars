/**
 * world-player 插件 — 在线世界与玩家档案（原 server/index.js:59,87-89,107-148 的装配）
 *
 * M2 起持有在线注册表三 Map 与 registerPlayer 流程：
 *   auth:authenticated（宿主广播，握手/AUTH_LOGIN 两路同源）
 *     → registerPlayer（会话顶替踢旧 → 三表更新 → ctx.addSocket → player:join → AUTH_SUCCESS）
 *   socket:disconnect（宿主广播）
 *     → ctx.removeSocket → 持有者守卫 → player:leave → 三表清理
 *
 * M4 起持有玩家级输入路由（原 index.js 的中央注册）：
 *   - INPUT_MOVE / INPUT_SKILL 经 ctx.socket 注册（INV1）
 *   - 战斗上下文经 combat:resolve-context 瀑布解析：pve → pvp → worldboss
 *     依次认领（认领即填充 entities/mapData 并短路；不认领则 next() 放行）
 *   - 大厅地图 + isWalkable 墙体碰撞（原 index.js lobbyMap 逐行等价）
 *
 * 事件 payload：{ player, socket }。内部事件不进 shared/constants.js（design.md 决策 5）。
 */

'use strict';

const { makePlayerRouter } = require('../../routes/player');
const { EVENTS } = require('../../../shared/protocol');
const { MAP_WIDTH, MAP_HEIGHT, TILE } = require('../../../shared/constants');

// --- 默认大厅地图（空地 + 边界墙；原 index.js lobbyMap 逐行等价） -----------
const lobbyMap = [];
for (let y = 0; y < MAP_HEIGHT; y++) {
  lobbyMap[y] = [];
  for (let x = 0; x < MAP_WIDTH; x++) {
    if (x === 0 || x === MAP_WIDTH - 1 || y === 0 || y === MAP_HEIGHT - 1) {
      lobbyMap[y][x] = TILE.WALL;
    } else {
      lobbyMap[y][x] = TILE.FLOOR;
    }
  }
}

function isWalkable(x, y, mapData) {
  if (typeof x !== 'number' || typeof y !== 'number') return false;
  if (Number.isNaN(x) || Number.isNaN(y)) return false;
  if (x < 0 || x >= MAP_WIDTH || y < 0 || y >= MAP_HEIGHT) return false;
  const map = mapData || lobbyMap;
  if (!map || !map[y]) return false;
  return map[y][x] !== TILE.WALL;
}

module.exports = {
  name: 'world-player',
  dependsOn: ['persistence', 'identity', 'combat'],
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
     * 会话顶替踢旧 → 三表更新 → ctx.addSocket（应用全部 socket spec）→
     * 广播 player:join（各插件自注册）→ 回发 AUTH_SUCCESS。
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

      // 应用全部 ctx.socket spec 到该连接（玩家级路由，INV1）
      ctx.addSocket(socket, player);

      ctx.emit('player:join', { player, socket });

      socket.emit(EVENTS.AUTH_SUCCESS, { playerId: player.id, player: player.serialize() });
      ctx.logger.info({ username: player.username, socketId: socket.id }, '[WS] Player authenticated');
    }

    // 认证完成（握手 / AUTH_LOGIN 兼容路径）→ 统一注册流
    ctx.on('auth:authenticated', ({ socket, player }) => {
      registerPlayer(socket, player);
    });

    // 断开 → 回滚 socket spec → 持有者守卫 → player:leave → 三表清理
    ctx.on('socket:disconnect', ({ socket }) => {
      ctx.removeSocket(socket);
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

    // --- 玩家级输入路由（原 index.js INPUT_* 中央注册，M4 迁入） -------------

    // 移动：墙体碰撞（地图经 combat:resolve-context 瀑布解析，未认领 → 大厅）
    const moveSchema = {
      dx: { type: 'number', min: -1, max: 1, required: true },
      dy: { type: 'number', min: -1, max: 1, required: true },
    };
    ctx.socket(EVENTS.INPUT_MOVE, moveSchema, ({ dx, dy }, { player }) => {
      if (!player.alive) return;

      const mapData = ctx.runWaterfall('combat:resolve-context', { player }).mapData || null;
      if (isWalkable(player.x + dx, player.y + dy, mapData)) {
        player.x += dx;
        player.y += dy;
      }
    }, 'movement');

    // 技能：战斗上下文经瀑布认领（副本 → 竞技场 → 世界 Boss → 大厅静默忽略）
    const skillSchema = {
      skillId: { type: 'number', min: 0, max: 3, integer: true, required: true },
      targetX: { type: 'number', min: 0, max: MAP_WIDTH - 1, integer: true, required: true },
      targetY: { type: 'number', min: 0, max: MAP_HEIGHT - 1, integer: true, required: true },
    };
    ctx.socket(EVENTS.INPUT_SKILL, skillSchema, ({ skillId, targetX, targetY }, { player }) => {
      if (!player.alive) return;

      const data = ctx.runWaterfall('combat:resolve-context', { player });
      if (data.entities) {
        ctx.get('combat').useSkill(player, skillId, targetX, targetY, data.entities);
      }
      // 未被任何战斗上下文认领（大厅）—— 静默忽略，与原 index.js 一致
    }, 'skill');
  },
};