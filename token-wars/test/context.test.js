/**
 * GameContext + Scheduler 内核单测（plugin-architecture M1 · tasks 2.1/2.3/2.4）
 *
 * 覆盖：
 *   - 服务接缝：注册/取用/重名 fail fast/缺失报错/保留名冲突
 *   - 广播事件：多监听器、disposer、emit 内增删监听器的快照语义
 *   - 瀑布事件：注册顺序、认领短路、全放行、unload 回滚
 *   - 节奏调度：墙钟字符串（真实计时器 + dispose）、tick 计数（手动推进）、主循环
 *   - INV2：unload 后 on/every/service/socket/route 全部失效
 *   - socket 接缝：addSocket 应用 spec、handler 二参上下文、removeSocket/disposer 回滚
 *   - route：真实 express 挂载与回退
 */

const express = require('express');
const { Context } = require('../server/core/Context');
const { Scheduler } = require('../server/core/Scheduler');
const guard = require('../server/middleware/eventGuard');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 假 socket：实现 guard.on 依赖的 on/off/emit 面 */
function fakeSocket(id) {
  return {
    id,
    data: {},
    listeners: new Map(),
    on(event, fn) {
      if (!this.listeners.has(event)) this.listeners.set(event, new Set());
      this.listeners.get(event).add(fn);
    },
    off(event, fn) {
      const set = this.listeners.get(event);
      if (set) set.delete(fn);
    },
    emit: vi.fn(),
    fire(event, payload) {
      for (const fn of this.listeners.get(event) || []) fn(payload);
    },
  };
}

beforeEach(() => {
  guard.rateLimiter.reset();
});

// --- 服务接缝 ---------------------------------------------------------------

describe('Context 服务接缝', () => {
  it('service/get 往返 + 便捷属性访问 ctx.<name>', () => {
    const ctx = new Context();
    const impl = { hello: 1 };
    ctx.service('combat', impl);
    expect(ctx.get('combat')).toBe(impl);
    expect(ctx.combat).toBe(impl);
  });

  it('重名注册 → 抛错（接缝唯一）', () => {
    const ctx = new Context();
    ctx.service('combat', {});
    expect(() => ctx.service('combat', {})).toThrow(/已被注册/);
  });

  it('get 未注册服务 → 抛依赖缺失错误', () => {
    const ctx = new Context();
    expect(() => ctx.get('nope')).toThrow(/未注册/);
  });

  it('保留名（如 io/get）→ 拒绝注册', () => {
    const ctx = new Context();
    expect(() => ctx.service('get', {})).toThrow(/保留成员/);
    expect(() => ctx.service('io', {})).toThrow(/保留成员/);
  });
});

// --- 广播事件 ---------------------------------------------------------------

describe('Context 广播事件 on/emit', () => {
  it('多个监听器依次收到同一 payload', () => {
    const ctx = new Context();
    const a = vi.fn();
    const b = vi.fn();
    ctx.on('player:join', a);
    ctx.on('player:join', b);
    ctx.emit('player:join', { id: 'p1' });
    expect(a).toHaveBeenCalledWith({ id: 'p1' });
    expect(b).toHaveBeenCalledWith({ id: 'p1' });
  });

  it('disposer 移除后不再触发（INV2 基本形态）', () => {
    const ctx = new Context();
    const a = vi.fn();
    const dispose = ctx.on('player:join', a);
    ctx.emit('player:join', {});
    dispose();
    ctx.emit('player:join', {});
    expect(a).toHaveBeenCalledTimes(1);
  });

  it('emit 快照语义：遍历中移除的监听器本轮仍触发，下一轮不再', () => {
    const ctx = new Context();
    const order = [];
    ctx.on('e', () => {
      order.push('a');
      disposeB(); // 遍历中移除后面的监听器
    });
    const disposeB = ctx.on('e', () => order.push('b'));
    ctx.emit('e', {});
    expect(order).toEqual(['a', 'b']); // 本轮：快照已包含 b
    order.length = 0;
    ctx.emit('e', {});
    expect(order).toEqual(['a']); // 下一轮：b 已移除
  });

  it('监听器抛错不阻断后续监听器，也不冒泡', () => {
    const ctx = new Context();
    const after = vi.fn();
    ctx.on('e', () => { throw new Error('boom'); });
    ctx.on('e', after);
    expect(() => ctx.emit('e', {})).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
  });
});

// --- 瀑布事件 ---------------------------------------------------------------

