/**
 * Loader — Profile 组合与插件挂载（plugin-architecture M1）
 *
 * 对应 dsh 的 app-boot 分层组合：
 *   基座 profile → 派生 profile（extends/disable/overrides）
 *   → 环境变量覆盖（TOKEN_WARS_DISABLE）→ CLI（--profile / --dump-config）
 *
 * 职责：
 *   1. resolve()：解析 extends 链 → 汇总插件表 → 应用 disable/overrides/
 *      env 覆盖 → dependsOn 校验（缺失 fail fast）→ 稳定拓扑排序
 *   2. mountProfile()：按序 setup(ctx, cfg)；任一失败则逆序回滚已挂载者
 *   3. unload(name)：有依赖者时拒绝；否则回滚该插件全部效应
 *   4. dumpConfig()：打印最终组合树（--dump-config 排障/测试断言用）
 */

'use strict';

const path = require('path');

/** 深合并：plain object 递归合并，数组与标量整体覆盖；over 优先。 */
function deepMerge(base, over) {
  if (over === undefined) return base;
  const isPlain = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
  if (!isPlain(base) || !isPlain(over)) return over;
  const out = { ...base };
  for (const key of Object.keys(over)) {
    out[key] = deepMerge(base[key], over[key]);
  }
  return out;
}

class Loader {
  /**
   * @param {import('./Context').Context|null} ctx 传 null 表示仅做 resolve
   *        （--dump-config 模式，不挂载）
   * @param {{pluginsRoot?:string, profilesRoot?:string, registry?:Map}} opts
   *        registry：测试注入 name → 插件模块；默认按 plugins/<name>/index.js 约定加载
   */
  constructor(ctx, opts = {}) {
    this.ctx = ctx || null;
    this.pluginsRoot = opts.pluginsRoot || path.join(__dirname, '..', 'plugins');
    this.profilesRoot = opts.profilesRoot || path.join(__dirname, 'profiles');
    this.registry = opts.registry || null;
    /** @type {Map<string, {module:object, cfg:object, dispose:Function|null}>} */
    this.mounted = new Map();
  }

  /** 按名加载 profile：'full' → core/profiles/full.js */
  loadProfile(name) {
    return require(path.join(this.profilesRoot, `${name}.js`));
  }

  _loadPluginModule(name) {
    if (this.registry && this.registry.has(name)) return this.registry.get(name);
    try {
      return require(path.join(this.pluginsRoot, name));
    } catch (err) {
      throw new Error(`[Loader] 无法加载插件 "${name}"（${this.pluginsRoot}${path.sep}${name}）: ${err.message}`);
    }
  }

  /**
   * 解析 profile 为最终挂载列表（不产生副作用，可重复调用）。
   * @returns {{profile:string, plugins:Array<{name:string, module:object,
   *            dependsOn:string[], provides:string[], cfg:object}>,
   *            disabled:string[]}}
   */
  resolve(profileModule, { env } = {}) {
    // ① 沿 extends 走到基座，得到 基座→派生 的层叠顺序
    const chain = [];
    const seen = new Set();
    let cur = profileModule;
    while (cur) {
      if (seen.has(cur)) throw new Error('[Loader] profile extends 链成环');
      seen.add(cur);
      chain.push(cur);
      cur = cur.extends ? this.loadProfile(cur.extends) : null;
    }
    const layers = chain.reverse(); // 基座在前，派生在后（后层覆盖前层）

    // ② 逐层汇总：插件名单（保持首次出现顺序）、cfg、disable
    const names = [];
    const cfgByName = new Map();
    const addCfg = (name, cfg) => {
      cfgByName.set(name, deepMerge(cfgByName.get(name) || {}, cfg));
    };
    const disabled = new Set();
    for (const layer of layers) {
      for (const item of layer.plugins || []) {
        const name = typeof item === 'string' ? item : item.name;
        if (!names.includes(name)) names.push(name);
        if (typeof item !== 'string' && item.cfg) addCfg(name, item.cfg);
      }
      for (const [name, cfg] of Object.entries(layer.overrides || {})) {
        if (!names.includes(name)) names.push(name); // overrides 可引用基座未列出的插件
        addCfg(name, cfg);
      }
      for (const name of layer.disable || []) disabled.add(name);
    }

    // ③ 环境变量覆盖层（TOKEN_WARS_DISABLE=a,b）
    if (env && env.TOKEN_WARS_DISABLE) {
      for (const raw of String(env.TOKEN_WARS_DISABLE).split(',')) {
        const name = raw.trim();
        if (name) disabled.add(name);
      }
    }

    const enabledNames = names.filter((n) => !disabled.has(n));

    // ④ 加载插件模块并校验 dependsOn（缺失 fail fast，点名依赖双方）
    const mods = new Map();
    for (const name of enabledNames) mods.set(name, this._loadPluginModule(name));
    for (const [name, mod] of mods) {
      for (const dep of mod.dependsOn || []) {
        if (!mods.has(dep)) {
          throw new Error(`[Loader] 插件 "${name}" 依赖 "${dep}"，但后者未被启用（disable 或缺失）`);
        }
      }
    }

    // ⑤ 稳定拓扑排序（同层按 profile 声明顺序）
    const order = [];
    const placed = new Set();
    let remaining = enabledNames.slice();
    while (remaining.length > 0) {
      const idx = remaining.findIndex((n) =>
        (mods.get(n).dependsOn || []).every((d) => placed.has(d))
      );
      if (idx === -1) {
        throw new Error(`[Loader] 插件依赖成环: ${remaining.join(', ')}`);
      }
      const name = remaining.splice(idx, 1)[0];
      placed.add(name);
      order.push(name);
    }

    return {
      profile: chain[chain.length - 1].name || 'anonymous',
      plugins: order.map((name) => {
        const mod = mods.get(name);
        return {
          name,
          module: mod,
          dependsOn: mod.dependsOn || [],
          provides: mod.provides || [],
          cfg: cfgByName.get(name) || {},
        };
      }),
      disabled: [...disabled].filter((d) => names.includes(d)),
    };
  }

