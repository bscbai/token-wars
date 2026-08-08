const path = require('path');
const os = require('os');
const fs = require('fs');
const express = require('express');
const request = require('supertest');
const { Store } = require('../server/data/Store');
const { makeAuth } = require('../server/routes/auth');

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-auth-'));
  return { dir, dbPath: path.join(dir, 'a.db') };
}

function buildApp(store) {
  const { router } = makeAuth({
    store,
    cfg: { JWT_SECRET: 'test-secret', JWT_EXPIRES: '1h' },
  });
  const app = express();
  app.use(express.json());
  app.use('/api/auth', router);
  return app;
}

describe('Auth (JWT)', () => {
  let store, ctx, app, auth;

  beforeEach(() => {
    ctx = tmpDb();
    store = new Store(ctx.dbPath, { migrate: false });
    auth = makeAuth({ store, cfg: { JWT_SECRET: 'test-secret', JWT_EXPIRES: '1h' } });
    app = buildApp(store);
  });

  afterEach(() => {
    store.close();
    fs.rmSync(ctx.dir, { recursive: true, force: true });
  });

  it('register returns a JWT + player', async () => {
    const res = await request(app).post('/api/auth/register').send({ username: 'alice', password: 'pass1234' });
    expect(res.status).toBe(200);
    expect(res.body.sessionToken).toEqual(expect.any(String));
    expect(res.body.player.username).toBe('alice');
    // JWT has three dot-separated parts
    expect(res.body.sessionToken.split('.')).toHaveLength(3);
  });

  it('rejects duplicate username', async () => {
    await request(app).post('/api/auth/register').send({ username: 'alice', password: 'pass1234' });
    const res = await request(app).post('/api/auth/register').send({ username: 'alice', password: 'pass1234' });
    expect(res.status).toBe(409);
  });

  it('login with valid credentials returns a token', async () => {
    await request(app).post('/api/auth/register').send({ username: 'bob', password: 'pass1234' });
    const res = await request(app).post('/api/auth/login').send({ username: 'bob', password: 'pass1234' });
    expect(res.status).toBe(200);
    expect(res.body.sessionToken).toEqual(expect.any(String));
  });

  it('login with wrong password fails', async () => {
    await request(app).post('/api/auth/register').send({ username: 'bob', password: 'pass1234' });
    const res = await request(app).post('/api/auth/login').send({ username: 'bob', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('verifySession resolves a valid token to the player', () => {
    const Player = require('../server/models/Player');
    const player = new Player('eve');
    store.addPlayer(player);
    const token = auth.createToken(player);
    expect(auth.verifySession(token)).toBe(player);
  });

  it('verifySession rejects a malformed token', () => {
    expect(auth.verifySession('not-a-jwt')).toBeNull();
    expect(auth.verifySession(null)).toBeNull();
  });

  it('verifySession rejects a banned player', () => {
    const Player = require('../server/models/Player');
    const player = new Player('mallory');
    store.addPlayer(player);
    const token = auth.createToken(player);
    expect(auth.verifySession(token)).toBe(player);
    player.banned = true;
    expect(auth.verifySession(token)).toBeNull();
  });

  it('login is rejected for a banned account', async () => {
    await request(app).post('/api/auth/register').send({ username: 'mallory', password: 'pass1234' });
    const player = store.getPlayerByUsername('mallory');
    player.banned = true;
    store.savePlayer(player);
    const res = await request(app).post('/api/auth/login').send({ username: 'mallory', password: 'pass1234' });
    expect(res.status).toBe(403);
  });
});
