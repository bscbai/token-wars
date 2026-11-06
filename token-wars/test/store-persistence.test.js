const path = require('path');
const os = require('os');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const { Store, getStore, closeStore } = require('../server/data/Store');
const Player = require('../server/models/Player');

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-persist-'));
  return { dir, dbPath: path.join(dir, 'p.db') };
}

function readPlayerRow(dbPath, id) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db.prepare('SELECT data FROM players WHERE id = ?').get(id);
    return row ? JSON.parse(row.data) : null;
  } finally {
    db.close();
  }
}

describe('Store dirty tracking + transactional autosave', () => {
  let store, ctx;

  beforeEach(() => {
    ctx = tmpDb();
    store = new Store(ctx.dbPath, { migrate: false });
  });

  afterEach(() => {
    store.close();
    fs.rmSync(ctx.dir, { recursive: true, force: true });
  });

  it('markDirty queues a player and flushDirty writes only that player', () => {
    const a = new Player('alice');
    const b = new Player('bob');
    store.addPlayer(a); // addPlayer writes through immediately
    store.addPlayer(b);
    expect(store.dirty.size).toBe(0);

    a.credits = 777;
    b.credits = 888;
    store.markDirty(a);

    expect(store.dirty.size).toBe(1);
    const written = store.flushDirty();
    expect(written).toBe(1);
    expect(store.dirty.size).toBe(0);

    expect(readPlayerRow(ctx.dbPath, a.id).credits).toBe(777);
    // b was never marked dirty, so its change is still only in memory
    expect(readPlayerRow(ctx.dbPath, b.id).credits).not.toBe(888);
  });

  it('flushDirty is a no-op when nothing is dirty', () => {
    store.addPlayer(new Player('idle'));
    expect(store.flushDirty()).toBe(0);
  });

  it('savePlayer clears the dirty flag', () => {
    const p = new Player('carol');
    store.addPlayer(p);
    p.credits = 123;
    store.markDirty(p);
    expect(store.dirty.has(p.id)).toBe(true);

    store.savePlayer(p);

    expect(store.dirty.has(p.id)).toBe(false);
    expect(readPlayerRow(ctx.dbPath, p.id).credits).toBe(123);
  });

  it('persist() write-through survives immediately (no autosave needed)', () => {
    const p = new Player('dave');
    store.addPlayer(p);
    p.unstableTokens = 42;

    expect(store.persist(p)).toBe(true);
    expect(readPlayerRow(ctx.dbPath, p.id).unstableTokens).toBe(42);
  });

  it('persist() falls back to the dirty set when the write fails', () => {
    const p = new Player('erin');
    store.addPlayer(p);
    // Force a write failure
    store._writePlayer = () => { throw new Error('disk on fire'); };

    expect(store.persist(p)).toBe(false);
    expect(store.dirty.has(p.id)).toBe(true);
  });

  it('autosave flushes dirty players on its interval', async () => {
    const p = new Player('frank');
    store.addPlayer(p);
    p.credits = 4242;
    store.markDirty(p);

    store.startAutoSave(20);
    await new Promise((r) => setTimeout(r, 120));
    store.stopAutoSave();

    expect(store.dirty.size).toBe(0);
    expect(readPlayerRow(ctx.dbPath, p.id).credits).toBe(4242);
  });

  it('save() full-flushes every player and clears the dirty set', () => {
    const a = new Player('gina');
    const b = new Player('hank');
    store.addPlayer(a);
    store.addPlayer(b);
    a.credits = 11;
    b.credits = 22;
    store.markDirty(a);

    expect(store.save()).toBe(2);
    expect(store.dirty.size).toBe(0);
    expect(readPlayerRow(ctx.dbPath, a.id).credits).toBe(11);
    expect(readPlayerRow(ctx.dbPath, b.id).credits).toBe(22);
  });
});

describe('Store close() checkpoints the WAL', () => {
  it('leaves no non-empty -wal file behind after close', () => {
    const ctx = tmpDb();
    const store = new Store(ctx.dbPath, { migrate: false });
    for (let i = 0; i < 25; i++) {
      const p = new Player(`bulk${i}`);
      p.credits = i;
      store.addPlayer(p);
    }
    store.save();

    const walPath = ctx.dbPath + '-wal';
    // WAL should be carrying data before the checkpoint
    expect(fs.existsSync(walPath)).toBe(true);
    expect(fs.statSync(walPath).size).toBeGreaterThan(0);

    store.close();

    const walSizeAfter = fs.existsSync(walPath) ? fs.statSync(walPath).size : 0;
    expect(walSizeAfter).toBe(0);

    fs.rmSync(ctx.dir, { recursive: true, force: true });
  });
});

describe('Store module has no import side effects', () => {
  it('does not create a database file just by being required', () => {
    // Simulate a fresh require of the module graph.
    const modPath = require.resolve('../server/data/Store');
    delete require.cache[modPath];
    const dataDir = path.join(__dirname, '..', 'server', 'data');
    const before = fs.readdirSync(dataDir);

    const mod = require('../server/data/Store');

    const after = fs.readdirSync(dataDir);
    expect(after).toEqual(before);
    expect(typeof mod.getStore).toBe('function');
    expect(typeof mod.Store).toBe('function');
    expect(mod.getStore.length).toBe(0);
  });

  it('getStore() returns a stable singleton and uses :memory: under NODE_ENV=test', () => {
    const s1 = getStore();
    const s2 = getStore();
    // NB: compare identity as a boolean — expect(obj).toBe(obj) makes vitest
    // deep-walk the Store, which touches handles on an already-closed sqlite db.
    expect(s1 === s2).toBe(true);
    expect(s1.dbPath).toBe(':memory:');
    expect(s1.isOpen).toBe(true);

    closeStore();
    expect(s1.isOpen).toBe(false);

    // after closeStore a fresh instance is handed out
    const s3 = getStore();
    expect(s3 === s1).toBe(false);
    expect(s3.isOpen).toBe(true);
    closeStore();
  });
});

describe('Route modules have no import side effects', () => {
  it('requiring auth/player/shop routers creates no db files', () => {
    const dataDir = path.join(__dirname, '..', 'server', 'data');
    const before = fs.readdirSync(dataDir);

    for (const rel of ['../server/routes/auth', '../server/routes/player', '../server/routes/shop']) {
      delete require.cache[require.resolve(rel)];
      require(rel);
    }

    expect(fs.readdirSync(dataDir)).toEqual(before);
    expect(typeof require('../server/routes/auth').makeAuth).toBe('function');
    expect(typeof require('../server/routes/player').makePlayerRouter).toBe('function');
    expect(typeof require('../server/routes/shop').makeShopRouter).toBe('function');
  });
});
