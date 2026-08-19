/**
 * Loader 内核单测（plugin-architecture M1 · tasks 2.2/2.4）
 *
 * 覆盖：
 *   - 拓扑排序：依赖先于消费者，同层保持 profile 声明顺序
 *   - fail fast：依赖缺失/成环点名报错；setup 失败逆序回滚已挂载者
 *   - Profile 组合：extends 链、disable（含被依赖时拒绝）、overrides 深合并
 *   - 环境变量层：TOKEN_WARS_DISABLE
 *   - mount/unload：setup 顺序、ctx.service 生效、依赖方在场时拒绝卸载
 *   - 真实 full profile 解析：10 插件、接缝依赖关系正确（不挂载，避免真实 manager 计时器）
 *   - dumpConfig 输出格式
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const { Context } = require('../server/core/Context');
const { Loader } = require('../server/core/Loader');

/** 构造测试用假插件（registry 注入） */
function fakePlugin(name, dependsOn = [], provides = [], setupImpl) {
  return {
    name,
    dependsOn,
    provides,
    setup: setupImpl || ((ctx) => { ctx.service(provides[0] || name, { name }); }),
  };
}

function registryOf(...plugins) {
  return new Map(plugins.map((p) => [p.name, p]));
}

function profileOf(plugins, extra = {}) {
  return { name: 'test', plugins, ...extra };
}

// --- 拓扑排序与 fail fast -----------------------------------------------------

describe('Loader resolve：拓扑排序', () => {
  it('依赖先于消费者挂载，同层保持声明顺序', () => {
    const registry = registryOf(
      fakePlugin('pve', ['combat', 'persistence']),
      fakePlugin('combat', ['persistence']),
      fakePlugin('persistence'),
      fakePlugin('mining', ['persistence']),
    );
    const loader = new Loader(null, { registry });
    // 故意把 pve 排在最前——拓扑排序必须纠正
    const resolved = loader.resolve(profileOf(['pve', 'mining', 'combat', 'persistence']));
    expect(resolved.plugins.map((p) => p.name)).toEqual(
      expect.arrayContaining(['persistence', 'combat', 'mining', 'pve'])
    );
    const idx = Object.fromEntries(resolved.plugins.map((p, i) => [p.name, i]));
    expect(idx.persistence).toBeLessThan(idx.combat);
    expect(idx.persistence).toBeLessThan(idx.mining);
    expect(idx.combat).toBeLessThan(idx.pve);
    expect(idx.persistence).toBeLessThan(idx.pve);
    // 同层（mining 与 combat 都只依赖 persistence）：mining 声明在前
    expect(idx.mining).toBeLessThan(idx.combat);
  });

  it('依赖未启用 → fail fast 并点名 依赖方→被依赖方', () => {
    const registry = registryOf(
      fakePlugin('pve', ['combat']),
      fakePlugin('combat'),
    );
    const loader = new Loader(null, { registry });
    expect(() => loader.resolve(profileOf(['pve']))).toThrow(/"pve".*"combat"/);
  });

  it('依赖成环 → 报错并列出环上插件', () => {
    const registry = registryOf(
      fakePlugin('a', ['b']),
      fakePlugin('b', ['a']),
    );
    const loader = new Loader(null, { registry });
    expect(() => loader.resolve(profileOf(['a', 'b']))).toThrow(/成环.*a, b/);
  });

  it('加载不存在的插件 → 报错', () => {
    const loader = new Loader(null, { registry: new Map() });
    expect(() => loader.resolve(profileOf(['ghost']))).toThrow(/无法加载插件 "ghost"/);
  });
});

// --- Profile 组合 ---------------------------------------------------------------

