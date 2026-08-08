const express = require('express');
const logger = require('../utils/logger');

function makePlayerRouter({ store, verifySession }) {
  const router = express.Router();

  // GET /api/player/profile
  router.get('/profile', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No session token' });

    const player = verifySession(token);
    if (!player) return res.status(401).json({ error: 'Invalid session' });

    res.json({ player: player.serialize() });
  });

  // POST /api/player/claim-daily
  router.post('/claim-daily', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No session token' });

    const player = verifySession(token);
    if (!player) return res.status(401).json({ error: 'Invalid session' });

    // Check if already claimed today
    const today = new Date().toDateString();
    if (player.lastDailyClaim === today) {
      return res.status(400).json({ error: '今日已领取' });
    }

    const amount = 50;
    player.credits += amount;
    player.lastDailyClaim = today;

    // Transaction point: the claim is once-per-day, losing it on a crash would
    // either rob the player or let them double-claim.
    const persisted = store.persist(player);
    logger.info({ playerId: player.id, amount, persisted }, '[Player] Daily claimed');

    res.json({ amount, player: player.serialize() });
  });

  return router;
}

module.exports = { makePlayerRouter };
