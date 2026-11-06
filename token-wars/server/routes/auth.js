const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Player = require('../models/Player');
const logger = require('../utils/logger');
const config = require('../config');

function makeAuth({ store, cfg = config } = {}) {
  function createToken(player) {
    return jwt.sign({ pid: player.id }, cfg.JWT_SECRET, { expiresIn: cfg.JWT_EXPIRES });
  }

  // Verify a JWT session token -> Player (or null if invalid/banned).
  function verifySession(token) {
    if (!token) return null;
    try {
      const decoded = jwt.verify(token, cfg.JWT_SECRET);
      const player = store.getPlayerById(decoded.pid);
      if (!player || player.banned) return null;
      return player;
    } catch (_) {
      return null;
    }
  }

  const router = express.Router();

  router.post('/register', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    if (username.length < 2 || username.length > 16) {
      return res.status(400).json({ error: 'Username must be 2-16 characters' });
    }
    if (password.length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters' });
    }
    if (store.getPlayerByUsername(username)) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    const player = new Player(username);
    player.passwordHash = bcrypt.hashSync(password, 10);
    store.addPlayer(player);

    logger.info({ playerId: player.id, username }, '[Auth] Registered');
    res.json({ sessionToken: createToken(player), player: player.serialize() });
  });

  router.post('/login', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const player = store.getPlayerByUsername(username);
    if (!player) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    if (player.banned) {
      return res.status(403).json({ error: 'Account banned' });
    }
    if (!bcrypt.compareSync(password, player.passwordHash)) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    player.lastLoginAt = Date.now();
    store.savePlayer(player);

    logger.info({ playerId: player.id, username }, '[Auth] Login');
    res.json({ sessionToken: createToken(player), player: player.serialize() });
  });

  return { router, verifySession, createToken };
}

// No default instance is built at import time — that would require the Store
// singleton and open the production database as an import side effect.
// Callers build their router explicitly: makeAuth({ store }).
module.exports = { makeAuth };
