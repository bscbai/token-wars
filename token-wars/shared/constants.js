// Token Wars: 算力征途 — Shared Constants
/* eslint-env browser, node */

const TICK_RATE = 20; // Server ticks per second
const TICK_MS = 1000 / TICK_RATE;

// Map
const TILE_SIZE = 32;
const MAP_WIDTH = 30;
const MAP_HEIGHT = 30;

// Tile types
const TILE = {
  FLOOR: 0,
  WALL: 1,
  HAZARD: 2,
  SPAWN_A: 3,
  SPAWN_B: 4,
};

// Token rarity
const RARITY = {
  COMMON: 'common',
  UNCOMMON: 'uncommon',
  RARE: 'rare',
  EPIC: 'epic',
  LEGENDARY: 'legendary',
};

const RARITY_CONFIG = {
  [RARITY.COMMON]:    { color: 0xFFFFFF, dropRate: 0.60, atk: 1,  def: 0, label: '白' },
  [RARITY.UNCOMMON]:  { color: 0x00FF00, dropRate: 0.25, atk: 3,  def: 1, label: '绿' },
  [RARITY.RARE]:      { color: 0x0088FF, dropRate: 0.10, atk: 7,  def: 3, label: '蓝' },
  [RARITY.EPIC]:      { color: 0xAA00FF, dropRate: 0.04, atk: 15, def: 8, label: '紫' },
  [RARITY.LEGENDARY]: { color: 0xFF8800, dropRate: 0.01, atk: 30, def: 15, label: '橙' },
};

// Token stability
const TOKEN_TYPE = {
  STABLE: 'stable',    // Equipment, dropped on death
  UNSTABLE: 'unstable', // Ammo, NOT dropped on death
};

// Player defaults
const PLAYER_DEFAULTS = {
  maxHp: 100,
  baseAtk: 10,
  baseDef: 5,
  moveSpeed: 1, // tiles per tick
  startCredits: 200,
  startUnstableTokens: 20,
  startStableTokens: [], // empty
};

// Death drop
const DEATH_DROP_RATE = { min: 0.3, max: 0.5 }; // 30-50% of carried stable tokens

// Skills
const SKILLS = {
  BASIC_ATTACK: {
    id: 'basic_attack',
    name: '基础攻击',
    multiplier: 1.0,
    tokenCost: 1,
    cooldown: 500, // ms
    range: 1, // tiles
    type: 'melee',
  },
  DODGE_ROLL: {
    id: 'dodge_roll',
    name: '闪避翻滚',
    multiplier: 0,
    tokenCost: 0,
    cooldown: 3000,
    range: 3,
    type: 'movement',
    invulnDuration: 500,
  },
  SHIELD: {
    id: 'shield',
    name: '算力护盾',
    multiplier: 0,
    tokenCost: 0,
    tokenDrain: 1, // per second
    cooldown: 1000,
    range: 0,
    type: 'shield',
    absorbAmount: 20,
  },
  TOKEN_BURST: {
    id: 'token_burst',
    name: '算力爆发',
    multiplier: 1.5,
    tokenCost: 3,
    cooldown: 10000,
    range: 0,
    type: 'aoe',
    aoeRadius: 2,
  },
};

// Co-processor tokens (rare special abilities)
const COPROCESSORS = {
  LIGHTNING_SURGE: {
    id: 'lightning_surge',
    name: '闪电链',
    multiplier: 1.5,
    chainCount: 3,
    cooldown: 8000,
    tokenCost: 2,
    freeVersion: { multiplier: 1.0, chainCount: 2, cooldown: 10000 },
  },
  SHIELD_OVERLOAD: {
    id: 'shield_overload',
    name: '护盾超载',
    absorbAmount: 50,
    reflectPercent: 0.3,
    cooldown: 12000,
    tokenCost: 2,
    freeVersion: { absorbAmount: 30, reflectPercent: 0.15, cooldown: 15000 },
  },
  STEALTH_FIELD: {
    id: 'stealth_field',
    name: '区域隐身',
    duration: 3000,
    backstabMultiplier: 2.0,
    cooldown: 15000,
    tokenCost: 2,
    freeVersion: { duration: 2000, backstabMultiplier: 1.5, cooldown: 20000 },
  },
  TOKEN_MAGNET: {
    id: 'token_magnet',
    name: '算力磁铁',
    radius: 8,
    cooldown: 20000,
    tokenCost: 1,
    freeVersion: { radius: 4, cooldown: 30000 },
  },
};