  /**
   * 按解析结果挂载全部插件。任一 setup 抛错：回滚失败插件的半成品效应，
   * 逆序卸载已挂载者，再抛出（fail fast）。
   */
  mountProfile(profileModule, opts = {}) {
    const resolved = this.resolve(profileModule, opts);
    for (const p of resolved.plugins) {
      this.ctx.enterPluginScope(p.name);
      let dispose = null;
      try {
        dispose = p.module.setup(this.ctx, p.cfg);
      } catch (err) {
        this.ctx.exitPluginScope();
        this.ctx.unload(p.name); // 回滚失败插件的半成品效应
        for (const name of [...this.mounted.keys()].reverse()) {
          this.unload(name);
        }
        throw new Error(`[Loader] 插件 "${p.name}" setup 失败: ${err.message}`);
      }
      this.ctx.exitPluginScope();
      this.mounted.set(p.name, { module: p.module, cfg: p.cfg, dispose: dispose || null });
    }
    return resolved;
  }

  /** 卸载插件；仍有挂载者依赖它时拒绝（先卸载依赖方）。 */
  unload(name) {
    if (!this.mounted.has(name)) return false;
    for (const [n, m] of this.mounted) {
      if ((m.module.dependsOn || []).includes(name)) {
        throw new Error(`[Loader] 无法卸载 "${name}"："${n}" 仍依赖它`);
      }
    }
    const m = this.mounted.get(name);
    this.ctx.unload(name); // 先回滚效应（停止流入），再让插件自清理
    if (typeof m.dispose === 'function') {
      try {
        m.dispose();
      } catch (err) {
        // 插件自清理失败不阻断卸载流程
      }
    }
    this.mounted.delete(name);
    return true;
  }

  /** 组合树文本（--dump-config 输出）。 */
  dumpConfig(resolved) {
    const lines = [];
    lines.push(`profile: ${resolved.profile}`);
    lines.push(`mount order (${resolved.plugins.length} plugins):`);
    resolved.plugins.forEach((p, i) => {
      const parts = [`  ${String(i + 1).padStart(2)}. ${p.name}`];
      if (p.dependsOn.length) parts.push(`dependsOn: ${p.dependsOn.join(', ')}`);
      if (p.provides.length) parts.push(`provides: ${p.provides.join(', ')}`);
      if (Object.keys(p.cfg).length) parts.push(`cfg: ${JSON.stringify(p.cfg)}`);
      lines.push(parts.join('  |  '));
    });
    lines.push(resolved.disabled.length
      ? `disabled: ${resolved.disabled.join(', ')}`
      : 'disabled: (none)');
    return lines.join('\n');
  }
}

module.exports = { Loader, deepMerge };
