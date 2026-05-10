const fs = require('fs');
const path = require('path');
const Player = require('../models/Player');

const DATA_DIR = path.join(__dirname);
const PLAYERS_FILE = path.join(DATA_DIR, 'players.json');

class Store {
  constructor() {
    this.players = new Map(); // id -> Player
    this.playersByUsername = new Map(); // username -> Player
    this.saveInterval = null;
  }

  load() {
    try {
      if (fs.existsSync(PLAYERS_FILE)) {
        const data = JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf-8'));
        for (const playerData of data) {
          const player = Player.fromSave(playerData);
          this.players.set(player.id, player);
          this.playersByUsername.set(player.username, player);
        }
        console.log(`[Store] Loaded ${this.players.size} players`);
      }
    } catch (err) {
      console.error('[Store] Failed to load players:', err.message);
    }
  }

  save() {
    try {
      const data = Array.from(this.players.values()).map(p => p.toSave());
      fs.writeFileSync(PLAYERS_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[Store] Failed to save players:', err.message);
    }
  }

  startAutoSave(intervalMs = 60000) {
    this.saveInterval = setInterval(() => this.save(), intervalMs);
  }

  stopAutoSave() {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
      this.saveInterval = null;
    }
  }

  addPlayer(player) {
    this.players.set(player.id, player);
    this.playersByUsername.set(player.username, player);
  }

  getPlayerById(id) {
    return this.players.get(id);
  }

  getPlayerByUsername(username) {
    return this.playersByUsername.get(username);
  }
}

// Singleton
const store = new Store();
module.exports = store;
