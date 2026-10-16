/**
 * i18n 运行时冒烟验证（需先 `npm start`，账号 botdemo1/demo-pass-123）
 *
 * 用本机 Chrome/Edge 无头启动 → UI 登录 → 进入挖矿/副本场景 →
 * 读取 Phaser Text 对象断言中英双语文案与 0 页面错误。
 * 新增场景翻译后把断言追加到 evaluate 内即可。
 *
 * 用法：node scripts/verify-i18n.cjs
 */
const puppeteer = require('puppeteer');
const fs = require('fs');

// Windows 常见安装位置；优先 Chrome，回退 Edge
const BROWSER_CANDIDATES = [
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const executablePath = BROWSER_CANDIDATES.find((p) => fs.existsSync(p));
if (!executablePath) {
  console.error('No Chrome/Edge found. Install one or edit BROWSER_CANDIDATES.');
  process.exit(2);
}

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url()));
  page.on('response', (r) => { if (r.status() >= 400) errors.push('http ' + r.status() + ': ' + r.url()); });

  await page.goto('http://localhost:3000/?verify=1', { waitUntil: 'networkidle2' });

  // 登录（DOM 表单）
  await page.type('input[type=text]', 'botdemo1');
  await page.type('input[type=password]', 'demo-pass-123');
  // 登录按钮按文本定位（DOM 中 buttons[0] 是全局语言切换按钮）
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /Login|登/.test(x.textContent));
    b.click();
  });

  // 等大厅就绪
  await page.waitForFunction(() => {
    const g = window.__game;
    const L = g && g.scene.keys.LobbyScene;
    return L && L.playerData && L.sys.settings.active;
  }, { timeout: 15000 });

  const verdict = await page.evaluate(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const g = window.__game;
    const texts = (key) => g.scene.keys[key].children.list.filter(o => o.type === 'Text').map(o => o.text);
    const has = (arr, pred) => arr.some(x => typeof pred === 'string' ? x === pred : pred(x));
    const lobby = g.scene.keys.LobbyScene;
    const out = { checks: [] };
    const check = (name, cond) => out.checks.push({ name, pass: !!cond });
    const toggle = async () => { document.getElementById('tw-lang-toggle').click(); await sleep(600); };
    const start = async (key) => {
      lobby.scene.start(key, { player: lobby.playerData });
      for (let i = 0; i < 25; i++) {
        const s = g.scene.keys[key];
        if (s && s.children.list.length > 0) { await sleep(200); return; }
        await sleep(200);
      }
    };
    if (document.getElementById('tw-lang-toggle').textContent !== '中文') await toggle();

    await start('MiningScene');
    let mt = texts('MiningScene');
    check('mining children>0', mt.length > 0);
    check('en mining title', has(mt, '⛏  Idle Mining'));
    check('en mining level', has(mt, x => x.startsWith('Mining Level: Lv.')));
    check('en mining rate', has(mt, x => x.startsWith('Rate: 1 Token every')));
    check('en mining cap', has(mt, x => x.startsWith('Storage cap:')));
    check('en mining pending', has(mt, 'Pending: 0 Tokens'));
    check('en mining collect', has(mt, '[ Collect Tokens ]'));
    check('en mining upgrade', has(mt, x => x.startsWith('[ Upgrade to Lv.')));
    check('en mining back', has(mt, '< Back to Lobby'));
    await toggle();
    mt = texts('MiningScene');
    check('zh mining title', has(mt, '⛏ 挂机挖矿'));
    check('zh mining pending', has(mt, '待收集: 0 Tokens'));
    check('zh mining upgrade', has(mt, x => x.startsWith('[ 升级到 Lv.')));
    check('zh mining back', has(mt, '< 返回大厅'));
    await toggle();

    await start('DungeonSelectScene');
    let dt = texts('DungeonSelectScene');
    check('dungeon children>0', dt.length > 0);
    check('en dungeon title', has(dt, '⚔  PvE Dungeons'));
    check('en dungeon names', has(dt, 'Novice Data Mine') && has(dt, 'Mid Compute Vault'));
    check('en dungeon diff', has(dt, 'Easy') && has(dt, 'Medium'));
    check('en dungeon desc', has(dt, 'Solo | 3 monster waves + Boss'));
    check('en dungeon rewards labels', dt.filter(x => x.startsWith('Rewards:')).length === 2);
    check('en dungeon enter buttons', dt.filter(x => x === '[ Enter Dungeon ]').length === 2);
    await toggle();
    dt = texts('DungeonSelectScene');
    check('zh dungeon title', has(dt, '⚔ PvE 副本选择'));
    check('zh dungeon names', has(dt, '初级数据矿洞') && has(dt, '中级算力仓库'));
    check('zh dungeon diff', has(dt, '简单') && has(dt, '中等'));
    check('zh dungeon enter', dt.filter(x => x === '[ 进入副本 ]').length === 2);
    await toggle();
    return out;
  });

  verdict.errors = errors;
  const failed = verdict.checks.filter(c => !c.pass);
  console.log(JSON.stringify(verdict, null, 1));
  console.log(`\n${verdict.checks.length - failed.length}/${verdict.checks.length} passed`);
  await browser.close();
  process.exit(failed.length === 0 && errors.length === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
