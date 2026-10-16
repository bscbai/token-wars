/**
 * i18n — 客户端极简字典式国际化（中英双语）
 *
 * 设计（openspec/changes/archive/client-i18n design D1）：
 *   - t(key, vars) 翻译；当前语言缺失回退英文，再缺失回退 key 本身（永不抛错）
 *   - {name} 占位变量替换；缺失变量保留占位
 *   - setLang 持久化到 localStorage['tw-lang'] 并通知订阅者
 *   - detectLang：localStorage 显式选择 → navigator.language（zh* → zh）→ en
 *
 * 模块不依赖 Phaser/DOM 构造期副作用，node 测试环境可直接导入
 * （localStorage/navigator 均做安全探测）。
 */

export const SUPPORTED_LANGS = ['en', 'zh'];
export const STORAGE_KEY = 'tw-lang';

const messages = {
  en: {
    // Login scene
    'login.subtitle': 'Compute Odyssey',
    'login.username': 'Username',
    'login.usernamePlaceholder': '2-16 characters',
    'login.password': 'Password',
    'login.passwordPlaceholder': 'At least 4 characters',
    'login.login': 'Login',
    'login.register': 'Register',
    'login.toRegister': 'Create account',
    'login.toLogin': 'Back to login',
    'login.success': 'Logged in!',
    'login.successEntering': 'Logged in! Entering...',
    'login.authFail': 'Authentication failed',
    'login.enterBoth': 'Enter username and password',
    'login.usernameMin': 'Username must be at least 2 characters',
    'login.passwordMin': 'Password must be at least 4 characters',
    'login.registering': 'Registering...',
    'login.loggingIn': 'Logging in...',
    'login.requestFailed': 'Request failed',
    'login.connectFailed': 'Failed to connect to server',

    // Lobby scene
    'lobby.title': 'Compute Core Lobby',
    'lobby.errNoPlayer': 'Error: no player data',
    'lobby.renderError': 'Render error: {msg}',
    'lobby.comingSoon': '— coming soon',
    'lobby.mining': '⛏  Mining',
    'lobby.pve': '⚔  PvE Dungeons',
    'lobby.pvp': '🏟  PvP Arena',
    'lobby.aiarena': '🤖  AI Arena',
    'lobby.shop': '🛒  Compute Shop',
    'lobby.inventory': '🎒  Inventory & Skill Disk',
    'lobby.stable': 'Stable: ',
    'lobby.unstable': 'Unstable: ',
    'lobby.credits': 'Credits: ',
  },
  zh: {
    // Login scene
    'login.subtitle': '算力征途',
    'login.username': '用户名:',
    'login.usernamePlaceholder': '2-16 个字符',
    'login.password': '密  码:',
    'login.passwordPlaceholder': '至少 4 个字符',
    'login.login': '登  录',
    'login.register': '注  册',
    'login.toRegister': '注册新账号',
    'login.toLogin': '返回登录',
    'login.success': '登录成功!',
    'login.successEntering': '登录成功! 正在进入...',
    'login.authFail': '认证失败',
    'login.enterBoth': '请输入用户名和密码',
    'login.usernameMin': '用户名至少 2 个字符',
    'login.passwordMin': '密码至少 4 个字符',
    'login.registering': '注册中...',
    'login.loggingIn': '登录中...',
    'login.requestFailed': '请求失败',
    'login.connectFailed': '连接服务器失败',

    // Lobby scene
    'lobby.title': '算力核心大厅',
    'lobby.errNoPlayer': '错误: 无玩家数据',
    'lobby.renderError': '渲染错误: {msg}',
    'lobby.comingSoon': ' — 即将开放',
    'lobby.mining': '⛏  挂机挖矿',
    'lobby.pve': '⚔  PvE 副本',
    'lobby.pvp': '🏟  PvP 竞技场',
    'lobby.aiarena': '🤖 AI 竞技场',
    'lobby.shop': '🛒  算力商城',
    'lobby.inventory': '🎒  背包 & 技能盘',
    'lobby.stable': '稳定Token: ',
    'lobby.unstable': '不稳定Token: ',
    'lobby.credits': '积分: ',
  },
};

/** 安全取 localStorage（浏览器存在；node 测试环境可能缺失） */
function safeStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/**
 * 初始语言探测：显式存储优先 → 浏览器语言（zh* → zh）→ 英文兜底。
 * 面向全球目标，未知语言一律英文。
 */
export function detectLang() {
  const storage = safeStorage();
  const saved = storage && storage.getItem(STORAGE_KEY);
  if (saved && SUPPORTED_LANGS.includes(saved)) return saved;
  if (typeof navigator !== 'undefined' && String(navigator.language || '').toLowerCase().startsWith('zh')) {
    return 'zh';
  }
  return 'en';
}

let currentLang = detectLang();
const subscribers = new Set();

export function getLang() {
  return currentLang;
}

/**
 * 切换语言：持久化（同语言也写，确保首次显式选择落盘）并通知订阅者。
 * 不支持的语言静默忽略。
 */
export function setLang(next) {
  if (!SUPPORTED_LANGS.includes(next)) return;
  const storage = safeStorage();
  if (storage) {
    try { storage.setItem(STORAGE_KEY, next); } catch { /* 隐私模式等写入失败可忽略 */ }
  }
  if (next === currentLang) return;
  currentLang = next;
  for (const fn of subscribers) {
    try { fn(next); } catch (err) { console.error('[i18n] subscriber error:', err); }
  }
}

/** 订阅语言变更；返回取消订阅函数 */
export function onLangChange(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

/**
 * 翻译：当前语言 → 英文 → key 本身；{var} 变量插值（缺失变量保留占位）。
 * @param {string} key
 * @param {Record<string,string|number>} [vars]
 */
export function t(key, vars) {
  let str = messages[currentLang] && messages[currentLang][key];
  if (str == null) str = messages.en[key];
  if (str == null) return key;
  if (vars) {
    str = str.replace(/\{(\w+)\}/g, (match, name) => (vars[name] != null ? String(vars[name]) : match));
  }
  return str;
}