describe('Context 瀑布事件 waterfall/runWaterfall', () => {
  it('监听器认领（不调 next）→ 后续监听器不执行', () => {
    const ctx = new Context();
    const second = vi.fn();
    ctx.waterfall('combat:resolve-context', (data, next) => {
      data.entities = new Map([['m1', {}]]);
      data.resolved = true; // 认领，短路
    });
    ctx.waterfall('combat:resolve-context', second);
    const out = ctx.runWaterfall('combat:resolve-context', { player: { id: 'p1' } });
    expect(second).not.toHaveBeenCalled();
    expect(out.resolved).toBe(true);
    expect(out.entities.size).toBe(1);
  });

  it('全部放行（都调 next）→ 链走完，data 累积', () => {
    const ctx = new Context();
    ctx.waterfall('w', (data, next) => { data.a = 1; next(); });
    ctx.waterfall('w', (data, next) => { data.b = 2; next(); });
    const out = ctx.runWaterfall('w', {});
    expect(out).toEqual({ a: 1, b: 2 });
  });

  it('顺序即注册顺序；unload 后监听器失效', () => {
    const ctx = new Context();
    ctx.enterPluginScope('pve');
    const dispose = ctx.waterfall('w', (data, next) => { data.order = (data.order || '') + 'A'; next(); });
    ctx.exitPluginScope();
    ctx.waterfall('w', (data, next) => { data.order = (data.order || '') + 'B'; next(); });
    expect(ctx.runWaterfall('w', {}).order).toBe('AB');

    ctx.unload('pve');
    expect(ctx.runWaterfall('w', {}).order).toBe('B');
  });
});

// --- 节奏调度 ---------------------------------------------------------------

