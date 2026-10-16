import net from '../systems/NetworkManager.js';
import { t, getLang, setLang, onLangChange } from '../i18n.js';

export class LoginScene extends Phaser.Scene {
  constructor() {
    super({ key: 'LoginScene' });
    this.isRegister = false;
    this._pendingTransition = null;
  }

  create() {
    // Socket connection is deferred until we have a token (see submit()).
    // The server's io.use() middleware rejects connections without a valid JWT.

    // Disable Phaser input so DOM clicks work
    this.input.enabled = false;

    const cx = 480;
    const cy = 280;

    // Title
    this.add.text(cx, 80, 'TOKEN WARS', {
      fontSize: '48px', fontFamily: 'Courier New', color: '#00ff88',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    this.subtitleText = this.add.text(cx, 130, t('login.subtitle'), {
      fontSize: '24px', fontFamily: 'Courier New', color: '#008866',
    }).setOrigin(0.5);

    // --- DOM input fields (overlay on canvas) ---
    const gameContainer = document.getElementById('game-container');

    // Wrapper div
    this.formDiv = document.createElement('div');
    this.formDiv.style.cssText = `
      position: absolute; left: 50%; top: ${cy - 40}px; transform: translateX(-50%);
      display: flex; flex-direction: column; align-items: center; gap: 8px;
      font-family: 'Courier New', monospace; z-index: 10;
    `;

    // Username
    const userLabel = document.createElement('label');
    userLabel.style.cssText = 'color: #00ff88; font-size: 14px; align-self: flex-start;';
    this.usernameInput = document.createElement('input');
    this.usernameInput.type = 'text';
    this.usernameInput.maxLength = 16;
    this.usernameInput.style.cssText = `
      width: 260px; padding: 8px 12px; font-size: 16px; font-family: 'Courier New', monospace;
      background: #0d0d20; color: #ffffff; border: 1px solid #00ff88; border-radius: 4px;
      outline: none; box-sizing: border-box;
    `;

    // Password
    const passLabel = document.createElement('label');
    passLabel.style.cssText = 'color: #00ff88; font-size: 14px; align-self: flex-start;';
    this.passwordInput = document.createElement('input');
    this.passwordInput.type = 'password';
    this.passwordInput.minLength = 4;
    this.passwordInput.style.cssText = this.usernameInput.style.cssText;

    // Action button — use onclick to avoid Phaser event capture issues
    const self = this;
    this.actionBtn = document.createElement('button');
    this.actionBtn.style.cssText = `
      width: 260px; padding: 10px; font-size: 20px; font-family: 'Courier New', monospace;
      background: #1a3a2e; color: #00ff88; border: 2px solid #00ff88; border-radius: 4px;
      cursor: pointer; font-weight: bold; margin-top: 8px;
    `;
    this.actionBtn.onclick = function() { self.submit(); };
    this.actionBtn.onmouseenter = function() { self.actionBtn.style.background = '#2a5a4e'; };
    this.actionBtn.onmouseleave = function() { self.actionBtn.style.background = '#1a3a2e'; };

    // Toggle link
    this.toggleLink = document.createElement('a');
    this.toggleLink.href = '#';
    this.toggleLink.style.cssText = 'color: #008866; font-size: 13px; margin-top: 4px; text-decoration: none;';
    this.toggleLink.onclick = function(e) {
      e.preventDefault();
      self.isRegister = !self.isRegister;
      self.applyLang();
      self.setStatus(null);
    };

    // Language toggle (shows the OTHER language name)
    this.langBtn = document.createElement('button');
    this.langBtn.style.cssText = `
      position: absolute; top: 12px; right: 12px; z-index: 20;
      padding: 4px 12px; font-size: 13px; font-family: 'Courier New', monospace;
      background: transparent; color: #00ff88; border: 1px solid #00ff88; border-radius: 4px;
      cursor: pointer;
    `;
    this.langBtn.onclick = function() {
      setLang(getLang() === 'zh' ? 'en' : 'zh');
    };

    // Status text
    this.statusSpan = document.createElement('span');
    this.statusSpan.style.cssText = 'color: #ff4444; font-size: 13px; margin-top: 4px; min-height: 18px;';

    // Assemble form
    this.userLabelEl = userLabel;
    this.passLabelEl = passLabel;
    this.formDiv.appendChild(userLabel);
    this.formDiv.appendChild(this.usernameInput);
    this.formDiv.appendChild(passLabel);
    this.formDiv.appendChild(this.passwordInput);
    this.formDiv.appendChild(this.actionBtn);
    this.formDiv.appendChild(this.toggleLink);
    this.formDiv.appendChild(this.statusSpan);
    gameContainer.appendChild(this.formDiv);
    gameContainer.appendChild(this.langBtn);

    // Enter key submits
    this.passwordInput.onkeydown = function(e) {
      if (e.key === 'Enter') self.submit();
    };
    this.usernameInput.onkeydown = function(e) {
      if (e.key === 'Enter') self.passwordInput.focus();
    };

    // Focus username
    this.usernameInput.focus();

    // Static texts (labels / placeholders / buttons / html lang)
    this.applyLang();
    this.syncDocumentMeta();

    // Live language switching: refresh canvas + DOM without reload
    this._offLang = onLangChange(() => {
      this.subtitleText.setText(t('login.subtitle'));
      this.applyLang();
      this.syncDocumentMeta();
    });
    this.events.once('shutdown', () => { if (this._offLang) this._offLang(); });

    // Listen for auth responses
    net.on('auth:success', (data) => {
      this.setStatus('login.success', null, '#00ff88');
      net.setSession(net.sessionToken, data.playerId);
      this._pendingTransition = data.player;
    });

    net.on('auth:fail', (data) => {
      // Server-provided reason is shown verbatim (server message translation out of scope)
      this.statusSpan.style.color = '#ff4444';
      this.statusSpan.textContent = data.reason || t('login.authFail');
      this.actionBtn.disabled = false;
      this.actionBtn.style.opacity = '1';
    });
  }

  /** 刷新所有静态文案（含登录/注册模式差异） */
  applyLang() {
    this.userLabelEl.textContent = t('login.username');
    this.usernameInput.placeholder = t('login.usernamePlaceholder');
    this.passLabelEl.textContent = t('login.password');
    this.passwordInput.placeholder = t('login.passwordPlaceholder');
    this.actionBtn.textContent = this.isRegister ? t('login.register') : t('login.login');
    this.toggleLink.textContent = this.isRegister ? t('login.toLogin') : t('login.toRegister');
    this.langBtn.textContent = getLang() === 'zh' ? 'EN' : '中文';
  }

  /** <html lang> 与 <title> 跟随当前语言 */
  syncDocumentMeta() {
    const zh = getLang() === 'zh';
    document.documentElement.lang = zh ? 'zh-CN' : 'en';
    document.title = zh ? 'Token Wars: 算力征途' : 'Token Wars';
  }

  /** 状态条：key 为字典键（null 清空）；vars 用于插值 */
  setStatus(key, vars = null, color = '#ff4444') {
    this.statusSpan.style.color = color;
    this.statusSpan.textContent = key ? t(key, vars) : '';
  }

  update() {
    if (this._pendingTransition) {
      const playerData = this._pendingTransition;
      this._pendingTransition = null;
      this.cleanup();
      this.scene.start('LobbyScene', { player: playerData });
    }
  }

  cleanup() {
    if (this.formDiv && this.formDiv.parentNode) {
      this.formDiv.parentNode.removeChild(this.formDiv);
    }
    if (this.langBtn && this.langBtn.parentNode) {
      this.langBtn.parentNode.removeChild(this.langBtn);
    }
  }

  async submit() {
    const username = this.usernameInput.value.trim();
    const password = this.passwordInput.value;

    if (!username || !password) {
      this.setStatus('login.enterBoth');
      return;
    }
    if (username.length < 2) {
      this.setStatus('login.usernameMin');
      return;
    }
    if (password.length < 4) {
      this.setStatus('login.passwordMin');
      return;
    }

    this.setStatus(this.isRegister ? 'login.registering' : 'login.loggingIn', null, '#ffff00');
    this.actionBtn.disabled = true;
    this.actionBtn.style.opacity = '0.6';

    const endpoint = this.isRegister ? '/api/auth/register' : '/api/auth/login';

    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await resp.json();

      if (!resp.ok) {
        this.statusSpan.style.color = '#ff4444';
        this.statusSpan.textContent = data.error || t('login.requestFailed');
        this.actionBtn.disabled = false;
        this.actionBtn.style.opacity = '1';
        return;
      }

      net.setSession(data.sessionToken, data.player.id);
      // Connect with the JWT in the handshake — the server authenticates
      // via io.use() middleware and emits auth:success directly.
      net.connect(data.sessionToken);

      this.setStatus('login.successEntering', null, '#00ff88');
    } catch (err) {
      this.setStatus('login.connectFailed');
      this.actionBtn.disabled = false;
      this.actionBtn.style.opacity = '1';
    }
  }
}
