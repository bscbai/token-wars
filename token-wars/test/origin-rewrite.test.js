/**
 * 分享预览 origin 改写测试
 *
 * 观战页/首页的 OG 卡依赖服务端把 __ORIGIN__ 换成请求的真实域名，
 * 社交平台抓取不执行 JS，写错就等于分享出去没有预览图。
 */

const { resolveOrigin, rewriteOrigin } = require('../server/lib/originRewrite');

/** 最小 req 替身：只实现 get(name) 与 protocol */
function fakeReq(headers = {}, protocol = 'http') {
  return {
    protocol,
    get(name) {
      return headers[name.toLowerCase()];
    },
  };
}

describe('resolveOrigin', () => {
  it('优先使用反向代理头（Fly / Railway / nginx）', () => {
    const req = fakeReq({ 'x-forwarded-proto': 'https', 'x-forwarded-host': 'tw.example.com' }, 'http');
    expect(resolveOrigin(req)).toBe('https://tw.example.com');
  });

  it('代理头是逗号分隔列表时取第一个', () => {
    const req = fakeReq({ 'x-forwarded-proto': 'https, http', host: 'ignored.example' });
    expect(resolveOrigin(req)).toBe('https://ignored.example');
  });

  it('没有代理头时回落到协议 + Host', () => {
    const req = fakeReq({ host: 'localhost:3000' }, 'http');
    expect(resolveOrigin(req)).toBe('http://localhost:3000');
  });

  it('没有 Host 时返回 null（调用方跳过改写）', () => {
    expect(resolveOrigin(fakeReq({}))).toBe(null);
  });
});

describe('rewriteOrigin', () => {
  const html = [
    '<meta property="og:url" content="__ORIGIN__/arena">',
    '<meta property="og:image" content="https://token-wars.fly.dev/og-image.png">',
    '<link rel="canonical" href="__ORIGIN__/arena">',
    '<meta property="og:url" content="__PUBLIC_ORIGIN__/play.html">',
  ].join('\n');

  it('同时替换 __ORIGIN__、__PUBLIC_ORIGIN__ 与历史写死的 fly.dev 域名', () => {
    const out = rewriteOrigin(html, 'https://tw.example.com');
    expect(out).not.toContain('__ORIGIN__');
    expect(out).not.toContain('__PUBLIC_ORIGIN__');
    expect(out).not.toContain('token-wars.fly.dev');
    expect(out).toContain('https://tw.example.com/arena');
    expect(out).toContain('https://tw.example.com/og-image.png');
    expect(out).toContain('https://tw.example.com/play.html');
  });

  it('origin 为空时原样返回（不破坏页面）', () => {
    expect(rewriteOrigin(html, null)).toBe(html);
  });
});