// Mining
const MINING = {
  LEVELS: [
    { level: 1, cost: 0,    rate: 60000,  capacity: 50 },
    { level: 2, cost: 20,   rate: 45000,  capacity: 100, costRarity: RARITY.UNCOMMON },
    { level: 3, cost: 50,   rate: 30000,  capacity: 200, costRarity: RARITY.RARE },
    { level: 4, cost: 100,  rate: 20000,  capacity: 500, costRarity: RARITY.EPIC },
    { level: 5, cost: 500,  rate: 15000,  capacity: 1000, costRarity: RARITY.EPIC },
  ],
  OFFLINE_CAP_HOURS: 8,
};

// PvP
const PVP = {
  START_RATING: 1000,
  RATING_CHANGE: 25,
  ROUND_TIME: 120000, // 120s
  SHRINK_TIME: 90000, // 90s
  CORE_TIME: 120000,  // 120s — Data Core spawns
  CORE_HP: 500,
  LAST_STAND_ATK: 1.2,
  LAST_STAND_DEF: 0.9,
  LAST_STAND_DURATION: 15000,
  WIN_STREAK_DAILY_CAP: 3,
};

// Shop packs
const SHOP_PACKS = {
  starter: {
    id: 'starter',
    name: '新手礼包',
    price: 0,
    oneTime: true,
    contents: { unstable: 20, stable: [{ rarity: RARITY.UNCOMMON, count: 5 }] },
  },
  basic: {
    id: 'basic',
    name: '基础算力包',
    price: 100,
    contents: { unstable: 10, stable: [{ rarity: RARITY.UNCOMMON, count: 1 }] },
  },
  premium: {
    id: 'premium',
    name: '高级算力包',
    price: 500,
    contents: { unstable: 30, stable: [{ rarity: RARITY.RARE, count: 1 }], coprocessor: true },
  },
  legendary: {
    id: 'legendary',
    name: '传说算力包',
    price: 2000,
    contents: { unstable: 50, stable: [{ rarity: RARITY.EPIC, count: 1 }], coprocessor: true },
  },
  ammo: {
    id: 'ammo',
    name: '弹药箱',
    price: 50,
    contents: { unstable: 50 },
  },
};

// XP and levels
const LEVEL_XP = [
  0, 100, 250, 500, 800, 1200, 1800, 2500, 3500, 5000,
  7000, 9500, 12500, 16000, 20000, 25000, 31000, 38000, 46000, 55000,
  65000,
];

const LEVEL_UNLOCKS = {
  1:  { skillSlots: 2, tokenSlots: 4, gridSize: 2 },
  5:  { skillSlots: 3, tokenSlots: 9, gridSize: 3 },
  10: { skillSlots: 4, tokenSlots: 16, gridSize: 4 },
  15: { skillSlots: 4, tokenSlots: 16, gridSize: 4, seasonalPattern: true },
  20: { skillSlots: 4, tokenSlots: 16, gridSize: 4, worldBoss: true },
};

// Damage formula
function calcDamage(atk, skillMultiplier, defenderDef) {
  const baseDamage = atk * skillMultiplier;
  const defense = defenderDef;
  return Math.max(Math.floor(baseDamage - defense), 1);
}

// Random rarity roll
function rollRarity() {
  const rand = Math.random();
  let cumulative = 0;
  for (const [rarity, config] of Object.entries(RARITY_CONFIG)) {
    cumulative += config.dropRate;
    if (rand < cumulative) return rarity;
  }
  return RARITY.COMMON;
}

