const express = require('express');
const logger = require('../utils/logger');
const { SHOP_PACKS, RARITY_CONFIG, rollRarity, COPROCESSOR_IDS } = require('../../shared/constants');

function makeShopRouter({ store, verifySession }) {
  const router = express.Router();

  // GET /api/shop/packs
  router.get('/packs', (req, res) => {
    const packs = Object.values(SHOP_PACKS).map(p => ({
      id: p.id,
      name: p.name,
      price: p.price,
      oneTime: p.oneTime || false,
      contents: {
        unstable: p.contents.unstable || 0,
        stableCount: p.contents.stable ? p.contents.stable.reduce((sum, s) => sum + s.count, 0) : 0,
        coprocessor: p.contents.coprocessor || false,
      },
    }));
    res.json({ packs });
  });

  // POST /api/shop/buy
  router.post('/buy', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No session token' });

    const player = verifySession(token);
    if (!player) return res.status(401).json({ error: 'Invalid session' });

    const { packId } = req.body;
    const pack = SHOP_PACKS[packId];
    if (!pack) return res.status(404).json({ error: 'Pack not found' });

    // Check one-time purchase
    if (pack.oneTime && player.purchasedPacks[packId]) {
      return res.status(400).json({ error: 'Already purchased' });
    }

    // Check credits
    if (!player.spendCredits(pack.price)) {
      return res.status(400).json({ error: 'Insufficient credits' });
    }

    // Apply contents
    const received = { unstable: 0, stable: [], coprocessor: false };

    if (pack.contents.unstable) {
      player.addUnstableTokens(pack.contents.unstable);
      received.unstable = pack.contents.unstable;
    }

    if (pack.contents.stable) {
      for (const stableDef of pack.contents.stable) {
        for (let i = 0; i < stableDef.count; i++) {
          const token = player.addStableToken(stableDef.rarity);
          received.stable.push(token);
        }
      }
    }

    if (pack.contents.coprocessor) {
      // GDD §3: 礼包赠送 1 个协处理器。优先未拥有（收集推进）；全拥有时
      // addCoprocessor 自动折碎片（COPROCESSOR_SHOP.DUPLICATE_FRAGMENTS）。
      const owned = new Set(player.coprocessors.map(c => c.id));
      const unowned = COPROCESSOR_IDS.filter(id => !owned.has(id));
      const pool = unowned.length > 0 ? unowned : COPROCESSOR_IDS;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      const grant = player.addCoprocessor(pick);
      received.coprocessor = { id: pick, status: grant.status };
    }

    // Track purchase
    player.purchasedPacks[packId] = (player.purchasedPacks[packId] || 0) + 1;

    // Transaction point: credits were spent, so the grant must survive a crash.
    const persisted = store.persist(player);
    logger.info({ playerId: player.id, packId, persisted }, '[Shop] Pack purchased');

    res.json({
      packId,
      received,
      player: player.serialize(),
    });
  });

  return router;
}

module.exports = { makeShopRouter };
