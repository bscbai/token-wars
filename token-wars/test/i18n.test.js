/**
 * i18n 纯逻辑测试（openspec/changes/archive/client-i18n design D4）
 * —— t 回退/插值、setLang 持久化与订阅、detectLang 探测、字典完整。
 * Phaser/DOM 渲染不在自动化范围。
 *
 * 注意：测试机本身可能是中文环境（Node 24 全局 navigator.language=zh-CN），
 * 故不假设模块初始语言；detectLang 的探测分支用 vi.resetModules() 后
 * 静态路径动态导入，让模块以受控的 localStorage/navigator 重新求值。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const MODULE_PATH = '../client/src/i18n.js';

const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const originalNavigator = globalThis.navigator;
const originalLsDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const originalLocalStorage = globalThis.localStorage;

/** Node 中 navigator/localStorage 为只读 getter，须用 defineProperty 替换 */
function replaceGlobal(name, value) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}
function restoreGlobal(name, desc, originalValue) {
  if (desc) Object.defineProperty(globalThis, name, desc);
  else Object.defineProperty(globalThis, name, { value: originalValue, configurable: true, writable: true });
}

function fakeStorage(initial = []) {
  const store = new Map(initial);
  return {
    store,
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };
}

/** 受控环境下重新求值模块 */
async function freshModule({ storage, nav } = {}) {
  vi.resetModules();
  replaceGlobal('localStorage', storage);
  replaceGlobal('navigator', nav);
  return await import(MODULE_PATH);
}

afterEach(() => {
  restoreGlobal('localStorage', originalLsDescriptor, originalLocalStorage);
  restoreGlobal('navigator', originalDescriptor, originalNavigator);
});

describe('t() 翻译与回退', () => {
  it('英文/中文文案切换', async () => {
    const i18n = await freshModule({ storage: undefined, nav: { language: 'en-US' } });
    expect(i18n.t('login.login')).toBe('Login');
    expect(i18n.t('lobby.title')).toBe('Compute Core Lobby');
    i18n.setLang('zh');
    expect(i18n.t('login.login')).toBe('登  录');
    expect(i18n.t('lobby.title')).toBe('算力核心大厅');
  });

  it('缺失 key 回退到 key 本身（不抛错）', async () => {
    const i18n = await freshModule({ storage: undefined, nav: { language: 'en-US' } });
    expect(i18n.t('nope.nope')).toBe('nope.nope');
    i18n.setLang('zh');
    expect(i18n.t('nope.nope')).toBe('nope.nope');
  });

  it('变量插值替换 {name}；缺失变量保留占位', async () => {
    const i18n = await freshModule({ storage: undefined, nav: { language: 'en-US' } });
    expect(i18n.t('lobby.renderError', { msg: 'boom' })).toBe('Render error: boom');
    i18n.setLang('zh');
    expect(i18n.t('lobby.renderError', { msg: '爆炸' })).toBe('渲染错误: 爆炸');
    expect(i18n.t('lobby.renderError')).toBe('渲染错误: {msg}');
  });
});

describe('setLang / 订阅 / 持久化', () => {
  it('setLang 通知订阅者；取消订阅后不再收到；不支持的语言忽略', async () => {
    const i18n = await freshModule({ storage: undefined, nav: { language: 'en-US' } });
    const seen = [];
    const off = i18n.onLangChange((lang) => seen.push(lang));
    i18n.setLang('zh');
    i18n.setLang('bogus');
    off();
    i18n.setLang('en');
    expect(seen).toEqual(['zh']);
    expect(i18n.getLang()).toBe('en');
  });

  it('setLang 持久化到 localStorage', async () => {
    const storage = fakeStorage();
    const i18n = await freshModule({ storage, nav: { language: 'en-US' } });
    i18n.setLang('zh');
    expect(storage.store.get(i18n.STORAGE_KEY)).toBe('zh');
  });
});

describe('detectLang 探测', () => {
  it('无存储且无 navigator → 英文兜底', async () => {
    const mod = await freshModule({ storage: undefined, nav: undefined });
    expect(mod.detectLang()).toBe('en');
    expect(mod.getLang()).toBe('en');
  });

  it('navigator.language=zh* → 中文；其他语言 → 英文', async () => {
    expect((await freshModule({ storage: undefined, nav: { language: 'zh-CN' } })).getLang()).toBe('zh');
    expect((await freshModule({ storage: undefined, nav: { language: 'fr-FR' } })).getLang()).toBe('en');
  });

  it('localStorage 显式选择优先于浏览器语言', async () => {
    const storage = fakeStorage([['tw-lang', 'en']]);
    const mod = await freshModule({ storage, nav: { language: 'zh-CN' } });
    expect(mod.detectLang()).toBe('en');
    expect(mod.getLang()).toBe('en');
  });

  it('存储的非法值被忽略，回退浏览器探测', async () => {
    const storage = fakeStorage([['tw-lang', 'jp']]);
    expect((await freshModule({ storage, nav: { language: 'de-DE' } })).getLang()).toBe('en');
    expect((await freshModule({ storage, nav: { language: 'zh-TW' } })).getLang()).toBe('zh');
  });
});

describe('字典完备性', () => {
  const KEYS = [
    'login.subtitle', 'login.username', 'login.usernamePlaceholder', 'login.password',
    'login.passwordPlaceholder', 'login.login', 'login.register', 'login.toRegister',
    'login.toLogin', 'login.success', 'login.successEntering', 'login.authFail',
    'login.enterBoth', 'login.usernameMin', 'login.passwordMin', 'login.registering',
    'login.loggingIn', 'login.requestFailed', 'login.connectFailed',
    'lobby.title', 'lobby.errNoPlayer', 'lobby.renderError', 'lobby.comingSoon',
    'lobby.mining', 'lobby.pve', 'lobby.pvp', 'lobby.aiarena', 'lobby.shop',
    'lobby.inventory', 'lobby.stable', 'lobby.unstable', 'lobby.credits',
  ];

  it('SUPPORTED_LANGS 恰为 en/zh', async () => {
    const i18n = await freshModule({ storage: undefined, nav: { language: 'en-US' } });
    expect([...i18n.SUPPORTED_LANGS].sort()).toEqual(['en', 'zh']);
  });

  it('全部已知键在 en/zh 下均有非空翻译（未回退到 key 本身）', async () => {
    const i18n = await freshModule({ storage: undefined, nav: { language: 'en-US' } });
    for (const lang of ['en', 'zh']) {
      i18n.setLang(lang);
      for (const key of KEYS) {
        const val = i18n.t(key);
        expect(val, `${lang}:${key}`).not.toBe(key);
        expect(val.length, `${lang}:${key}`).toBeGreaterThan(0);
      }
    }
  });
});
