/**
 * ExternalBrain — 外部 agent 的决策通道（阶段 1）
 *
 * 入站路由由 aiarena 插件持有：/bot 命名空间的 bot:action /
 * bot:match_accept / bot:match_decline / disconnect 经 guard.on 绑定后
 * 转喂本类的 receiveAction / receiveAccept / receiveDisconnect
 * （INV1：game/ 层不自行注册网络处理器）。
 *
 * 本类只做「决策」：decide(state) 推送 bot:state 并等待该 tick 的 action
 * 回复；不执行任何副作用——动作由 ExternalMatchRunner 校验后服务端应用
 * （服务端权威）。socket 引用仅用于出站 emit。
 *
 * brain 跨对局复用：matchId 不固定，每场对局开始前由 runner 调用
 * beginMatch(matchId) 更新；迟到/跨对局的 action 因 matchId 不匹配被忽略。
 */

'use strict';

const { EVENTS } = require('../../shared/protocol');

class ExternalBrain {
  /**
   * @param {{ socket: object, agentId?: string }} params
   *        socket 仅用于出站 emit（入站由插件路由进来）
   */
  constructor({ socket, agentId = null }) {
    this.isExternal = true;
    this.socket = socket;
    this.agentId = agentId;
    this.matchId = null;
    this.disconnected = false;

    this.pending = new Map();   // tick -> resolve（等待 bot:action）
    this.acceptResolve = null;  // 等待 bot:match_accept/decline
  }

  /** 每场对局开始前由 ExternalMatchRunner 调用 */
  beginMatch(matchId) {
    this.matchId = matchId;
  }

  emit(event, data) {
    if (this.disconnected) return;
    this.socket.emit(event, data);
  }

  /** 推送 state 并返回 Promise<{ msg, latencyMs } | { disconnected: true }> */
  decide(state) {
    if (this.disconnected) return Promise.resolve({ disconnected: true });
    const sentAt = Date.now();
    return new Promise((resolve) => {
      this.pending.set(state.tick, resolve);
      this.socket.emit(EVENTS.BOT_STATE, state);
    }).then((msg) => (msg ? { msg, latencyMs: Date.now() - sentAt } : { disconnected: true }));
  }

  /** 等待 match_invite 应答：Promise<'accept' | 'decline'>（断连 resolve 'decline'） */
  waitAccept() {
    if (this.disconnected) return Promise.resolve('decline');
    return new Promise((resolve) => { this.acceptResolve = resolve; });
  }

  // --- 入站（由 aiarena 插件经 guard.on 转入） ---

  /** bot:action：跨对局/未开局消息与迟到 tick 忽略 */
  receiveAction(msg) {
    if (!msg || msg.matchId !== this.matchId) return;
    const resolve = this.pending.get(msg.tick);
    if (!resolve) return; // 迟到/过期 tick 的 action 忽略
    this.pending.delete(msg.tick);
    resolve(msg);
  }

  /** bot:match_accept / bot:match_decline */
  receiveAccept(value) {
    this._resolveAccept(value);
  }

  /** socket disconnect：等待中的决策全部作废（runner 据此判负） */
  receiveDisconnect() {
    this.disconnected = true;
    this._resolveAccept('decline');
    for (const [, resolve] of this.pending) resolve(null);
    this.pending.clear();
  }

  _resolveAccept(value) {
    if (this.acceptResolve) {
      const resolve = this.acceptResolve;
      this.acceptResolve = null;
      resolve(value);
    }
  }

  /**
   * 对局结束/被替换：清空对局内状态。socket 监听由插件持有并随连接
   * 生命周期解绑，不在此处操作（brain 跨对局复用）。
   */
  destroy() {
    this.pending.clear();
    this.acceptResolve = null;
  }
}

module.exports = ExternalBrain;
