const path = require('path');
const os = require('os');
const fs = require('fs');
const { Store } = require('../server/data/Store');
const Player = require('../server/models/Player');

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-store-'));
  return { dir, dbPath: path.join(dir, 'test.db') };
}

describe('Store (SQLite)', () => {
  let store, ctx;

  beforeEach(() => {
    ctx = tmpDb();
    store = new Store(ctx.dbPath, { migrate: false });
  });

  afterEach(() => {
    store.close();
    fs.rmSync(ctx.dir, { recursive: true, force: true });
  });

  it('addPlayer + lookups', () => {
    const p = new Player('alice');
    store.addPlayer(p);
    expect(store.getPlayerById(p.id)).toBe(p);
    expect(store.getPlayerByUsername('alice')).toBe(p);
  });

  it('returns null for unknown id/username', () => {
    expect(store.getPlayerById('nope')).toBeNull();
    expect(store.getPlayerByUsername('nope')).toBeNull();
  });

  it('persists across instances via load()', () => {
    const p = new Player('bob');
    p.credits = 999;
    store.addPlayer(p);
    store.save();
    store.close();

    const store2 = new Store(ctx.dbPath, { migrate: false });
    store2.load();
    const loaded = store2.getPlayerByUsername('bob');
    expect(loaded).toBeTruthy();
    expect(loaded.id).toBe(p.id);
    expect(loaded.credits).toBe(999);
    store2.close();
  });

  it('save() upserts existing player', () => {
    const p = new Player('carol');
    store.addPlayer(p);
    p.credits = 500;
    store.save();
    store.close();

    const s2 = new Store(ctx.dbPath, { migrate: false });
    s2.load();
    expect(s2.getPlayerByUsername('carol').credits).toBe(500);
    s2.close();
  });

  it('banned flag persists', () => {
    const p = new Player('dan');
    store.addPlayer(p);
    p.banned = true;
    store.save();
    store.close();

    const s2 = new Store(ctx.dbPath, { migrate: false });
    s2.load();
    expect(s2.getPlayerByUsername('dan').banned).toBe(true);
    s2.close();
  });
});
