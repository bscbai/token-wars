import net from '../systems/NetworkManager.js';

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
    this.add.text(cx, 130, '算力征途', {
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
    userLabel.textContent = '用户名:';
    userLabel.style.cssText = 'color: #00ff88; font-size: 14px; align-self: flex-start;';
    this.usernameInput = document.createElement('input');
    this.usernameInput.type = 'text';
    this.usernameInput.placeholder = '2-16 个字符';
    this.usernameInput.maxLength = 16;
    this.usernameInput.style.cssText = `
      width: 260px; padding: 8px 12px; font-size: 16px; font-family: 'Courier New', monospace;
      background: #0d0d20; color: #ffffff; border: 1px solid #00ff88; border-radius: 4px;
      outline: none; box-sizing: border-box;
    `;

    // Password
    const passLabel = document.createElement('label');
    passLabel.textContent = '密  码:';
    passLabel.style.cssText = 'color: #00ff88; font-size: 14px; align-self: flex-start;';
    this.passwordInput = document.createElement('input');
    this.passwordInput.type = 'password';
    this.passwordInput.placeholder = '至少 4 个字符';
    this.passwordInput.minLength = 4;
    this.passwordInput.style.cssText = this.usernameInput.style.cssText;

    // Action button — use onclick to avoid Phaser event capture issues
    const self = this;
    this.actionBtn = document.createElement('button');
    this.actionBtn.textContent = '登  录';
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
    this.toggleLink.textContent = '注册新账号';
    this.toggleLink.href = '#';
    this.toggleLink.style.cssText = 'color: #008866; font-size: 13px; margin-top: 4px; text-decoration: none;';
    this.toggleLink.onclick = function(e) {
      e.preventDefault();
      self.isRegister = !self.isRegister;
      self.actionBtn.textContent = self.isRegister ? '注  册' : '登  录';
      self.toggleLink.textContent = self.isRegister ? '返回登录' : '注册新账号';
      self.statusSpan.textContent = '';
    };

    // Status text
    this.statusSpan = document.createElement('span');
    this.statusSpan.style.cssText = 'color: #ff4444; font-size: 13px; margin-top: 4px; min-height: 18px;';

    // Assemble form
    this.formDiv.appendChild(userLabel);
    this.formDiv.appendChild(this.usernameInput);
    this.formDiv.appendChild(passLabel);
    this.formDiv.appendChild(this.passwordInput);
    this.formDiv.appendChild(this.actionBtn);
    this.formDiv.appendChild(this.toggleLink);
    this.formDiv.appendChild(this.statusSpan);
    gameContainer.appendChild(this.formDiv);

    // Enter key submits
    this.passwordInput.onkeydown = function(e) {
      if (e.key === 'Enter') self.submit();
    };
    this.usernameInput.onkeydown = function(e) {
      if (e.key === 'Enter') self.passwordInput.focus();
    };

    // Focus username
    this.usernameInput.focus();

    // Listen for auth responses
    net.on('auth:success', (data) => {
      this.statusSpan.style.color = '#00ff88';
      this.statusSpan.textContent = '登录成功!';
      net.setSession(net.sessionToken, data.playerId);
      this._pendingTransition = data.player;
    });

    net.on('auth:fail', (data) => {
      this.statusSpan.style.color = '#ff4444';
      this.statusSpan.textContent = data.reason || '认证失败';
      this.actionBtn.disabled = false;
      this.actionBtn.style.opacity = '1';
    });
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
  }

  async submit() {
    const username = this.usernameInput.value.trim();
    const password = this.passwordInput.value;

    if (!username || !password) {
      this.statusSpan.style.color = '#ff4444';
      this.statusSpan.textContent = '请输入用户名和密码';
      return;
    }
    if (username.length < 2) {
      this.statusSpan.style.color = '#ff4444';
      this.statusSpan.textContent = '用户名至少 2 个字符';
      return;
    }
    if (password.length < 4) {
      this.statusSpan.style.color = '#ff4444';
      this.statusSpan.textContent = '密码至少 4 个字符';
      return;
    }

    this.statusSpan.style.color = '#ffff00';
    this.statusSpan.textContent = this.isRegister ? '注册中...' : '登录中...';
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
        this.statusSpan.textContent = data.error || '请求失败';
        this.actionBtn.disabled = false;
        this.actionBtn.style.opacity = '1';
        return;
      }

      net.setSession(data.sessionToken, data.player.id);
      // Connect with the JWT in the handshake — the server authenticates
      // via io.use() middleware and emits auth:success directly.
      net.connect(data.sessionToken);

      this.statusSpan.style.color = '#00ff88';
      this.statusSpan.textContent = '登录成功! 正在进入...';
    } catch (err) {
      this.statusSpan.style.color = '#ff4444';
      this.statusSpan.textContent = '连接服务器失败';
      this.actionBtn.disabled = false;
      this.actionBtn.style.opacity = '1';
    }
  }
}
