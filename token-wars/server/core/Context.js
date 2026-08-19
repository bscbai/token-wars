/**
 * GameContext — 插件共享上下文（plugin-architecture M1）
 *
 * 借鉴 DeepSeek Harness「一切皆插件」理念（Cordis Context）：
 *   - 服务接缝：ctx.service / ctx.get（定义者唯一，消费者按名取用）
 *   - 事件即扩展点：ctx.on/emit（广播）、ctx.waterfall/runWaterfall（瀑布认领）
 *   - 注册即可逆：所有注册返回 disposer 并按插件归属入效应栈，
 *     unload(name) 逆序回滚该插件的全部效应（运行时不变量 INV2）
 *   - ctx.socket：跨 socket 的可逆事件注册（经 eventGuard，M4 起由插件使用）
 *   - ctx.every：声明式节奏调度（委托 Scheduler，M3 起由插件使用）
 *
 * 运行时不变量（对应 dsh "Model-visible means logged"）：
 *   INV1 网络可见即可在 EVENTS 找到——客户端可见行为只能经
 *       ctx.socket / guard.on 注册的处理器产生。
 *   INV2 注册即可逆——unload 后该插件的所有处理器不再被触发。
 */

'use strict';

const guard = require('../middleware/eventGuard');
const { Scheduler } = require('./Scheduler');

/** 服务名不得与 Context 自身成员冲突（如 ctx.io / ctx.get） */
const RESERVED_NAMES = new Set([
  'io', 'app', 'server', 'config', 'logger', 'scheduler',
  'service', 'get', 'on', 'emit', 'waterfall', 'runWaterfall',
  'every', 'socket', 'route', 'unload',
  'addSocket', 'removeSocket', 'enterPluginScope', 'exitPluginScope',
]);

class Context {
  /**
   * @param {{io?:object, app?:object, server?:object, config?:object, logger?:object}} env
   *        宿主环境（index.js 创建 express/http/socket.io 后注入）
   */
  constructor(env = {}) {
    this.io = env.io || null;
    this.app = env.app || null;
    this.server = env.server || null;
    this.config = env.config || null;
    this.logger = env.logger || null;

    this._services = new Map();        // serviceName -> impl
    this._events = new Map();          // event -> Set<listener>
    this._waterfalls = new Map();      // event -> [listener]
    this._socketSpecs = new Map();     // specId -> spec
    this._activeSockets = new Map();   // socketId -> { socket, player }
    this._socketDisposers = new Map(); // socketId -> Map<specId, disposer>
    this._scopes = new Map();          // owner(pluginName) -> [disposer]
    this._currentOwner = null;
    this._scheduler = null;
    this._specSeq = 0;
  }

  // --- 效应归属（Loader 在 setup 前后调用） ------------------------------

  enterPluginScope(name) {
    this._currentOwner = name;
    if (!this._scopes.has(name)) this._scopes.set(name, []);
  }

  exitPluginScope() {
    this._currentOwner = null;
  }

  /** 将 disposer 记入当前插件（或宿主）的效应栈，并原样返回。 */
  _track(disposer) {
    const owner = this._currentOwner || '@host';
    if (!this._scopes.has(owner)) this._scopes.set(owner, []);
    this._scopes.get(owner).push(disposer);
    return disposer;
  }

  // --- 服务接缝 ------------------------------------------------------------

  /** 提供服务；重名注册 = 启动错误（接缝唯一，fail fast）。 */
  service(name, impl) {
    if (RESERVED_NAMES.has(name)) {
      throw new Error(`[Context] 服务名 "${name}" 与 Context 保留成员冲突`);
    }
    if (this._services.has(name)) {
      throw new Error(`[Context] 服务 "${name}" 已被注册（接缝唯一）`);
    }
    this._services.set(name, impl);
    Object.defineProperty(this, name, {
      configurable: true,
      get: () => this.get(name),
    });
    return this._track(() => {
      this._services.delete(name);
      delete this[name];
    });
  }

  /** 取用服务；未注册 = 依赖缺失错误。 */
  get(name) {
    if (!this._services.has(name)) {
      throw new Error(`[Context] 服务 "${name}" 未注册（依赖缺失或插件未挂载）`);
    }
    return this._services.get(name);
  }

  // --- 广播事件 ------------------------------------------------------------

  /** 订阅广播事件，返回 disposer。 */
  on(event, listener) {
    if (!this._events.has(event)) this._events.set(event, new Set());
    const set = this._events.get(event);
    set.add(listener);
    return this._track(() => set.delete(listener));
  }

  /** 广播事件：依次调用全部监听器（快照遍历，容忍监听器内增删）。 */
  emit(event, payload) {
    const set = this._events.get(event);
    if (!set || set.size === 0) return;
    for (const listener of [...set]) {
      try {
        listener(payload);
      } catch (err) {
        this._log('warn', { event, err: err.message }, '[Context] 事件监听器抛错');
      }
    }
  }

