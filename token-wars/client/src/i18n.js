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

export const messages = {
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

    // AI Arena scene
    'arena.title': 'AI Agent Arena',
    'arena.subtitle': 'Train an AI agent and let it fight for you',
    'arena.selectHint': 'Select an agent on the left for details',
    'arena.deploy': '[ Deploy AI Agent (uses equipped tokens) ]',
    'arena.back': '< Back to Lobby',
    'arena.yourAgents': 'Your Agents ({n})',
    'arena.emptyAgents': 'No agents yet\nDeploy with the button below',
    'arena.active': '● Active',
    'arena.recall': '[ Recall ]',
    'arena.deployBtn': '[ Deploy ]',
    'arena.train': '[ Train ]',
    'arena.history': '[ History ]',
    'arena.training': 'Training...',
    'arena.loadingHistory': 'Loading match history...',
    'arena.loadingReplay': 'Loading replay...',
    'arena.nameLabel': 'Name:',
    'arena.renameHint1': 'Click the name to edit (Enter to confirm)',
    'arena.renameHint2': 'Type a new name, Enter to confirm',
    'arena.nameSaved': 'Name saved',
    'arena.specialLabel': 'Special behavior:',
    'arena.beh.berserker.name': 'Comeback Killer',
    'arena.beh.berserker.desc': 'HP<10%: +200% attack',
    'arena.beh.perfect_defense.name': 'Perfect Defense',
    'arena.beh.perfect_defense.desc': 'Shield +50%, CD -2s',
    'arena.beh.greedy_algorithm.name': 'Greedy Algorithm',
    'arena.beh.greedy_algorithm.desc': '+30% damage after pickup',
    'arena.beh.dodge_master.name': 'Dodge Master',
    'arena.beh.dodge_master.desc': 'Dodge CD -40%, range +1',
    'arena.league.master': 'Master',
    'arena.league.gold': 'Gold',
    'arena.league.silver': 'Silver',
    'arena.league.bronze': 'Bronze',
    'arena.statusDeployed': 'Agent deployed!',
    'arena.statusRecalled': 'Agent recalled',
    'arena.dailyCap': 'Daily limit reached (20 matches)',
    'arena.cooldown': 'Cooldown: {s}s',
    'arena.paritySuspended': 'Suspended for parity violations',
    'arena.resultWin': 'Victory!',
    'arena.resultLoss': 'Defeat',
    'arena.resultDraw': 'Draw!',
    'arena.aeloLine': ' AELO {aelo} ({change}) ★{level}',
    'arena.replayUnavailable': 'Replay unavailable',
    'arena.behaviorUpdated': 'Special behavior updated',
    'arena.deploying': 'Deploying...',
    'arena.replayHeader': 'Replay: {a} vs {b}',
    'arena.act.attack': 'Attack',
    'arena.act.retreat': 'Retreat',
    'arena.act.chase': 'Chase',
    'arena.act.dash': 'Dodge Dash',
    'arena.act.shieldRetreat': 'Shield Retreat',
    'arena.act.patrol': 'Patrol',
    'arena.act.combo': 'Combo!',
    'arena.act.berserkerCombo': 'Comeback Combo!!',
    'arena.act.move': 'Move',
    'arena.act.idle': 'Wait',
    'arena.replayStep': 't{tick}: {action} (HP: {hp})',
    'arena.matchHistory': 'Match History',
    'arena.noMatches': 'No matches yet',
    'arena.res.win': 'W',
    'arena.res.draw': 'D',
    'arena.res.loss': 'L',
    'arena.vs': 'vs {name}',
    'arena.replayBtn': '[Replay]',
    'arena.season.none': 'None',
    'arena.week1': 'Storm',
    'arena.week2': 'Contest',
    'arena.week3': 'Clash',
    'arena.week4': 'Review',
    'arena.seasonLine': 'S{week}: {weekLabel}  |  {buff}',
    'arena.buff.quantum_awaken.name': 'Quantum Awakening',
    'arena.buff.quantum_awaken.desc': 'AI attack tendency +15%',
    'arena.buff.shadow_protocol.name': 'Shadow Protocol',
    'arena.buff.shadow_protocol.desc': 'AI dodge tendency +15%',
    'arena.buff.entropy_crisis.name': 'Entropy Crisis',
    'arena.buff.entropy_crisis.desc': 'Counter chance when hit +20%',
    'arena.tourRunning': 'Running',
    'arena.tourEnded': 'Finished',
    'arena.tourLine': 'Tournament {status} | Round {round}/{total}',
    'arena.championLine': 'Champion: {name}!',
    'arena.tourStart': 'Tournament started! {n} masters competing',
    'arena.tourMatch': 'R{round}/{total}: {a} vs {b} → {w} ({score})',
    'arena.tourRound': 'Round {round}/{total} started! {n} agents remaining',
    'arena.tourChampion': 'Tournament champion: {name}!',
    'arena.close': '[ Close ]',
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

    // AI Arena scene
    'arena.title': 'AI 傀儡竞技场',
    'arena.subtitle': '训练 AI 代理，让它替你战斗',
    'arena.selectHint': '选择左侧代理查看详情',
    'arena.deploy': '[ 部署 AI 代理（使用当前装备的 Token）]',
    'arena.back': '< 返回大厅',
    'arena.yourAgents': '你的 AI ({n})',
    'arena.emptyAgents': '暂无 AI\n点击下方按钮部署',
    'arena.active': '● 活跃',
    'arena.recall': '[ 召回 ]',
    'arena.deployBtn': '[ 部署 ]',
    'arena.train': '[ 训练 ]',
    'arena.history': '[ 历史 ]',
    'arena.training': '训练中...',
    'arena.loadingHistory': '加载对战历史...',
    'arena.loadingReplay': '加载回放...',
    'arena.nameLabel': '名称:',
    'arena.renameHint1': '点击名称编辑 (Enter 确认)',
    'arena.renameHint2': '输入新名称，Enter 确认',
    'arena.nameSaved': '名称已保存',
    'arena.specialLabel': '特殊行为:',
    'arena.beh.berserker.name': '残血反杀',
    'arena.beh.berserker.desc': 'HP<10%: +200%攻击',
    'arena.beh.perfect_defense.name': '完美防御',
    'arena.beh.perfect_defense.desc': '护盾+50% CD-2s',
    'arena.beh.greedy_algorithm.name': '贪婪算法',
    'arena.beh.greedy_algorithm.desc': '拾取后+30%伤害',
    'arena.beh.dodge_master.name': '闪避大师',
    'arena.beh.dodge_master.desc': '闪避CD-40% 距离+1',
    'arena.league.master': '大师',
    'arena.league.gold': '金',
    'arena.league.silver': '银',
    'arena.league.bronze': '铜',
    'arena.statusDeployed': 'AI 已部署!',
    'arena.statusRecalled': 'AI 已召回',
    'arena.dailyCap': '今日已达上限(20场)',
    'arena.cooldown': '冷却中 {s}秒',
    'arena.paritySuspended': 'parity 违规已被禁赛',
    'arena.resultWin': '胜利!',
    'arena.resultLoss': '失败',
    'arena.resultDraw': '平局!',
    'arena.aeloLine': ' AELO {aelo} ({change}) ★{level}',
    'arena.replayUnavailable': '回放不可用',
    'arena.behaviorUpdated': '特殊行为已更新',
    'arena.deploying': '部署中...',
    'arena.replayHeader': '回放: {a} vs {b}',
    'arena.act.attack': '攻击',
    'arena.act.retreat': '撤退',
    'arena.act.chase': '追击',
    'arena.act.dash': '闪避突击',
    'arena.act.shieldRetreat': '护盾撤退',
    'arena.act.patrol': '巡逻',
    'arena.act.combo': '连招!',
    'arena.act.berserkerCombo': '残血连招!!',
    'arena.act.move': '移动',
    'arena.act.idle': '等待',
    'arena.replayStep': 't{tick}: {action} (HP: {hp})',
    'arena.matchHistory': '对战历史',
    'arena.noMatches': '暂无对战记录',
    'arena.res.win': '胜',
    'arena.res.draw': '平',
    'arena.res.loss': '负',
    'arena.vs': 'vs {name}',
    'arena.replayBtn': '[回放]',
    'arena.season.none': '无',
    'arena.week1': '风暴',
    'arena.week2': '竞赛',
    'arena.week3': '冲突',
    'arena.week4': '回顾',
    'arena.seasonLine': 'S{week}: 赛季 {weekLabel}  |  {buff}',
    'arena.buff.quantum_awaken.name': '量子觉醒',
    'arena.buff.quantum_awaken.desc': 'AI攻击倾向 +15%',
    'arena.buff.shadow_protocol.name': '暗影协议',
    'arena.buff.shadow_protocol.desc': 'AI闪避倾向 +15%',
    'arena.buff.entropy_crisis.name': '熵增危机',
    'arena.buff.entropy_crisis.desc': 'AI受伤时反击概率 +20%',
    'arena.tourRunning': '进行中',
    'arena.tourEnded': '已结束',
    'arena.tourLine': '巅峰赛 {status} | 第{round}/{total}轮',
    'arena.championLine': '冠军: {name}!',
    'arena.tourStart': '巅峰赛开始! {n} 名大师参赛',
    'arena.tourMatch': 'R{round}/{total}: {a} vs {b} → {w} ({score})',
    'arena.tourRound': '第{round}/{total}轮开始! 剩余{n}名选手',
    'arena.tourChampion': '巅峰赛冠军: {name}!',
    'arena.close': '[ 关闭 ]',
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
