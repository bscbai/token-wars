import net from '../systems/NetworkManager.js';

export class LoginScene extends Phaser.Scene {
  constructor() {
    super({ key: 'LoginScene' });
    this.isRegister = false;
  }

  create() {
    net.connect();

    const cx = 480;
    const cy = 320;

    // Title
    this.add.text(cx, 100, 'TOKEN WARS', {
      fontSize: '48px', fontFamily: 'Courier New', color: '#00ff88',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    this.add.text(cx, 150, '算力征途', {
      fontSize: '24px', fontFamily: 'Courier New', color: '#008866',
    }).setOrigin(0.5);

    // Form container
    this.formGroup = this.add.container(cx, cy);

    // Username label + input
    this.add.text(-120, -60, '用户名:', { fontSize: '16px', color: '#00ff88', fontFamily: 'Courier New' });
    this.usernameText = this.add.text(-120, -35, '', { fontSize: '18px', color: '#ffffff', fontFamily: 'Courier New' });
    this.usernameUnderline = this.add.rectangle(-120 + 75, -22, 200, 2, 0x00ff88);

    // Password label + input
    this.add.text(-120, 10, '密码:', { fontSize: '16px', color: '#00ff88', fontFamily: 'Courier New' });
    this.passwordText = this.add.text(-120, 35, '', { fontSize: '18px', color: '#ffffff', fontFamily: 'Courier New' });
    this.passwordUnderline = this.add.rectangle(-120 + 75, 48, 200, 2, 0x00ff88);

    // Cursor blink
    this.activeField = 'username'; // 'username' or 'password'
    this.cursorVisible = true;
    this.time.addEvent({ delay: 500, loop: true, callback: () => {
      this.cursorVisible = !this.cursorVisible;
    }});

    // Toggle button
    this.toggleBtn = this.add.text(cx, cy + 110, '[ 注册新账号 ]', {
      fontSize: '14px', color: '#008866', fontFamily: 'Courier New',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    this.toggleBtn.on('pointerdown', () => {
      this.isRegister = !this.isRegister;
      this.toggleBtn.setText(this.isRegister ? '[ 返回登录 ]' : '[ 注册新账号 ]');
      this.actionBtn.setText(this.isRegister ? '注册' : '登录');
    });

    // Action button
    this.actionBtn = this.add.text(cx, cy + 150, '登录', {
      fontSize: '24px', color: '#00ff88', fontFamily: 'Courier New', fontStyle: 'bold',
      backgroundColor: '#1a3a2e', padding: { x: 30, y: 10 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    this.actionBtn.on('pointerdown', () => this.submit());

    // Status text
    this.statusText = this.add.text(cx, cy + 200, '', {
      fontSize: '14px', color: '#ff4444', fontFamily: 'Courier New',
    }).setOrigin(0.5);

    // Keyboard input
    this.input.keyboard.on('keydown', (event) => {
      if (event.key === 'Tab') {
        this.activeField = this.activeField === 'username' ? 'password' : 'username';
        return;
      }
      if (event.key === 'Enter') {
        this.submit();
        return;
      }

      const field = this.activeField === 'username' ? this.usernameText : this.passwordText;
      const current = field.getData ? field.getData('raw') || '' : '';

      if (event.key === 'Backspace') {
        const newVal = current.slice(0, -1);
        field.setData('raw', newVal);
        field.setText(this.activeField === 'password' ? '*'.repeat(newVal.length) : newVal);
      } else if (event.key.length === 1 && current.length < 16) {
        const newVal = current + event.key;
        field.setData('raw', newVal);
        field.setText(this.activeField === 'password' ? '*'.repeat(newVal.length) : newVal);
      }
    });

    // Listen for auth responses
    net.on('auth:success', (data) => {
      this.statusText.setColor('#00ff88');
      this.statusText.setText('登录成功!');
      net.setSession(net.sessionToken, data.playerId);
      this.scene.start('LobbyScene', { player: data.player });
    });

    // Store session token from REST response
    this.net = net;
  }

  async submit() {
    const username = (this.usernameText.getData && this.usernameText.getData('raw')) || '';
    const password = (this.passwordText.getData && this.passwordText.getData('raw')) || '';

    if (!username || !password) {
      this.statusText.setText('请输入用户名和密码');
      return;
    }

    this.statusText.setColor('#ffff00');
    this.statusText.setText(this.isRegister ? '注册中...' : '登录中...');

    const endpoint = this.isRegister ? '/api/auth/register' : '/api/auth/login';

    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await resp.json();

      if (!resp.ok) {
        this.statusText.setColor('#ff4444');
        this.statusText.setText(data.error || '请求失败');
        return;
      }

      // Store session and authenticate via socket
      this.net.setSession(data.sessionToken, data.player.id);
      this.net.emit('auth:login', { token: data.sessionToken });

      // Navigate via socket auth:success callback (registered in create())
      // No duplicate navigation here — the auth:success listener handles it
      this.statusText.setColor('#00ff88');
      this.statusText.setText('登录成功! 正在进入...');
    } catch (err) {
      this.statusText.setColor('#ff4444');
      this.statusText.setText('连接服务器失败');
    }
  }
}
