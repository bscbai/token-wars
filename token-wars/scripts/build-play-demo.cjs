/**
 * 打包浏览器试玩页脚本
 *
 * `client/play/main.js` 复用服务端的 BuiltinBrain / AIAgent / arenaDamage 与
 * shared/arenaMaps，用 esbuild 打成单文件 IIFE：
 *   - `client/play.js`        —— 本地 `npm start` 后访问 /play 使用（产物入库）
 *   - `demo-site/play.js`     —— GitHub Pages 静态演示站使用（若目录存在）
 *
 * 产物入库是为了让 `npm start` 零构建即可试玩；CI 会重新打包并 diff
 * `client/play.js`，防止源码与产物漂移。
 *
 * 用法：node scripts/build-play-demo.cjs
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'client', 'play.js');

esbuild.buildSync({
  entryPoints: [path.join(ROOT, 'client', 'play', 'main.js')],
  bundle: true,
  outfile: OUT,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  minify: true,
  legalComments: 'none',
  logLevel: 'silent',
});

console.log(JSON.stringify({ out: OUT, bytes: fs.statSync(OUT).size }, null, 2));
