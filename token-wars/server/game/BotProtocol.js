/**
 * BotProtocol — 外部 agent 接入协议（阶段 1）的 schema 校验与序列化
 *
 * 协议定义见 openspec/changes/agent-access-protocol/design.md §D3：
 *   S bot:match_invite → B bot:match_accept/decline
 *   S bot:state(20Hz)  ↔ B bot:action
 *   S bot:match_end
 * 本模块为纯函数、无状态；服务端权威：一切入站消息先过 validateActionMessage。
 */

'use strict';

const { SKILLS, BOT_PROTOCOL } = require('../../shared/constants');

// 可用技能 id（与 AIAgent.skills 同源）
const BOT_SKILL_IDS = Object.values(SKILLS).map((s) => s.id);

// 动作类型枚举（spec: move/attack/skill/shield/idle）
const ACTION_TYPES = ['move', 'attack', 'skill', 'shield', 'idle'];

// 错误码
const ERROR_CODES = {
  UNSUPPORTED_VERSION: 'unsupported_version',
  INVALID_ENVELOPE: 'invalid_envelope',
  INVALID_ACTION_TYPE: 'invalid_action_type',
  INVALID_COORDINATES: 'invalid_coordinates',
  INVALID_SKILL: 'invalid_skill',
  INVALID_TOKENS_USED: 'invalid_tokens_used',
};

const _isInt = (n) => Number.isInteger(n);

/**
 * 校验协议版本。返回 null 通过，否则返回错误码字符串。
 */
function checkVersion(msg) {
  if (!msg || msg.protocolVersion !== BOT_PROTOCOL.VERSION) {
    return ERROR_CODES.UNSUPPORTED_VERSION;
  }
  return null;
}

/**
 * 校验单个动作对象。
 * @returns {{ valid: true, action: object } | { valid: false, code: string, message: string }}
 */
function validateAction(action, { width, height } = {}) {
  if (!action || typeof action !== 'object') {
    return { valid: false, code: ERROR_CODES.INVALID_ENVELOPE, message: 'action must be an object' };
  }
  if (!ACTION_TYPES.includes(action.type)) {
    return { valid: false, code: ERROR_CODES.INVALID_ACTION_TYPE, message: `unknown action type: ${action.type}` };
  }
  if (action.type === 'move') {
    if (!_isInt(action.x) || !_isInt(action.y)) {
      return { valid: false, code: ERROR_CODES.INVALID_COORDINATES, message: 'move requires integer x,y' };
    }
    if (action.x < 0 || action.y < 0 || (width && action.x >= width) || (height && action.y >= height)) {
      return { valid: false, code: ERROR_CODES.INVALID_COORDINATES, message: 'move target out of bounds' };
    }
  }
  if (action.type === 'skill') {
    if (typeof action.id !== 'string' || !BOT_SKILL_IDS.includes(action.id)) {
      return { valid: false, code: ERROR_CODES.INVALID_SKILL, message: `unknown skill: ${action.id}` };
    }
  }
  return { valid: true, action };
}

/**
 * 校验 bot:action 完整信封。
 * @returns {{ valid: true, action: object, tokensUsed: number } | { valid: false, code, message }}
 */
function validateActionMessage(msg, { width, height } = {}) {
  const versionError = checkVersion(msg);
  if (versionError) return { valid: false, code: versionError, message: `protocolVersion must be ${BOT_PROTOCOL.VERSION}` };

  if (!msg || typeof msg !== 'object') {
    return { valid: false, code: ERROR_CODES.INVALID_ENVELOPE, message: 'message must be an object' };
  }
  if (typeof msg.matchId !== 'string' || msg.matchId.length === 0 || msg.matchId.length > 200) {
    return { valid: false, code: ERROR_CODES.INVALID_ENVELOPE, message: 'matchId required' };
  }
  if (!_isInt(msg.tick) || msg.tick < 0) {
    return { valid: false, code: ERROR_CODES.INVALID_ENVELOPE, message: 'tick must be a non-negative integer' };
  }

  const actionResult = validateAction(msg.action, { width, height });
  if (!actionResult.valid) return actionResult;

  let tokensUsed = 0;
  if (msg.tokensUsed !== undefined) {
    if (!_isInt(msg.tokensUsed) || msg.tokensUsed < 0) {
      return { valid: false, code: ERROR_CODES.INVALID_TOKENS_USED, message: 'tokensUsed must be a non-negative integer' };
    }
    tokensUsed = msg.tokensUsed;
  }

  return { valid: true, action: actionResult.action, tokensUsed };
}

// --- 序列化（S→bot，统一打协议版本戳）---

function serializeInvite({ matchId, role, map, spawn, opponent, decisionDeadlineMs, tokenBudget }) {
  return {
    protocolVersion: BOT_PROTOCOL.VERSION,
    matchId, role, map, spawn, opponent,
    decisionDeadlineMs: decisionDeadlineMs ?? BOT_PROTOCOL.DECISION_DEADLINE_MS,
    tokenBudget: tokenBudget ?? BOT_PROTOCOL.TOKEN_BUDGET_DEFAULT,
  };
}

function serializeState({ matchId, tick, serverTime, you, enemy, tokens, timeLeftMs }) {
  return {
    protocolVersion: BOT_PROTOCOL.VERSION,
    matchId, tick, serverTime, you, enemy, tokens, timeLeftMs,
  };
}

function serializeMatchEnd({ matchId, result, stats }) {
  return {
    protocolVersion: BOT_PROTOCOL.VERSION,
    matchId, result, stats,
  };
}

function serializeError(code, message) {
  return { protocolVersion: BOT_PROTOCOL.VERSION, code, message };
}

module.exports = {
  ACTION_TYPES,
  BOT_SKILL_IDS,
  ERROR_CODES,
  checkVersion,
  validateAction,
  validateActionMessage,
  serializeInvite,
  serializeState,
  serializeMatchEnd,
  serializeError,
};
