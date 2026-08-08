const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const config = require('../config');

const PLAYERS_JSON = path.join(__dirname, 'players.json');

const UPSERT_SQL = `INSERT INTO players (id, username, password_hash, data, created_at, last_login_at)
   VALUES (?, ?, ?, ?, ?, ?)
   ON CONFLICT(id) DO UPDATE SET
     username = excluded.username,
     password_hash = excluded.password_hash,
     data = excluded.data,
     last_login_at = excluded.last_login_at`;

class Store {
  constructor(dbPath = config.DB_PATH, { migrate = true } = {}) {
    this.dbPath = dbPath;
    this.migrate = migrate;
    this.players = new Map(); // id -> Player
    this.playersByUsername = new Map(); // username -> Player
    this.dirty = new Set(); // player ids pending a write (flushed by autosave)
    this.saveInterval = null;
    this.closed = false;
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE,
        password_hash TEXT,
        data TEXT NOT NULL,
        created_at INTEGER,
        last_login_at INTEGER
      );
    `);
    this._upsertStmt = null; // prepared lazily, reused (no per-write allocation)
  }

  get isOpen() {
    return !this.closed && !!this.db && this.db.isOpen !== false;
  }

  _migrateFromJsonIfNeeded() {
    if (!this.migrate) return;
    try {
      const row = this.db.prepare('SELECT COUNT(*) AS c FROM players').get();
      if (row && row.c > 0) return;
      if (!fs.existsSync(PLAYERS_JSON)) return;
      const data = JSON.parse(fs.readFileSync(PLAYERS_JSON, 'utf-8'));
      if (!Array.isArray(data) || data.length === 0) return;

      const stmt = this.db.prepare(
        'INSERT OR IGNORE INTO players (id, username, password_hash, data, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?)'
      );
      this.db.exec('BEGIN');
      for (const p of data) {
        stmt.run(p.id, p.username, p.passwordHash || '', JSON.stringify(p), p.createdAt || 0, p.lastLoginAt || 0);
      }
      this.db.exec('COMMIT');

      fs.renameSync(PLAYERS_JSON, PLAYERS_JSON + '.bak');
      logger.info({ migrated: data.length }, '[Store] Migrated players.json -> SQLite (original backed up to .bak)');
    } catch (err) {
      try { this.db.exec('ROLLBACK'); } catch (_) {}
      logger.error({ err: err.message }, '[Store] Migration from players.json failed');
    }
  }

  load() {
    this._migrateFromJsonIfNeeded();
    const Player = require('../models/Player'); // lazy to avoid circular require
    const rows = this.db.prepare('SELECT data FROM players').all();
    for (const row of rows) {
      try {
        const data = JSON.parse(row.data);
        const player = Player.fromSave(data);
        this.players.set(player.id, player);
        this.playersByUsername.set(player.username, player);
      } catch (err) {
        logger.error({ err: err.message }, '[Store] Failed to parse player row');
      }
    }
    logger.info({ count: this.players.size }, '[Store] Loaded players');
  }

  // --- write path ---------------------------------------------------------

  _writePlayer(player) {
    if (!this._upsertStmt) this._upsertStmt = this.db.prepare(UPSERT_SQL);
    const data = JSON.stringify(player.toSave());
    this._upsertStmt.run(
      player.id,
      player.username,
      player.passwordHash || '',
      data,
      player.createdAt || 0,
      player.lastLoginAt || 0
    );
  }

  /**
   * Mark a player as having unsaved changes. Cheap (Set.add) — safe on hot paths.
   * The next autosave flush writes it inside a single transaction.
   */
  markDirty(player) {
    if (player && player.id) this.dirty.add(player.id);
    return player;
  }

  /** Immediate write-through of a single player. Clears its dirty flag. */
  savePlayer(player) {
    if (!player || !this.isOpen) return;
    this._writePlayer(player);
    this.dirty.delete(player.id);
  }

  /**
   * Write-through used at transaction points (purchase, reward, settlement).
   * On failure the player is queued as dirty so the next autosave retries —
   * an I/O error must never silently drop granted items.
   */
  persist(player) {
    if (!player) return false;
    try {
      this.savePlayer(player);
      return true;
    } catch (err) {
      this.markDirty(player);
      logger.error(
        { err: err.message, playerId: player.id },
        '[Store] persist failed; player queued for next autosave'
      );
      return false;
    }
  }

  /** Flush only dirty players, wrapped in one transaction. Used by autosave. */
  flushDirty() {
    if (!this.isOpen || this.dirty.size === 0) return 0;
    const ids = Array.from(this.dirty);
    let written = 0;
    this.db.exec('BEGIN');
    try {
      for (const id of ids) {
        const player = this.players.get(id);
        if (!player) continue; // player gone — dropped from the dirty set below
        this._writePlayer(player);
        written++;
      }
      this.db.exec('COMMIT');
    } catch (err) {
      try { this.db.exec('ROLLBACK'); } catch (_) {}
      logger.error({ err: err.message, pending: ids.length }, '[Store] flushDirty failed; keeping dirty set for retry');
      return 0;
    }
    // Only clear after a successful COMMIT so a failed flush is retried.
    for (const id of ids) this.dirty.delete(id);
    return written;
  }

  /** Full flush of every in-memory player, in one transaction. Used on shutdown. */
  save() {
    if (!this.isOpen) return 0;
    const players = Array.from(this.players.values());
    if (players.length === 0) {
      this.dirty.clear();
      return 0;
    }
    this.db.exec('BEGIN');
    try {
      for (const player of players) this._writePlayer(player);
      this.db.exec('COMMIT');
    } catch (err) {
      try { this.db.exec('ROLLBACK'); } catch (_) {}
      logger.error({ err: err.message, count: players.length }, '[Store] save failed');
      return 0;
    }
    this.dirty.clear();
    return players.length;
  }

  startAutoSave(intervalMs = 60000) {
    this.stopAutoSave();
    this.saveInterval = setInterval(() => {
      try {
        const n = this.flushDirty();
        if (n > 0) logger.debug({ count: n }, '[Store] autosave flushed dirty players');
      } catch (err) {
        logger.error({ err: err.message }, '[Store] autosave failed');
      }
    }, intervalMs);
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
    this.savePlayer(player);
  }

  getPlayerById(id) {
    return this.players.get(id) || null;
  }

  getPlayerByUsername(username) {
    return this.playersByUsername.get(username) || null;
  }

  /** Fold the WAL back into the main db file and truncate it to 0 bytes. */
  checkpoint() {
    if (!this.isOpen) return false;
    try {
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
      return true;
    } catch (err) {
      logger.error({ err: err.message }, '[Store] WAL checkpoint failed');
      return false;
    }
  }

  close() {
    if (this.closed) return;
    this.stopAutoSave();
    try {
      const n = this.save();
      logger.info({ count: n }, '[Store] Final save on close');
    } catch (err) {
      logger.error({ err: err.message }, '[Store] save on close failed');
    }
    this.checkpoint();
    this.closed = true;
    try { this.db.close(); } catch (_) {}
  }
}

// --- lazy singleton --------------------------------------------------------
// No instance is created at import time: requiring this module must never open
// (or create) a database file. Callers opt in explicitly via getStore().

let instance = null;

function getStore() {
  if (instance && !instance.closed) return instance;
  // Tests default to an in-memory db so they can never touch real data.
  const isTest = process.env.NODE_ENV === 'test';
  instance = new Store(isTest ? ':memory:' : config.DB_PATH, { migrate: !isTest });
  return instance;
}

function closeStore() {
  if (!instance) return;
  instance.close();
  instance = null;
}

module.exports = { Store, getStore, closeStore };
