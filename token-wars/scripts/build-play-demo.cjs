/**
 * 打包浏览器演示脚本（试玩页 + Agent 沙盒）
 *
 * 两个入口都复用服务端模块（BuiltinBrain / AIAgent / agentActionRules /
 * BotProtocol / shared 地图），用 esbuild 各打成单文件 IIFE：
 *   - `client/play.js`     —— `client/play/main.js`（人类对战内置 AI）
 *   - `client/sandbox.js`  —— `client/sandbox/main.js`（写 decide(state) 打 AI）
 * 产物入库，保证 `npm start` 后 /play、/sandbox 零构建可用；CI 重新打包并
 * diff 两个产物，防止源码与产物漂移。
 *
 * 用法：node scripts/build-play-demo.cjs
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..');
const ENTRIES = [
  { entry: path.join(ROOT, 'client', 'play', 'main.js'), out: path.join(ROOT, 'client', 'play.js') },
  { entry: path.join(ROOT, 'client', 'sandbox', 'main.js'), out: path.join(ROOT, 'client', 'sandbox.js') },
];

const result = ENTRIES.map(({ entry, out }) => {
  esbuild.buildSync({
    entryPoints: [entry],
    bundle: true,
    outfile: out,
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    minify: true,
    legalComments: 'none',
    logLevel: 'silent',
  });
  return { out, bytes: fs.statSync(out).size };
});

console.log(JSON.stringify({ bundles: result }, null, 2));
