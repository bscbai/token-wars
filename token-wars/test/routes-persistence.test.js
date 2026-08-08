const path = require('path');
const os = require('os');
const fs = require('fs');
const express = require('express');
const request = require('supertest');
const { DatabaseSync } = require('node:sqlite');
const { Store } = require('../server/data/Store');
const { makeAuth } = require('../server/routes/auth');
const { makeShopRouter } = require('../server/routes/shop');
const { makePlayerRouter } = require('../server/routes/player');
const { SHOP_PACKS } = require('../shared/constants');

const CFG = { JWT_SECRET: 'test-secret', JWT_EXPIRES: '1h' };

// The "starter" pack is free (price 0), so it can't exercise the credit check.
const PAID_PACK_ID = Object.keys(SHOP_PACKS).find((id) => SHOP_PACKS[id].price > 0);

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-routes-'));
  return { dir, dbPath: path.join(dir, 'r.db') };
}

// Read straight from disk with a separate connection — this is what a restarted
// process would see, so it proves the write actually landed.
function readFromDisk(dbPath, id) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db.prepare('SELECT data FROM players WHERE id = ?').get(id);
    return row ? JSON.parse(row.data) : null;
  } finally {
    db.close();
  }
}

describe('Route write-through persistence (S1)', () => {
  let store, ctx, app, auth, token, player;

  beforeEach(async () => {
    ctx = tmpDb();
    store = new Store(ctx.dbPath, { migrate: false });
    auth = makeAuth({ store, cfg: CFG });

    app = express();
    app.use(express.json());
    app.use('/api/auth', auth.router);
    app.use('/api/shop', makeShopRouter({ store, verifySession: auth.verifySession }));
    app.use('/api/player', makePlayerRouter({ store, verifySession: auth.verifySession }));

    const res = await request(app).post('/api/auth/register').send({ username: 'buyer', password: 'pass1234' });
    token = res.body.sessionToken;
    player = store.getPlayerByUsername('buyer');
  });

  afterEach(() => {
    store.close();
    fs.rmSync(ctx.dir, { recursive: true, force: true });
  });

  it('a shop purchase is on disk before the response returns', async () => {
    const packId = PAID_PACK_ID;
    const pack = SHOP_PACKS[packId];
    player.credits = pack.price + 1000;
    store.savePlayer(player);

    const res = await request(app)
      .post('/api/shop/buy')
      .set('Authorization', `Bearer ${token}`)
      .send({ packId });

    expect(res.status).toBe(200);

    const onDisk = readFromDisk(ctx.dbPath, player.id);
    expect(onDisk.purchasedPacks[packId]).toBe(1);
    expect(onDisk.credits).toBe(player.credits);
    expect(onDisk.unstableTokens).toBe(player.unstableTokens);
    expect(onDisk.stableTokens.length).toBe(player.stableTokens.length);
    // nothing left pending — it was a write-through, not a dirty mark
    expect(store.dirty.has(player.id)).toBe(false);
  });

  it('a daily claim is on disk before the response returns', async () => {
    const creditsBefore = player.credits;

    const res = await request(app)
      .post('/api/player/claim-daily')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(200);

    const onDisk = readFromDisk(ctx.dbPath, player.id);
    expect(onDisk.credits).toBe(creditsBefore + 50);
    expect(onDisk.lastDailyClaim).toBe(new Date().toDateString());
  });

  it('a rejected purchase (insufficient credits) writes nothing', async () => {
    const packId = PAID_PACK_ID;
    player.credits = 0;
    store.savePlayer(player);

    const res = await request(app)
      .post('/api/shop/buy')
      .set('Authorization', `Bearer ${token}`)
      .send({ packId });

    expect(res.status).toBe(400);
    const onDisk = readFromDisk(ctx.dbPath, player.id);
    expect(onDisk.credits).toBe(0);
    expect(onDisk.purchasedPacks[packId]).toBeUndefined();
  });
});
