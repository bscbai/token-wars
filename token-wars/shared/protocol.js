// Token Wars: 算力征途 — Protocol Definitions
// All Socket.IO event names and payload descriptions

const EVENTS = {
  // === Auth ===
  AUTH_LOGIN: 'auth:login',           // C→S: { token } (session token from REST login)
  AUTH_SUCCESS: 'auth:success',       // S→C: { playerId, player }
  AUTH_FAIL: 'auth:fail',             // S→C: { reason }

  // === Player State ===
  PLAYER_UPDATE: 'player:update',     // S→C: { hp, maxHp, stableTokens, unstableTokens, level, xp, credits }
  PLAYER_DEAD: 'player:dead',         // S→C: { droppedTokens, respawnMs }
  PLAYER_RESPAWN: 'player:respawn',   // S→C: { position }

  // === Movement ===
  INPUT_MOVE: 'input:move',           // C→S: { dx, dy } (-1, 0, 1)
  STATE_SYNC: 'state:sync',          // S→C: { players: [{id,x,y,hp}], monsters: [...], projectiles: [...] }

  // === Combat ===
  INPUT_SKILL: 'input:skill',         // C→S: { skillId, targetX?, targetY? }
  COMBAT_HIT: 'combat:hit',           // S→C: { attackerId, targetId, damage, skillId, isCrit }
  COMBAT_DEATH: 'combat:death',       // S→C: { entityId, killerId, loot? }
  COMBAT_MISS: 'combat:miss',         // S→C: { attackerId, skillId, reason }
  COMBAT_SHIELD: 'combat:shield',     // S→C: { playerId, active, absorbRemaining }

  // === Projectiles ===
  PROJECTILE_SPAWN: 'projectile:spawn',   // S→C: { id, x, y, targetX, targetY, speed, ownerId }
  PROJECTILE_HIT: 'projectile:hit',       // S→C: { id, targetId, damage }
  PROJECTILE_DESTROY: 'projectile:destroy', // S→C: { id }

  // === Mining ===
  MINING_UPDATE: 'mining:update',     // S→C: { pendingTokens, miningLevel, capacity, rateMs }
  MINING_COLLECT: 'mining:collect',   // C→S: {}
  MINING_COLLECTED: 'mining:collected', // S→C: { amount, tokenType }
  MINING_UPGRADE: 'mining:upgrade',   // C→S: {}
  MINING_UPGRADED: 'mining:upgraded', // S→C: { newLevel, newRate }

  // === PvE ===
  DUNGEON_JOIN: 'dungeon:join',       // C→S: { dungeonId }
  DUNGEON_START: 'dungeon:start',     // S→C: { mapData, roomIndex }
  DUNGEON_ROOM_CLEAR: 'dungeon:room_clear', // S→C: { roomIndex, loot }
  DUNGEON_BOSS_PHASE: 'dungeon:boss_phase', // S→C: { phase, bossHp }
  DUNGEON_COMPLETE: 'dungeon:complete',     // S→C: { rewards }
  DUNGEON_FAIL: 'dungeon:fail',       // S→C: { reason }

  // === PvP ===
  PVP_QUEUE: 'pvp:queue',             // C→S: { mode: '1v1' | '3v3' }
  PVP_DEQUEUE: 'pvp:dequeue',         // C→S: {}
  PVP_MATCHED: 'pvp:matched',         // S→C: { arenaId, teams, mapData }
  PVP_ROUND_START: 'pvp:round_start', // S→C: { roundNumber }
  PVP_ROUND_END: 'pvp:round_end',     // S→C: { winner, scores }
  PVP_MATCH_END: 'pvp:match_end',     // S→C: { winner, ratingChange, rewards }
  PVP_LAST_STAND: 'pvp:last_stand',   // S→C: { playerId, atkBonus, defBonus, duration }

  // === World Boss ===
  WORLD_BOSS_ANNOUNCE: 'world_boss:announce', // S→C: { bossName, location, timeLeft }
  WORLD_BOSS_JOIN: 'world_boss:join',         // C→S: {}
  WORLD_BOSS_UPDATE: 'world_boss:update',     // S→C: { bossHp, contributions, events }
  WORLD_BOSS_END: 'world_boss:end',           // S→C: { rankings, rewards }

  // === Shop ===
  SHOP_BUY: 'shop:buy',               // C→S: { packId }
  SHOP_PURCHASED: 'shop:purchased',   // S→C: { packId, contents }

  // === Inventory ===
  INVENTORY_UPDATE: 'inventory:update', // S→C: { stableTokens, unstableTokens, equippedTokens }
  SKILL_DISK_UPDATE: 'skill_disk:update', // S→C: { slots: [{tokenId, position}] }

  // === System ===
  ERROR: 'error',                      // S→C: { message, code }
  PING: 'ping',                        // C→S: { timestamp }
  PONG: 'pong',                        // S→C: { timestamp }
};

// REST endpoints
const REST = {
  AUTH_REGISTER: '/api/auth/register',
  AUTH_LOGIN: '/api/auth/login',
  SHOP_LIST: '/api/shop/packs',
  SHOP_BUY: '/api/shop/buy',
  PLAYER_PROFILE: '/api/player/profile',
};

module.exports = { EVENTS, REST };
