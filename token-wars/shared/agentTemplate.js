/**
 * 把沙盒里的 decide(state) 导出为可运行的 Node 参赛 bot
 *
 * 生成的文件自带完整连接逻辑（/bot 命名空间、邀请接受、20Hz 决策循环），
 * 只依赖 socket.io-client；把提示里的 decide 原样嵌入，并把邀请里的地图
 * 补进 state（线上 bot:state 不含地图，沙盒里有，保持同一份策略可用）。
 *
 * 用法（页面按钮）：Download Node bot → node your-agent.js
 *   BOT_URL=http://localhost:3000 BOT_TOKEN=<botToken> node your-agent.js
 */

'use strict';

/**
 * @param {string} decideSource 用户策略源码（需定义 function decide(state)）
 * @returns {string} 完整 Node 脚本
 */
function renderAgentSource(decideSource) {
  const code = String(decideSource || '').trim();
  return `#!/usr/bin/env node
/**
 * Token Wars agent — exported from the browser sandbox.
 *
 * Run:
 *   npm install socket.io-client
 *   BOT_URL=http://localhost:3000 BOT_TOKEN=<botToken> node token-wars-agent.js
 *
 * Get a botToken: POST /api/auth/register then POST /api/bot/token (Bearer JWT).
 * Docs: https://github.com/bscbai/token-wars/blob/main/token-wars/docs/agent-quickstart.md
 */

'use strict';

const { io } = require('socket.io-client');

const URL = process.env.BOT_URL || 'http://localhost:3000';
const TOKEN = process.env.BOT_TOKEN;
const PROTOCOL_VERSION = 1;

if (!TOKEN) {
  console.error('Missing BOT_TOKEN env var (see the header of this file).');
  process.exit(1);
}

/** 邀请里的地图；bot:state 本身不含地图，这里合并进 state.map 供策略使用 */
let mapInfo = null;

// --- your policy (exported from the sandbox) ---------------------------------
${code}
// -----------------------------------------------------------------------------

const socket = io(\`\${URL}/bot\`, {
  auth: { botToken: TOKEN },
  transports: ['websocket'],
});

socket.on('connect', () => console.log(\`[agent] connected as \${socket.id}; waiting for a match...\`));
socket.on('connect_error', (err) => console.error(\`[agent] connection failed: \${err.message}\`));

socket.on('bot:match_invite', (invite) => {
  mapInfo = invite.map;
  console.log(\`[agent] invited to \${invite.matchId} as \${invite.role}\`);
  socket.emit('bot:match_accept', { protocolVersion: PROTOCOL_VERSION, matchId: invite.matchId });
});

socket.on('bot:state', (state) => {
  let action = { type: 'idle' };
  try {
    action = decide({ ...state, map: mapInfo });
  } catch (err) {
    console.error('[agent] decide() threw:', err.message);
  }
  socket.emit('bot:action', {
    protocolVersion: PROTOCOL_VERSION,
    matchId: state.matchId,
    tick: state.tick,
    action,
    tokensUsed: 0,
  });
});

socket.on('bot:match_end', (msg) => console.log(\`[agent] \${msg.matchId} -> \${msg.result}\`, msg.stats));
socket.on('bot:error', (msg) => console.warn('[agent] server error:', msg));
socket.on('disconnect', (reason) => console.log(\`[agent] disconnected: \${reason}\`));
`;
}

module.exports = { renderAgentSource };
