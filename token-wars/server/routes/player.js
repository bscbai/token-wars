const express = require('express');
const { verifySession } = require('./auth');

const router = express.Router();

// GET /api/player/profile
router.get('/profile', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No session token' });

  const player = verifySession(token);
  if (!player) return res.status(401).json({ error: 'Invalid session' });

  res.json({ player: player.serialize() });
});

module.exports = router;
