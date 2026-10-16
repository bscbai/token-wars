/**
 * langToggle — 全局悬浮语言切换按钮（挂载一次，所有场景可见）
 *
 * 语言切换不依赖具体场景：即使进入尚未翻译的场景，玩家也能随时切回英文。
 * 按钮显示「对侧语言名」（中文界面显示 EN，英文界面显示 中文）。
 */

import { getLang, setLang, onLangChange } from './i18n.js';

export function mountLangToggle() {
  const container = document.getElementById('game-container');
  if (!container || document.getElementById('tw-lang-toggle')) return null;

  const btn = document.createElement('button');
  btn.id = 'tw-lang-toggle';
  btn.type = 'button';
  btn.style.cssText = `
    position: absolute; top: 12px; right: 12px; z-index: 30;
    padding: 4px 12px; font-size: 13px; font-family: 'Courier New', monospace;
    background: rgba(10, 10, 26, 0.75); color: #00ff88;
    border: 1px solid #00ff88; border-radius: 4px; cursor: pointer;
  `;
  btn.onclick = () => setLang(getLang() === 'zh' ? 'en' : 'zh');

  const refresh = () => { btn.textContent = getLang() === 'zh' ? 'EN' : '中文'; };
  refresh();
  onLangChange(refresh);

  container.appendChild(btn);
  return btn;
}
