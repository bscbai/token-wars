// Token Wars: 算力征途 - Lobby Scene
// Cyberpunk main menu with grid background and menu buttons
class LobbyScene extends Phaser.Scene {
  constructor() {
    super({ key: 'LobbyScene' });
  }

  create() {
    var self = this;
    var E = window.TokenWars.EVENTS;
    var W = this.scale.width;
    var H = this.scale.height;

    // ---- Background ----
    this.drawCyberpunkBackground(W, H);

    // ---- Title ----
    this.drawTitle(W, H);

    // ---- Player Info ----
    this.playerNameText = this.add.text(20, 20, '未连接', {
      fontFamily: '"Courier New", monospace',
      fontSize: '16px',
      color: '#00ff88'
    }).setDepth(10);

    this.tokenBalanceText = this.add.text(W - 20, 20, 'Token: --', {
      fontFamily: '"Courier New", monospace',
      fontSize: '16px',
      color: '#ffcc00',
      align: 'right'
    }).setOrigin(1, 0).setDepth(10);

    // ---- Menu Buttons ----
    var btnY = H * 0.35;
    var btnSpacing = 80;

    this.createMenuButton(W / 2, btnY, '⚔️ PvP 战斗大厅', function() {
      self.scene.start('CombatScene');
    });

    this.createMenuButton(W / 2, btnY + btnSpacing, '🤖 AI 竞技场', function() {
      self.scene.start('AIArenaScene');
    });

    this.createMenuButton(W / 2, btnY + btnSpacing * 2, '⛏️ 算力采掘', function() {
      window.NetworkManager.emit(E.MINE_START, {});
    });

    this.createMenuButton(W / 2, btnY + btnSpacing * 3, '📦 仓库 (即将开放)', null);

    this.createMenuButton(W / 2, btnY + btnSpacing * 4, '🏆 排行榜 (即将开放)', null);

    // Bottom hint
    this.add.text(W / 2, H - 30, '[ ESC 返回 ] [ 点击按钮选择 ]', {
      fontFamily: '"Courier New", monospace',
      fontSize: '12px',
      color: '#00ff4488'
    }).setOrigin(0.5).setDepth(10);

    // ---- Network ----
    this._setupNetwork(E);

    // ---- Input ----
    this.input.keyboard.on('keydown-ESC', function() {
      // On ESC, do nothing in lobby (already here)
    });
  }

  drawCyberpunkBackground(W, H) {
    var gfx = this.add.graphics();
    gfx.setDepth(0);

    // Dark background
    gfx.fillStyle(0x0a0a12, 1);
    gfx.fillRect(0, 0, W, H);

    // Grid lines
    var gridSize = 60;
    var gridAlpha = 0.08;
    gfx.lineStyle(1, 0x00ff44, gridAlpha);

    for (var x = 0; x <= W; x += gridSize) {
      gfx.beginPath();
      gfx.moveTo(x, 0);
      gfx.lineTo(x, H);
      gfx.strokePath();
    }

    for (var y = 0; y <= H; y += gridSize) {
      gfx.beginPath();
      gfx.moveTo(0, y);
      gfx.lineTo(W, y);
      gfx.strokePath();
    }

    // Horizonal scan lines
    gfx.lineStyle(1, 0x00ff44, 0.03);
    for (var ly = 0; ly < H; ly += 4) {
      gfx.beginPath();
      gfx.moveTo(0, ly);
      gfx.lineTo(W, ly);
      gfx.strokePath();
    }

    // Corner decorations
    var cornerSize = 40;
    gfx.lineStyle(2, 0x00ff44, 0.5);

    // Top-left
    gfx.beginPath();
    gfx.moveTo(20, 60);
    gfx.lineTo(20, 20);
    gfx.lineTo(60, 20);
    gfx.strokePath();

    // Top-right
    gfx.beginPath();
    gfx.moveTo(W - 60, 20);
    gfx.lineTo(W - 20, 20);
    gfx.lineTo(W - 20, 60);
    gfx.strokePath();

    // Bottom-left
    gfx.beginPath();
    gfx.moveTo(20, H - 60);
    gfx.lineTo(20, H - 20);
    gfx.lineTo(60, H - 20);
    gfx.strokePath();

    // Bottom-right
    gfx.beginPath();
    gfx.moveTo(W - 60, H - 20);
    gfx.lineTo(W - 20, H - 20);
    gfx.lineTo(W - 20, H - 60);
    gfx.strokePath();
  }

