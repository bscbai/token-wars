'use strict';

/**
 * 分享预览所需的绝对 URL 改写。
 *
 * 静态 HTML（client/index.html、client/arena.html）里用 `__ORIGIN__` 占位
 * （历史上还写过 `https://token-wars.fly.dev`），由服务端按本次请求的
 * origin 替换。社交平台抓取 OG 卡时不执行 JS，静态写死域名会让预览图在
 * Fly / Railway / 自建域名 / 反向代理下全部失效。
 *
 * 代理头优先：x-forwarded-proto / x-forwarded-host（Fly、Railway、nginx 都会带）。
 */

const ORIGIN_PLACEHOLDERS = ['https://token-wars.fly.dev', '__ORIGIN__'];

/** 解析本次请求的公开 origin；拿不到 host 时返回 null（调用方跳过改写）。 */
function resolveOrigin(req) {
  const forwardedProto = req.get('x-forwarded-proto');
  const proto = String(forwardedProto || req.protocol || 'http').split(',')[0].trim() || 'http';
  const host = req.get('x-forwarded-host') || req.get('host');
  if (!host) return null;
  return `${proto}://${host.trim()}`;
}

/** 把 HTML 里的占位 origin 全部替换成真实 origin。 */
function rewriteOrigin(html, origin) {
  if (!origin) return html;
  let out = String(html);
  for (const placeholder of ORIGIN_PLACEHOLDERS) {
    out = out.split(placeholder).join(origin);
  }
  return out;
}

module.exports = { ORIGIN_PLACEHOLDERS, resolveOrigin, rewriteOrigin };
