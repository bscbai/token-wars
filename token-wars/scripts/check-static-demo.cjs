/**
 * 静态演示站自检（CI 用）
 *
 * demo-site 是构建产物：页面、sitemap、PWA 缓存与图标必须互相自洽，
 * 否则社交分享会静默失去预览卡、分享链接会 404。这里用纯 Node 做一遍
 * 低成本断言，避免每次发版靠人工爬查。
 *
 * 用法：node scripts/check-static-demo.cjs
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const OUT = process.env.DEMO_DIR ? path.resolve(process.env.DEMO_DIR) : path.join(__dirname, '..', 'demo-site');
const PUBLIC_ORIGIN = 'https://bscbai.github.io/token-wars';
const problems = [];

const read = (name) => fs.readFileSync(path.join(OUT, name), 'utf8');
const meta = (html, re) => {
  const m = html.match(re);
  return m ? m[1] : '';
};

if (!fs.existsSync(OUT)) {
  console.error('demo-site 不存在，请先运行 npm run demo:static');
  process.exit(1);
}

const htmlFiles = fs.readdirSync(OUT).filter((f) => f.endsWith('.html')).sort();

for (const file of htmlFiles) {
  const html = read(file);
  const where = (msg) => problems.push(`${file}: ${msg}`);

  if (!/<title>[^<]+<\/title>/.test(html)) where('缺少 <title>');
  if (!meta(html, /<meta name="description" content="([^"]*)"/)) where('缺少 meta description');
  for (const tag of [
    'property="og:title"', 'property="og:description"', 'property="og:image"',
    'name="twitter:image"', 'rel="canonical"',
  ]) {
    if (!html.includes(tag)) where(`缺少 ${tag}`);
  }
  if (html.includes('__PUBLIC_ORIGIN__') || html.includes('__DATA__')) where('残留构建占位符');

  const ogImage = meta(html, /<meta property="og:image" content="([^"]+)"/);
  if (ogImage && !fs.existsSync(path.join(OUT, path.basename(ogImage)))) {
    where(`og:image 本地不存在：${ogImage}`);
  }

  // 双语页必须互相声明 hreflang
  if (/^(index|benchmark|match-\d+)(\.zh)?\.html$/.test(file)) {
    const langs = [...html.matchAll(/hreflang="(en|zh)" href="([^"]+)"/g)].map((m) => m[1]);
    if (!langs.includes('en') || !langs.includes('zh')) where('缺少 hreflang 互指');
  }

  // 站内链接必须落到真实文件
  for (const m of html.matchAll(/href="([^"]+)"/g)) {
    let href = m[1];
    if (href.startsWith('#')) continue;
    if (/^https?:/.test(href)) {
      if (!href.startsWith(PUBLIC_ORIGIN)) continue;
      href = href.slice(PUBLIC_ORIGIN.length).replace(/^\//, '') || 'index.html';
    }
    href = href.replace(/^\.\//, '').split('#')[0].split('?')[0];
    if (!href) continue;
    if (!fs.existsSync(path.join(OUT, href))) where(`站内死链：${m[1]}`);
  }
}

// sitemap 与页面双向一致
const sitemap = read('sitemap.xml');
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const toLocal = (url) => {
  const p = new URL(url).pathname.replace(/^\/token-wars\//, '/').replace(/^\//, '');
  return p || 'index.html';
};
const listed = new Set(locs.map(toLocal));
for (const rel of listed) {
  if (!fs.existsSync(path.join(OUT, rel))) problems.push(`sitemap 指向缺失文件：${rel}`);
}
for (const file of htmlFiles) {
  if (!listed.has(file)) problems.push(`页面未收录 sitemap：${file}`);
}
if (!listed.has('index.zh.html')) problems.push('sitemap 缺少 index.zh.html');
const matchCount = htmlFiles.filter((f) => /^match-\d+\.html$/.test(f)).length;
if (matchCount !== 20) problems.push(`单场页数量应为 20，实际 ${matchCount}`);

// service worker 预缓存与缓存名
const sw = read('sw.js');
const coreMatch = sw.match(/const CORE = (\[[\s\S]*?\]);/);
if (!coreMatch) problems.push('sw.js 缺少 CORE 数组');
else {
  let core = [];
  try { core = JSON.parse(coreMatch[1]); } catch (e) { problems.push(`sw.js CORE 解析失败：${e.message}`); }
  for (const item of core) {
    const rel = item.replace(/^\.\//, '') || 'index.html';
    if (!fs.existsSync(path.join(OUT, rel))) problems.push(`sw 预缓存缺失文件：${item}`);
  }
}
if (!/const CACHE = 'tw-static-[0-9a-f]+'/.test(sw)) problems.push('sw.js 缺少缓存版本号');

// manifest 与 PNG 图标
let manifest = null;
try { manifest = JSON.parse(read('manifest.webmanifest')); } catch (e) { problems.push(`manifest 解析失败：${e.message}`); }
if (manifest) {
  if (!fs.existsSync(path.join(OUT, manifest.start_url.replace(/^\.\//, '')))) {
    problems.push(`manifest start_url 不存在：${manifest.start_url}`);
  }
  for (const icon of manifest.icons || []) {
    const f = path.join(OUT, icon.src.replace(/^\.\//, ''));
    if (!fs.existsSync(f)) problems.push(`manifest 图标缺失：${icon.src}`);
    else if (fs.readFileSync(f).subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
      problems.push(`manifest 图标不是 PNG：${icon.src}`);
    }
  }
}

if (problems.length) {
  console.error(`static demo check failed (${problems.length}):`);
  for (const p of problems) console.error(` - ${p}`);
  process.exit(1);
}

console.log(`static demo check passed: ${htmlFiles.length} pages, ${listed.size} sitemap urls`);
