// Token Wars: 算力征途 - Browser-Compatible Shared Constants
// Loaded via <script> tag, exposes constants on window.TokenWars
(function() {
  var EVENTS = {
    CONNECT: 'connect',
    DISCONNECT: 'disconnect',
    JOIN_ROOM: 'room:join',
    LEAVE_ROOM: 'room:leave',
    ROOM_UPDATE: 'room:update',
    PLAYER_JOINED: 'player:joined',
    PLAYER_LEFT: 'player:left',
    PLAYER_MOVE: 'player:move',
    PLAYER_ATTACK: 'player:attack',
    PLAYER_SHOOT: 'player:shoot',
    PLAYER_DASH: 'player:dash',
    PLAYER_DIED: 'player:died',
    STATE_SYNC: 'state:sync',
    HP_UPDATE: 'hp:update',
    PROJECTILE_SPAWN: 'projectile:spawn',
    PROJECTILE_HIT: 'projectile:hit',
    PROJECTILE_DESTROY: 'projectile:destroy',
    MINE_START: 'mine:start',
    MINE_STOP: 'mine:stop',
    MINE_REWARD: 'mine:reward',
    TOKEN_UPDATE: 'token:update',
    INVENTORY_GET: 'inventory:get',
    INVENTORY_ADD: 'inventory:add',
    INVENTORY_USE: 'inventory:use',
    INVENTORY_DROP: 'inventory:drop',
    CHAT_MESSAGE: 'chat:message',
    CHAT_BROADCAST: 'chat:broadcast',
    AI_ARENA_DEPLOY: 'ai_arena:deploy',
    AI_ARENA_RECALL: 'ai_arena:recall',
    AI_ARENA_AGENT_LIST: 'ai_arena:agent_list',
    AI_ARENA_MATCH_QUEUE: 'ai_arena:match_queue',
    AI_ARENA_MATCH_START: 'ai_arena:match_start',
    AI_ARENA_MATCH_END: 'ai_arena:match_end',
    AI_ARENA_LEADERBOARD: 'ai_arena:leaderboard',
    AI_ARENA_TRAIN: 'ai_arena:train',
    AI_ARENA_SPECIAL: 'ai_arena:special',
    AI_ARENA_NAME: 'ai_arena:name',
    AI_ARENA_HISTORY: 'ai_arena:history',
    AI_ARENA_REPLAY: 'ai_arena:replay',
    AI_ARENA_SEASON_INFO: 'ai_arena:season_info',
    AI_ARENA_TOURNAMENT_INFO: 'ai_arena:tournament_info',
    AI_ARENA_TOURNAMENT_UPDATE: 'ai_arena:tournament_update',
    AI_ARENA_DAILY_REWARD: 'ai_arena:daily_reward',
    AI_ARENA_BROADCAST: 'ai_arena:broadcast',
    PVP_MATCH_QUEUE: 'pvp:match_queue',
    PVP_MATCH_FOUND: 'pvp:match_found',
    PVP_MATCH_END: 'pvp:match_end',
    PVP_RATING_UPDATE: 'pvp:rating_update'
  };

  var AI_ARENA = {
    CATEGORIES: ['attack', 'defense', 'mobility', 'economy'],
    RARITY_MULTIPLIERS: {
      common: 1.0,
      uncommon: 1.10,
      rare: 1.22,
      epic: 1.35
    },
    INITIAL_RATING: 800,
    K_FACTOR: 20,
    PRIORITY_TYPES: [
      'seek_lowest_hp',
      'seek_nearest_enemy',
      'flee_when_low_hp',
      'collect_nearest_token',
      'patrol_center',
      'defensive_formation',
      'aggressive_pursue',
      'random_wander'
    ],
    SPECIAL_BEHAVIORS: {
      berserker: { name: '狂暴战士', desc: 'HP<30%时攻击力翻倍', trigger: 'low_hp', effect: 'double_attack' },
      perfect_defense: { name: '完美防御', desc: '每10秒格挡一次攻击', trigger: 'interval', effect: 'block_next' },
      greedy_algorithm: { name: '贪婪算法', desc: '拾取Token时获得额外50%', trigger: 'pickup', effect: 'bonus_tokens' },
      dodge_master: { name: '闪避大师', desc: '15%概率闪避攻击', trigger: 'on_hit', effect: 'dodge' }
    },
    TRAINING: {
      EXP_PER_MATCH: 10,
      EXP_WIN_BONUS: 5,
      STAR_2_EXP: 50,    // Cumulative EXP from star 1 to 2
      STAR_3_EXP: 150,   // Additional EXP from star 2 to 3 (total 200 from star 1)
      MAX_STARS: 3
    },
    SEASON: {
      DURATION_DAYS: 7,
      MATCHES_PER_DAY: 10,
      SEASON_BUFFS: [
        { id: 'overclock', name: '超频赛季', desc: '所有攻击伤害+20%', mod: { attack: 1.20 } },
        { id: 'fortress', name: '堡垒赛季', desc: '所有防御+25%', mod: { defense: 1.25 } },
        { id: 'velocity', name: '极速赛季', desc: '移动速度+15%', mod: { mobility: 1.15 } }
      ]
    },
    TOURNAMENT: {
      TOP_N: 16,
      ROUNDS_PER_MATCH: 3,
      DAILY_REWARD_COOLDOWN: 86400000
    },
    MAPS: [
      { id: 'forge', name: '算力熔炉', grid: [8, 8], modifiers: { attack: 1.1, economy: 0.9 } },
      { id: 'data_river', name: '数据长河', grid: [10, 6], modifiers: { mobility: 1.1, defense: 0.9 } },
      { id: 'neural_grid', name: '神经网格', grid: [9, 9], modifiers: { defense: 1.1, mobility: 0.9 } },
      { id: 'token_vault', name: 'Token金库', grid: [7, 7], modifiers: { economy: 1.2, attack: 0.85 } },
      { id: 'cooling_tower', name: '冷却塔', grid: [6, 10], modifiers: { defense: 1.1, attack: 0.95 } }
    ],
    MATCH: {
      TURN_COUNT: 20,
      TURN_DURATION_MS: 2000,
      AGENTS_PER_SIDE: 3
    }
  };

  var COMBAT = {
    PLAYER_HP: 100,
    PLAYER_SPEED: 200,
    DASH_DISTANCE: 150,
    DASH_COOLDOWN: 3000,
    ATTACK_DAMAGE: 25,
    ATTACK_RANGE: 40,
    ATTACK_COOLDOWN: 800,
    SHOOT_DAMAGE: 15,
    SHOOT_RANGE: 400,
    SHOOT_COOLDOWN: 500,
    SHOOT_SPEED: 600,
    RESPAWN_TIME: 3000
  };

  var MINING = {
    BASE_RATE: 1,
    TOKEN_PER_TICK: 5,
    TICK_INTERVAL: 2000,
    MAX_NODES: 5,
    NODE_DURATION: 60000,
    NODE_RESPAWN: 15000
  };

  var INVENTORY = {
    MAX_SLOTS: 20,
    ITEM_TYPES: {
      HEALTH_POTION: { name: '生命药水', heal: 30, rarity: 'common' },
      SPEED_BOOST: { name: '速度提升', duration: 5000, multiplier: 1.5, rarity: 'uncommon' },
      SHIELD: { name: '护盾', duration: 8000, absorb: 50, rarity: 'rare' },
      DAMAGE_BOOST: { name: '伤害增幅', duration: 10000, multiplier: 1.3, rarity: 'rare' }
    }
  };

  window.TokenWars = {
    EVENTS: EVENTS,
    AI_ARENA: AI_ARENA,
    COMBAT: COMBAT,
    MINING: MINING,
    INVENTORY: INVENTORY
  };
})();