// --- Protocol (Socket.IO events + REST endpoints) ---
const EVENTS = {
  AUTH_LOGIN: 'auth:login', AUTH_SUCCESS: 'auth:success', AUTH_FAIL: 'auth:fail',
  PLAYER_UPDATE: 'player:update', PLAYER_DEAD: 'player:dead', PLAYER_RESPAWN: 'player:respawn',
  INPUT_MOVE: 'input:move', STATE_SYNC: 'state:sync',
  INPUT_SKILL: 'input:skill', COMBAT_HIT: 'combat:hit', COMBAT_DEATH: 'combat:death',
  COMBAT_MISS: 'combat:miss', COMBAT_SHIELD: 'combat:shield',
  PROJECTILE_SPAWN: 'projectile:spawn', PROJECTILE_HIT: 'projectile:hit', PROJECTILE_DESTROY: 'projectile:destroy',
  MINING_UPDATE: 'mining:update', MINING_COLLECT: 'mining:collect', MINING_COLLECTED: 'mining:collected',
  MINING_UPGRADE: 'mining:upgrade', MINING_UPGRADED: 'mining:upgraded',
  DUNGEON_JOIN: 'dungeon:join', DUNGEON_START: 'dungeon:start', DUNGEON_ROOM_CLEAR: 'dungeon:room_clear',
  DUNGEON_BOSS_PHASE: 'dungeon:boss_phase', DUNGEON_COMPLETE: 'dungeon:complete', DUNGEON_FAIL: 'dungeon:fail',
  PVP_QUEUE: 'pvp:queue', PVP_DEQUEUE: 'pvp:dequeue', PVP_MATCHED: 'pvp:matched',
  PVP_ROUND_START: 'pvp:round_start', PVP_ROUND_END: 'pvp:round_end', PVP_MATCH_END: 'pvp:match_end', PVP_LAST_STAND: 'pvp:last_stand',
  WORLD_BOSS_ANNOUNCE: 'world_boss:announce', WORLD_BOSS_JOIN: 'world_boss:join',
  WORLD_BOSS_UPDATE: 'world_boss:update', WORLD_BOSS_END: 'world_boss:end',
  SHOP_BUY: 'shop:buy', SHOP_PURCHASED: 'shop:purchased',
  INVENTORY_UPDATE: 'inventory:update', SKILL_DISK_UPDATE: 'skill_disk:update',
  AI_ARENA_DEPLOY: 'ai_arena:deploy', AI_ARENA_RECALL: 'ai_arena:recall',
  AI_ARENA_DEPLOYED: 'ai_arena:deployed', AI_ARENA_RECALLED: 'ai_arena:recalled',
  AI_ARENA_TRAIN: 'ai_arena:train', AI_ARENA_SET_BEHAVIOR: 'ai_arena:set_behavior',
  AI_ARENA_BEHAVIOR_SET: 'ai_arena:behavior_set',
  AI_ARENA_GET_AGENTS: 'ai_arena:get_agents', AI_ARENA_AGENT_LIST: 'ai_arena:agent_list',
  AI_ARENA_QUEUE_FAIL: 'ai_arena:queue_fail',
  AI_ARENA_MATCH_RESULT: 'ai_arena:match_result',
  AI_ARENA_GET_REPLAY: 'ai_arena:get_replay', AI_ARENA_REPLAY: 'ai_arena:replay',
  AI_ARENA_NAME_AGENT: 'ai_arena:name_agent', AI_ARENA_AGENT_NAMED: 'ai_arena:agent_named',
  AI_ARENA_MATCH_HISTORY: 'ai_arena:match_history',
  AI_ARENA_LEADERBOARD: 'ai_arena:leaderboard',
  AI_ARENA_TOURNAMENT: 'ai_arena:tournament', AI_ARENA_TOURNAMENT_STATE: 'ai_arena:tournament_state',
  AI_ARENA_TOURNAMENT_START: 'ai_arena:tournament_start',
  AI_ARENA_TOURNAMENT_MATCH: 'ai_arena:tournament_match',
  AI_ARENA_TOURNAMENT_ROUND: 'ai_arena:tournament_round',
  AI_ARENA_TOURNAMENT_END: 'ai_arena:tournament_end',
  AI_ARENA_SEASON_INFO: 'ai_arena:season_info', AI_ARENA_SEASON_UPDATE: 'ai_arena:season_update',
  ERROR: 'error', PING: 'ping', PONG: 'pong',
};

const REST = {
  AUTH_REGISTER: '/api/auth/register', AUTH_LOGIN: '/api/auth/login',
  SHOP_LIST: '/api/shop/packs', SHOP_BUY: '/api/shop/buy', PLAYER_PROFILE: '/api/player/profile',
};

const _exports = {
  TICK_RATE, TICK_MS, TILE_SIZE, MAP_WIDTH, MAP_HEIGHT, TILE,
  RARITY, RARITY_CONFIG, TOKEN_TYPE, PLAYER_DEFAULTS, DEATH_DROP_RATE,
  SKILLS, COPROCESSORS, MINING, PVP, SHOP_PACKS, LEVEL_XP, LEVEL_UNLOCKS,
  calcDamage, rollRarity,
  EVENTS, REST,
};

// Always set browser global (for client-side modules)
if (typeof window !== 'undefined') {
  window.TOKEN_CONSTANTS = _exports;
}

// CommonJS export (for Node.js server)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = _exports;
}