describe('Scheduler 节奏调度', () => {
  it('墙钟字符串：真实计时触发，dispose 后停止', async () => {
    const s = new Scheduler();
    let fired = 0;
    const dispose = s.every('60ms', () => fired++);
    await sleep(220);
    dispose();
    const after = fired;
    await sleep(150);
    expect(fired).toBeGreaterThanOrEqual(2);
    expect(fired).toBe(after); // dispose 后不再增长
  });

  it("非法间隔描述 → 抛错（'abc' / 0 / 1.5）", () => {
    const s = new Scheduler();
    expect(() => s.every('abc', () => {})).toThrow(/非法间隔/);
    expect(() => s.every(0, () => {})).toThrow(/非法/);
    expect(() => s.every(1.5, () => {})).toThrow(/非法/);
  });

  it('tick 计数：every(3) 在第 3/6 tick 触发，第 7 tick 共 2 次', () => {
    const s = new Scheduler();
    const fn = vi.fn();
    s.every(3, fn);
    for (let i = 0; i < 7; i++) s.tick();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('tick 型 disposer 移除后不再触发', () => {
    const s = new Scheduler();
    const fn = vi.fn();
    const dispose = s.every(2, fn);
    s.tick();
    dispose();
    for (let i = 0; i < 10; i++) s.tick();
    expect(fn).not.toHaveBeenCalled();
  });

  it('主循环 start/stop 驱动 tick 型条目', async () => {
    const s = new Scheduler();
    const fn = vi.fn();
    s.every(2, fn); // 主循环 10ms → 每 20ms 触发一次
    s.start(10);
    await sleep(300);
    s.stop();
    // Windows 定时器精度 + 测试机负载下放宽下限
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('ctx.every 委托 Scheduler 并入效应栈（unload 即停）', async () => {
    const ctx = new Context();
    let fired = 0;
    ctx.enterPluginScope('mining');
    ctx.every('60ms', () => fired++);
    ctx.exitPluginScope();
    await sleep(200);
    expect(fired).toBeGreaterThanOrEqual(2);

    ctx.unload('mining');
    const after = fired;
    await sleep(150);
    expect(fired).toBe(after);
  });
});

// --- INV2：unload 整体回滚 ---------------------------------------------------

describe('Context unload（INV2 全效应回滚）', () => {
  it('on/every/service 同时注册 → unload 后全部失效', async () => {
    const ctx = new Context();
    const listener = vi.fn();
    ctx.enterPluginScope('pve');
    ctx.service('pve', { tag: 'svc' });
    ctx.on('player:join', listener);
    ctx.every('60ms', () => {});
    ctx.exitPluginScope();

    expect(ctx.unload('pve')).toBe(true);
    ctx.emit('player:join', {});
    expect(listener).not.toHaveBeenCalled();
    expect(() => ctx.get('pve')).toThrow(/未注册/);
    expect(ctx.pve).toBeUndefined(); // 便捷属性一并移除
    expect(ctx.unload('pve')).toBe(false); // 幂等：再卸载返回 false
  });
});

// --- socket 接缝 ------------------------------------------------------------

describe('Context socket 接缝（跨 socket 可逆注册）', () => {
  it('addSocket 后新 spec 生效：handler 收到 (payload, {socket, player})', () => {
    const ctx = new Context();
    const sock = fakeSocket('s1');
    const player = { id: 'p1' };
    ctx.addSocket(sock, player);

    const handler = vi.fn();
    ctx.socket('input:skill', null, handler, 'skill');
    sock.fire('input:skill', { skillId: 0 });

    expect(handler).toHaveBeenCalledTimes(1);
    const [payload, connCtx] = handler.mock.calls[0];
    expect(payload).toEqual({ skillId: 0 });
    expect(connCtx.socket).toBe(sock);
    expect(connCtx.player).toBe(player);
  });

  it('先注册 spec 后 addSocket：同样应用到新连接', () => {
    const ctx = new Context();
    const handler = vi.fn();
    ctx.socket('evt', null, handler);
    const sock = fakeSocket('s2');
    ctx.addSocket(sock, { id: 'p2' });
    sock.fire('evt', {});
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('disposer 回滚：已连 socket 的监听被移除，后续 socket 不再应用', () => {
    const ctx = new Context();
    const sockA = fakeSocket('sA');
    ctx.addSocket(sockA, { id: 'pa' });
    const handler = vi.fn();
    ctx.enterPluginScope('pve');
    const dispose = ctx.socket('evt', null, handler);
    ctx.exitPluginScope();

    dispose();
    sockA.fire('evt', {});
    expect(handler).not.toHaveBeenCalled();

    const sockB = fakeSocket('sB');
    ctx.addSocket(sockB, { id: 'pb' });
    sockB.fire('evt', {});
    expect(handler).not.toHaveBeenCalled();
  });

  it('unload 插件 → 其 socket spec 全部回滚（INV2）', () => {
    const ctx = new Context();
    const sock = fakeSocket('s3');
    ctx.addSocket(sock, { id: 'p3' });
    const handler = vi.fn();
    ctx.enterPluginScope('pve');
    ctx.socket('evt', null, handler);
    ctx.exitPluginScope();

    ctx.unload('pve');
    sock.fire('evt', {});
    expect(handler).not.toHaveBeenCalled();
    expect(sock.listeners.get('evt').size).toBe(0); // 监听器集合已清空
  });

  it('removeSocket → 该 socket 上的 spec 监听被移除', () => {
    const ctx = new Context();
    const sock = fakeSocket('s4');
    ctx.addSocket(sock, { id: 'p4' });
    const handler = vi.fn();
    ctx.socket('evt', null, handler);
    expect(sock.listeners.get('evt').size).toBe(1);

    ctx.removeSocket(sock);
    expect(sock.listeners.get('evt').size).toBe(0);
    sock.fire('evt', {});
    expect(handler).not.toHaveBeenCalled();
  });

  it('经真实 guard：schema 校验失败 → 回发 error，handler 不执行', () => {
    const ctx = new Context();
    const sock = fakeSocket('s5');
    ctx.addSocket(sock, { id: 'p5' });
    const handler = vi.fn();
    ctx.socket('input:skill', {
      skillId: { type: 'number', min: 0, max: 3, integer: true, required: true },
    }, handler, 'skill');

    sock.fire('input:skill', { skillId: 99 });
    expect(handler).not.toHaveBeenCalled();
    expect(sock.emit).toHaveBeenCalledWith('error',
      expect.objectContaining({ code: 'VALIDATION_ERROR' }));

    sock.fire('input:skill', { skillId: 1 });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

// --- route 接缝 -------------------------------------------------------------

describe('Context route 接缝（真实 express）', () => {
  it('挂载后可命中路由；dispose 后从路由栈移除', async () => {
    const ctx = new Context({ app: express() });
    const { Router } = express;
    const router = Router();
    router.get('/ping', (_req, res) => res.json({ ok: true }));

    ctx.enterPluginScope('identity');
    ctx.route('/api/test', router);
    ctx.exitPluginScope();

    ctx.app.use((req, res) => res.status(404).json({}));

    // 挂载态：命中
    const server = ctx.app.listen(0);
    const port = server.address().port;
    const hit = await fetch(`http://127.0.0.1:${port}/api/test/ping`);
    expect(hit.status).toBe(200);

    ctx.unload('identity');
    const miss = await fetch(`http://127.0.0.1:${port}/api/test/ping`);
    expect(miss.status).toBe(404);

    await new Promise((r) => server.close(r));
  });
});
