/**
 * 沙盒导出的 Node bot 模板
 *
 * 用户点「Download Node bot」拿到的文件必须能直接跑：连接 /bot、接受邀请、
 * 每 tick 回一个动作，并且把邀请里的地图补进 state（线上 state 不含地图）。
 */

const { renderAgentSource } = require('../shared/agentTemplate');

const POLICY = 'function decide(state) { return { type: "idle" }; }';

describe('renderAgentSource', () => {
  const src = renderAgentSource(POLICY);

  it('保留用户策略并补上 socket.io 连接骨架', () => {
    expect(src).toContain(POLICY);
    expect(src).toContain("require('socket.io-client')");
    expect(src).toContain('bot:match_invite');
    expect(src).toContain('bot:state');
    expect(src).toContain('bot:action');
    expect(src).toContain('BOT_TOKEN');
    expect(src).toContain('protocolVersion: PROTOCOL_VERSION');
  });

  it('把邀请地图合并进 state.map', () => {
    expect(src).toContain('decide({ ...state, map: mapInfo })');
  });

  it('模板本身是可解析的 JavaScript（去掉 shebang 后）', () => {
    const body = src.replace(/^#!.*\n/, '');
    expect(() => new Function(body)).not.toThrow();
  });

  it('空策略也能生成合法骨架（仅运行时报 decide 未定义）', () => {
    const empty = renderAgentSource('');
    expect(empty).toContain('bot:state');
    expect(() => new Function(empty.replace(/^#!.*\n/, ''))).not.toThrow();
  });
});
