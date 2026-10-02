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
    duration: 4000, // ms — 护盾基础持续时间（GDD §4.4 连招时长语义的地基）
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

// Skill key mapping (client key → skill slot index in Player.skills)
const SKILL_KEYS = { Q: 0, W: 1, E: 2, R: 3 };

// Combat triangle (GDD §4.1): Q counters E, E counters R, R counters Q
const COMBAT_TRIANGLE = {
  MELEE_VS_SHIELD_MULT: 0.5, // 攻击穿透护盾，造成 50% 伤害
  KNOCKBACK_TILES: 1,        // 爆发击退距离
};

// Combo system (GDD §4.4): sequences within the window trigger bonuses
const COMBOS = {
  WINDOW_MS: 2000,
  DODGE_CRIT_WINDOW_MS: 1000, // 闪避反击：W 后 1s 内
  DODGE_CRIT_BONUS: 0.5,      // 暴击率 +50%
  AOE_DAMAGE_BONUS: 0.3,      // 蓄力爆发：R 伤害 +30%
  RECIPES: [
    { id: 'charged_burst',  name: '蓄力爆发', seq: [SKILL_KEYS.Q, SKILL_KEYS.Q, SKILL_KEYS.R] }, // 最后 R 伤害 +30%
    { id: 'counter_combo',  name: '反击连击', seq: [SKILL_KEYS.E, SKILL_KEYS.Q, SKILL_KEYS.Q] }, // 护盾期间攻击不耗弹药
    { id: 'dodge_counter',  name: '闪避反击', seq: [SKILL_KEYS.W, SKILL_KEYS.Q] },               // 闪避后 1s 内暴击率 +50%
    { id: 'blast_shield',   name: '爆破护盾', seq: [SKILL_KEYS.R, SKILL_KEYS.E, SKILL_KEYS.Q] }, // R 后 E 吸收量翻倍
    { id: 'perfect_defense', name: '完美防御', seq: [SKILL_KEYS.E, SKILL_KEYS.W, SKILL_KEYS.E] }, // 第二次 E 持续时间 +100%
  ],
};

// Basic ammo pool (GDD §2.2): free ammo that keeps rookies fighting
const BASIC_AMMO = {
  MAX: 50,            // 上限 50 发，不占背包
  REGEN_MS: 30000,    // 脱战 30s 恢复 1 发
  DAMAGE_MULT: 0.5,   // 动用基础弹药时本次伤害 ×0.5
};

// Co-processor tokens (GDD §3): 16-codex collection with ★→★★→★★★ star scaling.
// ★ = GDD "免费版" column, ★★ = GDD main table, ★★★ = extrapolation ruling
// (see openspec/changes/coprocessor-system/design.md §3). cooldown in ms.
const COPROCESSOR_CATEGORIES = {
  ATTACK: 'attack',
  DEFENSE: 'defense',
  MOBILITY: 'mobility',
  ECONOMY: 'economy',
};

