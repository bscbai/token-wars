const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const Player = require('../models/Player');
const store = require('../data/Store');

const router = express.Router();

// Session tokens (in-memory)
const sessions = new Map(); // sessionToken -> playerId

// POST /api/auth/register
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

  const sessionToken = uuidv4();
  sessions.set(sessionToken, player.id);

  res.json({ sessionToken, player: player.serialize() });
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const player = store.getPlayerByUsername(username);
  if (!player) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  if (!bcrypt.compareSync(password, player.passwordHash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  player.lastLoginAt = Date.now();

  const sessionToken = uuidv4();
  sessions.set(sessionToken, player.id);

  res.json({ sessionToken, player: player.serialize() });
});

// Verify session token (used by socket connections)
function verifySession(token) {
  const playerId = sessions.get(token);
  if (!playerId) return null;
  return store.getPlayerById(playerId);
}

module.exports = { router, verifySession };
