/**
 * 策略分享链接编解码（浏览器沙盒 URL hash）
 *
 * 关注点：往返正确（ASCII/中文/emoji）、压缩确实更短、旧版裸 base64 链接兼容、
 * 畸形输入返回 null 而不是抛错。
 */

const { PREFIX, encodePolicy, decodePolicy } = require('../shared/policyLink');

describe('policyLink', () => {
  it('ASCII 策略往返一致，且重复代码被压缩', () => {
    const block = 'function decide(state) {\n'
      + '  const me = state.you;\n'
      + '  const foe = state.enemy;\n'
      + '  return { type: "attack" };\n'
      + '}\n';
    const code = block.repeat(20);
    const legacyLen = Buffer.from(code, 'utf8').toString('base64').replace(/=+$/, '').length;
    const encoded = encodePolicy(code);
    expect(encoded.startsWith(PREFIX)).toBe(true);
    expect(decodePolicy(encoded)).toBe(code);
    expect(encoded.length).toBeLessThan(legacyLen * 0.7);
  });

  it('中文与 emoji 往返一致', () => {
    const code = '// 先举盾再换血 🛡️\nfunction decide(s) { return { type: "shield" }; }';
    expect(decodePolicy(encodePolicy(code))).toBe(code);
  });

  it('空字符串与短代码仍可用', () => {
    expect(encodePolicy('')).toBe('');
    expect(decodePolicy('')).toBe('');
    const tiny = 'function decide(){return {type:"idle"}}';
    expect(decodePolicy(encodePolicy(tiny))).toBe(tiny);
  });

  it('旧版裸 base64url 链接仍能解码（向后兼容）', () => {
    const legacyCode = 'function decide() { return { type: "idle" }; } // legacy';
    const legacy = Buffer.from(legacyCode, 'utf8').toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(legacy.startsWith(PREFIX)).toBe(false);
    expect(decodePolicy(legacy)).toBe(legacyCode);
  });

  it('畸形输入返回 null，不抛错', () => {
    expect(decodePolicy('z.!!!!')).toBeNull();
    expect(decodePolicy('z.')).toBeNull();
    expect(decodePolicy('%%%%')).toBeNull();
    expect(decodePolicy('z.====')).toBeNull();
    expect(decodePolicy(null)).toBeNull();
  });

  it('两万字符长策略往返一致', () => {
    const long = 'const x = [1,2,3];\n'.repeat(1000);
    expect(decodePolicy(encodePolicy(long))).toBe(long);
  });
});
