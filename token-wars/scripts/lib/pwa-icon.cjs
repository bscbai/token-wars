/**
 * 生成 PWA 图标 PNG（无第三方依赖）
 *
 * Chrome 安装应用需要 192/512 的 PNG 图标；仓库里不存二进制素材，
 * 构建时按同一套几何规则生成，保证图标与站点配色一致、可复现。
 */

'use strict';

const fs = require('node:fs');
const zlib = require('node:zlib');

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const tag = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([tag, data])));
  return Buffer.concat([len, tag, data, crc]);
}

function writeIcon(file, size) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  const set = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const o = y * stride + 1 + x * 4;
    raw[o] = r;
    raw[o + 1] = g;
    raw[o + 2] = b;
    raw[o + 3] = 255;
  };
  const rect = (x0, y0, w, h, color) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, ...color);
  };

  const grid = Math.max(2, Math.round(size / 8));
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < size; x++) {
      const line = x % grid === 0 || y % grid === 0;
      if (x <= y) {
        // 左下三角：竞技场绿
        set(x, y, 0, 255, 136);
      } else {
        // 右上三角：深色地面 + 网格
        set(x, y, ...(line ? [13, 32, 25] : [10, 10, 26]));
      }
    }
  }

  const GREEN = [0, 255, 136];
  const DARK = [10, 10, 26];
  const RED = [255, 68, 102];
  // 绿色半区里的三个「token」缺口 + 一个敌方红点
  rect(Math.round(size * 0.18), Math.round(size * 0.62), Math.round(size * 0.15), Math.round(size * 0.15), DARK);
  rect(Math.round(size * 0.38), Math.round(size * 0.74), Math.round(size * 0.11), Math.round(size * 0.11), DARK);
  rect(Math.round(size * 0.24), Math.round(size * 0.82), Math.round(size * 0.09), Math.round(size * 0.09), RED);
  // 深色半区里的三个绿色 token
  rect(Math.round(size * 0.58), Math.round(size * 0.16), Math.round(size * 0.11), Math.round(size * 0.11), GREEN);
  rect(Math.round(size * 0.74), Math.round(size * 0.30), Math.round(size * 0.09), Math.round(size * 0.09), GREEN);
  rect(Math.round(size * 0.62), Math.round(size * 0.40), Math.round(size * 0.08), Math.round(size * 0.08), GREEN);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(file, png);
  return png.length;
}

module.exports = { writeIcon };