const COPROCESSORS = {
  // --- 攻击型 ---
  LIGHTNING_SURGE: {
    id: 'lightning_surge',
    name: '闪电链',
    category: COPROCESSOR_CATEGORIES.ATTACK,
    stars: [
      { damageMult: 1.0, chainCount: 2, cooldown: 10000, tokenCost: 2 },
      { damageMult: 1.3, chainCount: 3, cooldown: 8000, tokenCost: 2 },
      { damageMult: 1.5, chainCount: 4, cooldown: 6000, tokenCost: 1 },
    ],
  },
  PIERCING_SHOT: {
    id: 'piercing_shot',
    name: '穿透射击',
    category: COPROCESSOR_CATEGORIES.ATTACK,
    stars: [
      { damageMult: 0.8, cooldown: 8000, tokenCost: 1 },
      { damageMult: 1.0, cooldown: 6000, tokenCost: 1 },
      { damageMult: 1.2, cooldown: 4000, tokenCost: 1 },
    ],
  },
  SPLIT_ROUND: {
    id: 'split_round',
    name: '分裂弹',
    category: COPROCESSOR_CATEGORIES.ATTACK,
    stars: [
      { fragmentCount: 2, fragmentMult: 0.5, cooldown: 12000, tokenCost: 2 }, // fragmentMult: 裁决值（每弹片 50% 伤害）
      { fragmentCount: 3, fragmentMult: 0.5, cooldown: 10000, tokenCost: 2 },
      { fragmentCount: 4, fragmentMult: 0.5, cooldown: 8000, tokenCost: 1 },
    ],
  },
  BURN_MARK: {
    id: 'burn_mark',
    name: '灼烧印记',
    category: COPROCESSOR_CATEGORIES.ATTACK,
    stars: [
      { burnStacks: 2, cooldown: 2000, tokenCost: 1 },
      { burnStacks: 3, cooldown: 1500, tokenCost: 1 },
      { burnStacks: 4, cooldown: 1200, tokenCost: 1 },
    ],
  },
  // --- 防御型 ---
  SHIELD_OVERLOAD: {
    id: 'shield_overload',
    name: '护盾超载',
    category: COPROCESSOR_CATEGORIES.DEFENSE,
    stars: [
      { absorbAmount: 30, reflectPercent: 0.15, cooldown: 15000, tokenCost: 2 },
      { absorbAmount: 50, reflectPercent: 0.3, cooldown: 12000, tokenCost: 2 },
      { absorbAmount: 70, reflectPercent: 0.4, cooldown: 10000, tokenCost: 1 },
    ],
  },
  DAMAGE_TO_HEAL: {
    id: 'damage_to_heal',
    name: '伤害转治疗',
    category: COPROCESSOR_CATEGORIES.DEFENSE,
    stars: [
      { duration: 2000, cooldown: 25000, tokenCost: 2 },
      { duration: 3000, cooldown: 20000, tokenCost: 2 },
      { duration: 4000, cooldown: 15000, tokenCost: 1 },
    ],
  },
  REBOUND_BARRIER: {
    id: 'rebound_barrier',
    name: '反弹屏障',
    category: COPROCESSOR_CATEGORIES.DEFENSE,
    stars: [
      { reflectChance: 0.5, duration: 4000, cooldown: 20000, tokenCost: 2 }, // duration: 裁决值（区域持续时长）
      { reflectChance: 1.0, duration: 5000, cooldown: 15000, tokenCost: 2 },
      { reflectChance: 1.0, duration: 6000, cooldown: 12000, tokenCost: 1 },
    ],
  },
  EMERGENCY_REPAIR: {
    id: 'emergency_repair',
    name: '紧急修复',
    category: COPROCESSOR_CATEGORIES.DEFENSE,
    stars: [
      { healPercent: 0.15, cooldown: 90000, tokenCost: 0 },
      { healPercent: 0.3, cooldown: 60000, tokenCost: 0 },
      { healPercent: 0.45, cooldown: 45000, tokenCost: 0 },
    ],
  },
  // --- 机动型 ---
  STEALTH_FIELD: {
    id: 'stealth_field',
    name: '区域隐身',
    category: COPROCESSOR_CATEGORIES.MOBILITY,
    stars: [
      { duration: 2000, backstabMultiplier: 1.5, cooldown: 20000, tokenCost: 2 },
      { duration: 3000, backstabMultiplier: 2.0, cooldown: 15000, tokenCost: 2 },
      { duration: 4000, backstabMultiplier: 2.5, cooldown: 12000, tokenCost: 1 },
    ],
  },
  BLINK: {
    id: 'blink',
    name: '瞬移闪现',
    category: COPROCESSOR_CATEGORIES.MOBILITY,
    stars: [
      { range: 3, cooldown: 12000, tokenCost: 1 }, // range: 裁决值（★★=6 为闪避距离 2 倍，★ 减半）
      { range: 6, cooldown: 8000, tokenCost: 1 },
      { range: 8, cooldown: 6000, tokenCost: 1 },
    ],
  },
  SLOW_FIELD: {
    id: 'slow_field',
    name: '减速力场',
    category: COPROCESSOR_CATEGORIES.MOBILITY,
    stars: [
      { slowPercent: 0.3, radius: 3, cooldown: 18000, tokenCost: 1 }, // radius: 裁决值（力场半径，格）
      { slowPercent: 0.5, radius: 3, cooldown: 12000, tokenCost: 1 },
      { slowPercent: 0.6, radius: 4, cooldown: 10000, tokenCost: 1 },
    ],
  },
  PORTAL: {
    id: 'portal',
    name: '传送门',
    category: COPROCESSOR_CATEGORIES.MOBILITY,
    stars: [
      { duration: 5000, cooldown: 45000, tokenCost: 2 },
      { duration: 10000, cooldown: 30000, tokenCost: 2 },
      { duration: 15000, cooldown: 25000, tokenCost: 1 },
    ],
  },
  // --- 经济型 ---
  TOKEN_MAGNET: {
    id: 'token_magnet',
    name: '算力磁铁',
    category: COPROCESSOR_CATEGORIES.ECONOMY,
    stars: [
      { radius: 4, cooldown: 30000, tokenCost: 1 },
      { radius: 8, cooldown: 20000, tokenCost: 1 },
      { radius: 10, cooldown: 15000, tokenCost: 1 },
    ],
  },
  TOKEN_DOUBLER: {
    id: 'token_doubler',
    name: 'Token 翻倍',
    category: COPROCESSOR_CATEGORIES.ECONOMY,
    stars: [
      { dropMult: 1.5, cooldown: 90000, tokenCost: 0 },
      { dropMult: 2.0, cooldown: 60000, tokenCost: 0 },
      { dropMult: 2.5, cooldown: 45000, tokenCost: 0 },
    ],
  },
  RARITY_BOOST: {
    id: 'rarity_boost',
    name: '稀有率提升',
    category: COPROCESSOR_CATEGORIES.ECONOMY,
    stars: [
      { rarityBonus: 0.1, duration: 30000, cooldown: 180000, tokenCost: 1 },
      { rarityBonus: 0.2, duration: 30000, cooldown: 120000, tokenCost: 1 },
      { rarityBonus: 0.3, duration: 30000, cooldown: 90000, tokenCost: 1 },
    ],
  },
  OFFLINE_BOOST: {
    id: 'offline_boost',
    name: '离线加速',
    category: COPROCESSOR_CATEGORIES.ECONOMY,
    stars: [
      { miningMult: 1.25, duration: 7200000, cooldown: 86400000, tokenCost: 0 },
      { miningMult: 1.5, duration: 7200000, cooldown: 86400000, tokenCost: 0 },
      { miningMult: 2.0, duration: 14400000, cooldown: 86400000, tokenCost: 0 },
    ],
  },
};