  // --- 瀑布事件（认领语义） --------------------------------------------------

  /**
   * 订阅瀑布事件。监听器 (data, next)：认领则填充 data 并停止（不调 next），
   * 不认领则 next() 放行下一个监听器。
   */
  waterfall(event, listener) {
    if (!this._waterfalls.has(event)) this._waterfalls.set(event, []);
    const list = this._waterfalls.get(event);
    list.push(listener);
    return this._track(() => {
      const i = list.indexOf(listener);
      if (i >= 0) list.splice(i, 1);
    });
  }

  /** 触发瀑布事件：按注册顺序链式执行，返回（可能被填充的）data。 */
  runWaterfall(event, data) {
    const list = this._waterfalls.get(event);
    if (!list || list.length === 0) return data;
    let idx = 0;
    const next = () => {
      idx += 1;
      if (idx < list.length) list[idx](data, next);
    };
    list[0](data, next);
    return data;
  }

  // --- 节奏调度 --------------------------------------------------------------

  get scheduler() {
    if (!this._scheduler) this._scheduler = new Scheduler();
    return this._scheduler;
  }

  /** 声明节奏（'500ms' 墙钟 | N tick），返回 disposer。 */
  every(interval, fn) {
    return this._track(this.scheduler.every(interval, fn));
  }

  // --- Socket 路由（可逆；M4 起插件使用） ------------------------------------

  /**
   * 注册全局 socket 事件处理器：对 addSocket 进来的每个 socket 生效，
   * handler 收到 (payload, { socket, player })。返回 disposer。
   */
  socket(event, schema, handler, category) {
    const id = `spec-${++this._specSeq}`;
    const spec = { id, event, schema, handler, category };
    this._socketSpecs.set(id, spec);
    for (const entry of this._activeSockets.values()) {
      this._applySpecToSocket(spec, entry.socket, entry.player);
    }
    return this._track(() => {
      this._socketSpecs.delete(id);
      for (const specMap of this._socketDisposers.values()) {
        const dispose = specMap.get(id);
        if (dispose) {
          dispose();
          specMap.delete(id);
        }
      }
    });
  }

  /** 宿主在连接建立时调用：记入在线表并对该 socket 应用全部 spec。 */
  addSocket(socket, player) {
    this._activeSockets.set(socket.id, { socket, player });
    for (const spec of this._socketSpecs.values()) {
      this._applySpecToSocket(spec, socket, player);
    }
  }

  /** 宿主在断开时调用：回滚该 socket 上的全部 spec 监听。 */
  removeSocket(socket) {
    this._activeSockets.delete(socket.id);
    const specMap = this._socketDisposers.get(socket.id);
    if (specMap) {
      for (const dispose of specMap.values()) dispose();
      this._socketDisposers.delete(socket.id);
    }
  }

  _applySpecToSocket(spec, socket, player) {
    const wrapped = (payload) => spec.handler(payload, { socket, player });
    const dispose = guard.on(socket, spec.event, spec.schema, wrapped, spec.category);
    let specMap = this._socketDisposers.get(socket.id);
    if (!specMap) {
      specMap = new Map();
      this._socketDisposers.set(socket.id, specMap);
    }
    specMap.set(spec.id, dispose);
  }

  // --- HTTP 路由（可逆） ------------------------------------------------------

  /** 挂载 REST 路由；返回 disposer（精确移除本次挂载的那一层）。 */
  route(prefix, router) {
    if (!this.app) throw new Error('[Context] route() 需要 env.app');
    // 注意：express 的 _router 惰性创建，挂载前可能还不存在——
    // 快照必须在 app.use 之后取，本插件的挂载层即栈顶那一个
    this.app.use(prefix, router);
    const stack = this.app._router.stack;
    const mountedAt = stack.length; // 挂载后长度；本层下标 = mountedAt - 1
    return this._track(() => {
      if (stack.length >= mountedAt) stack.splice(mountedAt - 1, 1);
    });
  }

  // --- 生命周期 --------------------------------------------------------------

  /** 逆序回滚某插件的全部效应（INV2）。未注册过则返回 false。 */
  unload(name) {
    const effects = this._scopes.get(name);
    if (!effects) return false;
    for (let i = effects.length - 1; i >= 0; i--) {
      try {
        effects[i]();
      } catch (err) {
        this._log('warn', { owner: name, err: err.message }, '[Context] 效应回滚失败');
      }
    }
    this._scopes.delete(name);
    return true;
  }

  _log(level, obj, msg) {
    if (this.logger && typeof this.logger[level] === 'function') {
      this.logger[level](obj, msg);
    }
  }
}

module.exports = { Context, RESERVED_NAMES };
