/**
 * 策略分享链接编解码（沙盒共用）
 *
 * 把一个 decide(state) 策略压进 URL hash：用 LZ-string 的 URI-safe 编码，
 * 通常能把分享链接缩短约一半；压缩后反而更长（极短代码）时退回旧版裸
 * base64url。旧链接没有前缀，仍然可以解码，保证已发出的链接不失效。
 */

'use strict';

const LZString = require('lz-string');

const PREFIX = 'z.';
const B64URL = /^[A-Za-z0-9_-]+$/;
// LZ-string 的 compressToEncodedURIComponent 字母表：A-Z a-z 0-9 + - $
const URI_SAFE = /^[A-Za-z0-9+\-$]+$/;

function toBase64Url(code) {
  const bytes = new TextEncoder().encode(code);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/**
 * @param {string} code
 * @returns {string} URL 安全的分享载荷（可能带 z. 前缀）
 */
function encodePolicy(code) {
  if (!code) return '';
  const legacy = toBase64Url(code);
  const compressed = PREFIX + LZString.compressToEncodedURIComponent(code);
  return compressed.length < legacy.length ? compressed : legacy;
}

/**
 * @param {string} encoded
 * @returns {string|null} 解码失败返回 null
 */
function decodePolicy(encoded) {
  if (typeof encoded !== 'string') return null;
  if (encoded === '') return '';
  try {
    if (encoded.startsWith(PREFIX)) {
      const payload = encoded.slice(PREFIX.length);
      if (!payload || !URI_SAFE.test(payload)) return null;
      const out = LZString.decompressFromEncodedURIComponent(payload);
      return typeof out === 'string' && out !== '' ? out : null;
    }
    if (!B64URL.test(encoded)) return null;
    return new TextDecoder().decode(fromBase64Url(encoded));
  } catch {
    return null;
  }
}

module.exports = { PREFIX, encodePolicy, decodePolicy };