// Star progression (GDD §3.4): ★ → ★★ costs 3 same-type fragments, ★★ → ★★★ costs 8.
const COPROCESSOR_STARS = {
  MAX: 3,
  UPGRADE_COSTS: [3, 8], // index = current star - 1
};

// Derived: all 16 codex ids (validation + uniform random rolls).
const COPROCESSOR_IDS = Object.values(COPROCESSORS).map(c => c.id);

// Fragment sources (GDD §3.4 probability table). Non-rate sources are declared
// here for codex completeness but not wired in this change (world boss / daily).
const COPROCESSOR_FRAGMENT_SOURCES = {
  SOLO_BOSS: { rate: 0.15 },            // 单人副本 Boss
  TEAM_BOSS: { rate: 0.30 },            // 团队副本 Boss（2+ 玩家）
  WORLD_BOSS: { byContribution: true }, // 世界 Boss 按贡献度分配（未接线）
  PVP_STREAK: { rate: 0.10 },           // PvP 3 连胜宝箱
  DAILY_TASK: { pool: true },           // 每日任务奖励池（未接线）
};

// Shop rulings for coprocessor grants.
const COPROCESSOR_SHOP = {
  DUPLICATE_FRAGMENTS: 3, // 礼包开出已拥有的协处理器 → 折 3 碎片
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
  SESSION_REPLACED: 'session:replaced',
  PLAYER_UPDATE: 'player:update', PLAYER_DEAD: 'player:dead', PLAYER_RESPAWN: 'player:respawn',
  INPUT_MOVE: 'input:move', STATE_SYNC: 'state:sync',
  INPUT_SKILL: 'input:skill', COMBAT_HIT: 'combat:hit', COMBAT_DEATH: 'combat:death',
  COMBAT_MISS: 'combat:miss', COMBAT_SHIELD: 'combat:shield',
  COMBAT_COMBO: 'combat:combo', COMBAT_KNOCKBACK: 'combat:knockback',
  INPUT_COPROCESSOR: 'input:coprocessor', COPROCESSOR_ACTIVATED: 'coprocessor:activated',
  COPROCESSOR_FRAGMENT: 'coprocessor:fragment', // → 玩家: { coprocessorId, count, total, source }
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
  SKILLS, SKILL_KEYS, COMBAT_TRIANGLE, COMBOS, BASIC_AMMO,
  COPROCESSORS, COPROCESSOR_CATEGORIES, COPROCESSOR_STARS, COPROCESSOR_IDS,
  COPROCESSOR_FRAGMENT_SOURCES, COPROCESSOR_SHOP,
  MINING, PVP, SHOP_PACKS, LEVEL_XP, LEVEL_UNLOCKS,
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