describe('Loader resolve：profile 分层组合', () => {
  function buildProfilesDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-profiles-'));
    fs.writeFileSync(path.join(dir, 'base.js'), `
      module.exports = {
        name: 'base',
        plugins: ['persistence', 'identity', 'combat', 'worldboss', 'aiarena'],
      };
    `);
    fs.writeFileSync(path.join(dir, 'derived.js'), `
      module.exports = {
        name: 'derived',
        extends: 'base',
        disable: ['worldboss', 'aiarena'],
        overrides: { mining: { offlineCapHours: 2 } },
        plugins: ['mining', 'pve'],
      };
    `);
    return dir;
  }

  it('extends 链：基座插件 + 派生新增，disable 生效，overrides 深合并', () => {
    const dir = buildProfilesDir();
    const registry = registryOf(
      fakePlugin('persistence'),
      fakePlugin('identity', ['persistence']),
      fakePlugin('combat', ['persistence']),
      fakePlugin('worldboss', ['combat']),
      fakePlugin('aiarena', ['combat']),
      fakePlugin('mining', ['persistence']),
      fakePlugin('pve', ['combat']),
    );
    const loader = new Loader(null, {
      registry,
      profilesRoot: dir,
    });
    const resolved = loader.resolve(loader.loadProfile('derived'));

    const names = resolved.plugins.map((p) => p.name);
    expect(names).toEqual(['persistence', 'identity', 'combat', 'mining', 'pve']);
    expect(resolved.disabled).toEqual(['worldboss', 'aiarena']);
    expect(resolved.plugins.find((p) => p.name === 'mining').cfg).toEqual({ offlineCapHours: 2 });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('disable 掉被依赖的插件 → fail fast', () => {
    const dir = buildProfilesDir();
    const registry = registryOf(
      fakePlugin('persistence'),
      fakePlugin('identity', ['persistence']),
      fakePlugin('combat', ['persistence']),
      fakePlugin('worldboss', ['combat']),
      fakePlugin('aiarena', ['combat']),
      fakePlugin('mining', ['persistence']),
      fakePlugin('pve', ['combat']),
    );
    const loader = new Loader(null, { registry, profilesRoot: dir });
    // 同时 disable combat 及其消费者，只剩 pve→combat 这一条缺失依赖链
    fs.writeFileSync(path.join(dir, 'break.js'), `
      module.exports = {
        name: 'break',
        extends: 'base',
        disable: ['combat', 'worldboss', 'aiarena'],
        plugins: ['pve'],
      };
    `);
    expect(() => loader.resolve(loader.loadProfile('break'))).toThrow(/"pve".*"combat"/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('overrides 深合并：标量覆盖、嵌套对象递归、数组整体替换', () => {
    const registry = registryOf({
      name: 'mining',
      dependsOn: [],
      provides: [],
      defaults: { a: 1, nested: { x: 1, y: 2 }, list: [1, 2] },
      setup() {},
    });
    // 插件 defaults 目前不由 Loader 合并（cfg 来自 profile），此处验证 profile 内
    // 多层 overrides 的合并语义：inline cfg + overrides 字段叠加
    const loader = new Loader(null, { registry });
    const resolved = loader.resolve({
      name: 't',
      plugins: [{ name: 'mining', cfg: { a: 1, nested: { x: 1, y: 2 }, list: [1, 2] } }],
      overrides: { mining: { a: 9, nested: { x: 8 } } },
    });
    expect(resolved.plugins[0].cfg).toEqual({ a: 9, nested: { x: 8, y: 2 }, list: [1, 2] });
  });

  it('环境变量层：TOKEN_WARS_DISABLE=worldboss（逗号分隔、容忍空格）', () => {
    const registry = registryOf(
      fakePlugin('persistence'),
      fakePlugin('worldboss'),
      fakePlugin('aiarena'),
    );
    const loader = new Loader(null, { registry });
    const resolved = loader.resolve(
      profileOf(['persistence', 'worldboss', 'aiarena']),
      { env: { TOKEN_WARS_DISABLE: ' worldboss ,aiarena' } }
    );
    expect(resolved.plugins.map((p) => p.name)).toEqual(['persistence']);
    expect(resolved.disabled).toEqual(['worldboss', 'aiarena']);
  });
});

// --- mount / unload ------------------------------------------------------------

describe('Loader mount / unload', () => {
  it('按拓扑序 setup，ctx.service 全部生效', () => {
    const ctx = new Context();
    const order = [];
    const registry = registryOf(
      fakePlugin('persistence', [], ['store'], (c) => { order.push('persistence'); c.service('store', {}); }),
      fakePlugin('combat', ['persistence'], [], (c) => { order.push('combat'); c.service('combat', {}); }),
      fakePlugin('pve', ['persistence', 'combat'], [], (c) => { order.push('pve'); c.service('pve', {}); }),
    );
    const loader = new Loader(ctx, { registry });
    loader.mountProfile(profileOf(['pve', 'combat', 'persistence']));
    expect(order).toEqual(['persistence', 'combat', 'pve']);
    expect(() => ctx.get('pve')).not.toThrow();
  });

  it('setup 失败 → 已挂载者逆序回滚（服务消失），错误上抛', () => {
    const ctx = new Context();
    const registry = registryOf(
      fakePlugin('persistence', [], ['store']),
      fakePlugin('combat', ['persistence'], [], (c) => { c.service('combat', {}); }),
      fakePlugin('pve', ['persistence', 'combat'], [], () => { throw new Error('boom'); }),
    );
    const loader = new Loader(ctx, { registry });
    expect(() => loader.mountProfile(profileOf(['persistence', 'combat', 'pve'])))
      .toThrow(/"pve" setup 失败: boom/);
    expect(() => ctx.get('store')).toThrow(/未注册/);
    expect(() => ctx.get('combat')).toThrow(/未注册/);
    expect(loader.mounted.size).toBe(0);
  });

  it('卸载被依赖的插件 → 拒绝；卸载叶子 → 服务与效应回滚', () => {
    const ctx = new Context();
    const listener = vi.fn();
    const registry = registryOf(
      fakePlugin('persistence', [], ['store']),
      fakePlugin('pve', ['persistence'], [], (c) => {
        c.service('pve', {});
        c.on('player:join', listener);
      }),
    );
    const loader = new Loader(ctx, { registry });
    loader.mountProfile(profileOf(['persistence', 'pve']));

    expect(() => loader.unload('persistence')).toThrow(/"pve" 仍依赖/);

    expect(loader.unload('pve')).toBe(true);
    expect(() => ctx.get('pve')).toThrow(/未注册/);
    ctx.emit('player:join', {});
    expect(listener).not.toHaveBeenCalled();

    expect(loader.unload('persistence')).toBe(true); // 依赖方已卸，现在允许
    expect(() => ctx.get('store')).toThrow(/未注册/);
  });

  it('插件的 setup 返回 dispose fn → unload 时被调用', () => {
    const ctx = new Context();
    const dispose = vi.fn();
    const registry = registryOf(
      fakePlugin('solo', [], [], () => dispose),
    );
    const loader = new Loader(ctx, { registry });
    loader.mountProfile(profileOf(['solo']));
    loader.unload('solo');
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});

// --- 真实 full profile（只 resolve，不挂载） -----------------------------------

describe('真实 full profile 解析', () => {
  it('10 个插件全部在列，接缝依赖关系正确', () => {
    const loader = new Loader(null); // 默认 pluginsRoot → server/plugins
    const resolved = loader.resolve(loader.loadProfile('full'));

    expect(resolved.plugins.map((p) => p.name)).toEqual([
      'persistence',
      'identity',
      'world-player',
      'combat',
      'mining',
      'pve',
      'pvp',
      'worldboss',
      'aiarena',
      'economy-shop',
    ]);

    const byName = Object.fromEntries(resolved.plugins.map((p) => [p.name, p]));
    expect(byName.identity.dependsOn).toContain('persistence');
    expect(byName['world-player'].dependsOn).toEqual(['persistence', 'identity']);
    expect(byName.pve.dependsOn).toEqual(['persistence', 'combat']);
    expect(byName.pvp.dependsOn).toEqual(['persistence', 'combat']);
    expect(byName.worldboss.dependsOn).toEqual(['persistence', 'combat']);
    expect(byName.aiarena.dependsOn).toEqual(['persistence', 'combat']);
    expect(byName['economy-shop'].dependsOn).toEqual(['persistence', 'identity']);
    expect(resolved.disabled).toEqual([]);
  });

  it('dumpConfig 输出包含插件名、依赖与 disabled 列表', () => {
    const loader = new Loader(null);
    const resolved = loader.resolve(loader.loadProfile('full'));
    const dump = loader.dumpConfig(resolved);
    expect(dump).toContain('profile: full');
    expect(dump).toContain('10 plugins');
    expect(dump).toContain('persistence');
    expect(dump).toContain('dependsOn: persistence, identity');
    expect(dump).toContain('disabled: (none)');
  });
});
