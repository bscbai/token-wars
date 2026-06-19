// NetworkManager — Socket.IO client singleton
class NetworkManager {
  constructor() {
    this.socket = null;
    this.sessionToken = null;
    this.playerId = null;
    this.listeners = new Map();
  }

  connect() {
    if (this.socket) return;

    this.socket = io();

    this.socket.on('connect', () => {
      console.log('[Net] Connected to server');
      if (this.sessionToken) {
        this.socket.emit('auth:login', { token: this.sessionToken });
      }
    });

    this.socket.on('disconnect', () => {
      console.log('[Net] Disconnected');
    });

    const allEvents = [
      'auth:success', 'auth:fail',
      'player:update', 'player:dead', 'player:respawn',
      'state:sync',
      'combat:hit', 'combat:death', 'combat:miss', 'combat:shield',
      'projectile:spawn', 'projectile:hit', 'projectile:destroy',
      'mining:update', 'mining:collected', 'mining:upgraded',
      'dungeon:start', 'dungeon:room_clear', 'dungeon:boss_phase', 'dungeon:complete', 'dungeon:fail',
      'pvp:matched', 'pvp:round_start', 'pvp:round_end', 'pvp:match_end', 'pvp:last_stand',
      'world_boss:announce', 'world_boss:update', 'world_boss:end',
      'shop:purchased',
      'inventory:update', 'skill_disk:update',
      'ai_arena:agent_list', 'ai_arena:deployed', 'ai_arena:recalled',
      'ai_arena:queue_fail', 'ai_arena:match_result',
      'ai_arena:replay', 'ai_arena:leaderboard',
      'ai_arena:behavior_set', 'ai_arena:agent_named',
      'ai_arena:match_history',
      'ai_arena:tournament_state', 'ai_arena:tournament_start',
      'ai_arena:tournament_match', 'ai_arena:tournament_round',
      'ai_arena:tournament_end',
      'ai_arena:season_info', 'ai_arena:season_update',
      'error', 'pong',
    ];

    for (const event of allEvents) {
      this.socket.on(event, (data) => {
        const callbacks = this.listeners.get(event);
        if (callbacks) {
          for (const cb of callbacks) {
            try { cb(data); } catch (e) { console.error('[Net] callback error for ' + event + ':', e.message); }
          }
        }
      });
    }
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
  }

  off(event, callback) {
    const callbacks = this.listeners.get(event);
    if (callbacks) callbacks.delete(callback);
  }

  emit(event, data) {
    if (this.socket && this.socket.connected) {
      this.socket.emit(event, data);
    }
  }

  setSession(token, playerId) {
    this.sessionToken = token;
    this.playerId = playerId;
  }

  isAuthenticated() {
    return !!this.sessionToken;
  }
}

const net = new NetworkManager();
export default net;