  drawTitle(W, H) {
    // Main title
    var title = this.add.text(W / 2, H * 0.18, 'TOKEN WARS', {
      fontFamily: '"Courier New", monospace',
      fontSize: '52px',
      color: '#00ff88',
      fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(10);

    // Glow effect via shadow
    title.setShadow(0, 0, '#00ff44', 12, true, true);

    // Subtitle
    var subtitle = this.add.text(W / 2, H * 0.18 + 55, '算 力 征 途', {
      fontFamily: '"SimHei", "Microsoft YaHei", "Courier New", monospace',
      fontSize: '28px',
      color: '#00cc66',
      fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(10);

    subtitle.setShadow(0, 0, '#00ff44', 4, true, true);

    // Subtle version text
    this.add.text(W / 2, H * 0.18 + 85, 'v1.0  CYBERPUNK EDITION', {
      fontFamily: '"Courier New", monospace',
      fontSize: '10px',
      color: '#00ff4466'
    }).setOrigin(0.5).setDepth(10);
  }

  createMenuButton(x, y, label, callback) {
    var self = this;

    // Button background
    var bg = this.add.graphics();
    bg.setDepth(5);
    bg.fillStyle(0x0a2a15, 0.9);
    bg.fillRoundedRect(x - 160, y - 22, 320, 44, 8);
    bg.lineStyle(1, 0x00ff44, 0.6);
    bg.strokeRoundedRect(x - 160, y - 22, 320, 44, 8);

    // Button text
    var txt = this.add.text(x, y, label, {
      fontFamily: '"Courier New", "SimHei", monospace',
      fontSize: '18px',
      color: '#00ff88'
    }).setOrigin(0.5).setDepth(10);

    // Make interactive
    var hitArea = this.add.rectangle(x, y, 320, 44, 0x000000, 0)
      .setInteractive({ useHandCursor: true })
      .setDepth(11);

    if (callback) {
      hitArea.on('pointerover', function() {
        self.tweens.add({
          targets: [bg, txt],
          scaleX: 1.05,
          scaleY: 1.05,
          duration: 150,
          ease: 'Power2'
        });
        bg.clear();
        bg.fillStyle(0x0a3a25, 1);
        bg.fillRoundedRect(x - 160, y - 22, 320, 44, 8);
        bg.lineStyle(2, 0x00ff88, 0.9);
        bg.strokeRoundedRect(x - 160, y - 22, 320, 44, 8);
        txt.setColor('#ffffff');
      });

      hitArea.on('pointerout', function() {
        self.tweens.add({
          targets: [bg, txt],
          scaleX: 1,
          scaleY: 1,
          duration: 150,
          ease: 'Power2'
        });
        bg.clear();
        bg.fillStyle(0x0a2a15, 0.9);
        bg.fillRoundedRect(x - 160, y - 22, 320, 44, 8);
        bg.lineStyle(1, 0x00ff44, 0.6);
        bg.strokeRoundedRect(x - 160, y - 22, 320, 44, 8);
        txt.setColor('#00ff88');
      });

      hitArea.on('pointerdown', function() {
        callback();
      });
    }

    return { bg: bg, txt: txt, hitArea: hitArea };
  }

  _setupNetwork(E) {
    var self = this;

    // Connect on scene create
    window.NetworkManager.connect('');

    window.NetworkManager.on(E.CONNECT, function() {
      self.playerNameText.setText('已连接');
    });

    window.NetworkManager.on(E.DISCONNECT, function() {
      self.playerNameText.setText('已断开');
    });

    window.NetworkManager.on(E.TOKEN_UPDATE, function(data) {
      if (data && data.balance !== undefined) {
        self.tokenBalanceText.setText('Token: ' + data.balance);
      }
    });

    window.NetworkManager.on(E.ROOM_UPDATE, function(data) {
      if (data && data.players !== undefined) {
        self.playerNameText.setText('大厅玩家: ' + data.players + '人');
      }
    });

    window.NetworkManager.on(E.PLAYER_JOINED, function(data) {
      // Optional: show join notification
    });

    window.NetworkManager.on(E.PLAYER_LEFT, function(data) {
      // Optional: show leave notification
    });
  }
}
