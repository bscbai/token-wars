/**
 * Scheduler — 声明式节奏调度（plugin-architecture M1）
 *
 * 替代 GameEngine.tick 内硬编码的 cadence 分支：
 *   every('500ms', fn)  → 墙钟间隔（setInterval，毫秒字符串）
 *   every(20, fn)       → tick 计数（每 20 个主循环 tick 触发一次）
 *
 * 主循环（start/stop）由宿主驱动；M3 中 Scheduler 接管 GameEngine 的
 * 20Hz 循环后，tick 型条目即获得与现状完全一致的节奏语义
 * （TICK_RATE=20 → mining 每 20 tick / worldBoss、aiArena 每 100 tick）。
 *
 * M1 阶段 Scheduler 仅为内核库 + 单测覆盖，生产路径仍由 GameEngine 驱动。
 */

'use strict';

const INTERVAL_RE = /^(\d+)\s*(ms|s)?$/;

/** '500ms' → 500；'1s' → 1000；'100' → 100；不合法 → 抛错 */
function parseIntervalMs(spec) {
  const m = INTERVAL_RE.exec(String(spec).trim());
  if (!m) throw new Error(`[Scheduler] 非法间隔描述: ${JSON.stringify(spec)}`);
  const n = Number(m[1]);
  return m[2] === 's' ? n * 1000 : n;
}

class Scheduler {
  constructor() {
    /** @type {Array<{every:number, fn:Function}>} */
    this._tickEntries = [];
    /** @type {Array<ReturnType<typeof setInterval>>} */
    this._timers = [];
    this._master = null;
    this.tickCount = 0;
  }

  /**
   * 注册节奏条目，返回解绑函数（可逆效应）。
   * @param {string|number} interval 毫秒字符串（墙钟）或 tick 数（主循环）
   * @param {Function} fn (now) => void
   */
  every(interval, fn) {
    if (typeof interval === 'string') {
      const ms = parseIntervalMs(interval);
      if (ms <= 0) throw new Error(`[Scheduler] 间隔必须为正: ${interval}`);
      const timer = setInterval(() => fn(Date.now()), ms);
      this._timers.push(timer);
      return () => {
        clearInterval(timer);
        const i = this._timers.indexOf(timer);
        if (i >= 0) this._timers.splice(i, 1);
      };
    }

    if (typeof interval !== 'number' || !Number.isInteger(interval) || interval <= 0) {
      throw new Error(`[Scheduler] 非法 tick 间隔: ${JSON.stringify(interval)}`);
    }
    const entry = { every: interval, fn };
    this._tickEntries.push(entry);
    return () => {
      const i = this._tickEntries.indexOf(entry);
      if (i >= 0) this._tickEntries.splice(i, 1);
    };
  }

  /** 启动主循环（tick 型条目的驱动源）。重复调用幂等。 */
  start(tickMs) {
    if (this._master) return;
    this._master = setInterval(() => this.tick(), tickMs);
  }

  /** 停止主循环（不清理已注册条目——条目由各自 disposer 管理）。 */
  stop() {
    if (this._master) {
      clearInterval(this._master);
      this._master = null;
    }
  }

  /** 单次推进：tickCount++ 并触发所有满足 cadence 的 tick 型条目。 */
  tick() {
    this.tickCount++;
    for (const entry of [...this._tickEntries]) {
      if (this.tickCount % entry.every === 0) entry.fn(Date.now());
    }
  }
}

module.exports = { Scheduler, parseIntervalMs };
