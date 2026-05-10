import net from '../systems/NetworkManager.js';

export class LobbyScene extends Phaser.Scene {
  constructor() {
    super({ key: 'LobbyScene' });
  }

  init(data) {
    this.playerData = data.player;
  }

  create() {
    const cx = 480;

    // Title
    this.add.text(cx, 40, '算力核心大厅', {
      fontSize: '32px', fontFamily: 'Courier New', color: '#00ff88', fontStyle: 'bold',
    }).setOrigin(0.5);

    // Player info panel
    this.drawPlayerInfo(cx, 100);

    // Navigation buttons
    const buttons = [
      { label: '⛏  挂机挖矿', scene: 'MiningScene', color: '#00aaff' },
      { label: '⚔  PvE 副本', scene: 'DungeonSelectScene', color: '#ff4444' },
      { label: '🏟  PvP 竞技场', scene: 'PvPScene', color: '#ff8800' },
      { label: '🛒  算力商城', scene: 'ShopScene', color: '#aa44ff' },
      { label: '🎒  背包 & 技能盘', scene: 'InventoryScene', color: '#44ffaa' },
    ];

    buttons.forEach((btn, i) => {
      const y = 280 + i * 60;
      const rect = this.add.rectangle(cx, y, 300, 45, Phaser.Display.Color.HexStringToColor(btn.color.replace('#', '')).color, 0.15)
        .setStrokeStyle(2, Phaser.Display.Color.HexStringToColor(btn.color.replace('#', '')).color)
        .setInteractive({ useHandCursor: true });

      const text = this.add.text(cx, y, btn.label, {
        fontSize: '20px', fontFamily: 'Courier New', color: btn.color, fontStyle: 'bold',
      }).setOrigin(0.5);

      rect.on('pointerover', () => {
        rect.setFillStyle(Phaser.Display.Color.HexStringToColor(btn.color.replace('#', '')).color, 0.3);
      });
      rect.on('pointerout', () => {
        rect.setFillStyle(Phaser.Display.Color.HexStringToColor(btn.color.replace('#', '')).color, 0.15);
      });
      rect.on('pointerdown', () => {
        if (this.scene.manager.keys[btn.scene]) {
          this.scene.start(btn.scene, { player: this.playerData });
        } else {
          // Scene not yet implemented
          this.statusText.setText(`${btn.label} — 即将开放`);
          this.time.delayedCall(2000, () => this.statusText.setText(''));
        }
      });
    });

    // Status text for unimplemented features
    this.statusText = this.add.text(cx, 590, '', {
      fontSize: '14px', color: '#ffff00', fontFamily: 'Courier New',
    }).setOrigin(0.5);

    // Listen for player updates
    net.on('player:update', (data) => {
      this.playerData = { ...this.playerData, ...data };
      this.refreshPlayerInfo();
    });
  }

  drawPlayerInfo(cx, y) {
    const p = this.playerData;

    // Background panel
    this.add.rectangle(cx, y + 40, 500, 120, 0x111122, 0.8)
      .setStrokeStyle(1, 0x00ff88, 0.5);

    // Player name + level
    this.nameText = this.add.text(cx - 230, y, `${p.username}  Lv.${p.level}`, {
      fontSize: '20px', fontFamily: 'Courier New', color: '#00ff88', fontStyle: 'bold',
    });

    // HP bar
    this.add.text(cx - 230, y + 30, 'HP:', { fontSize: '14px', color: '#888', fontFamily: 'Courier New' });
    this.hpBarBg = this.add.rectangle(cx - 150, y + 37, 200, 12, 0x333333).setOrigin(0, 0.5);
    this.hpBar = this.add.rectangle(cx - 150, y + 37, 200 * (p.hp / p.maxHp), 12, 0x00ff44).setOrigin(0, 0.5);
    this.hpText = this.add.text(cx + 60, y + 30, `${p.hp}/${p.maxHp}`, {
      fontSize: '12px', color: '#aaa', fontFamily: 'Courier New',
    });

    // XP bar
    this.add.text(cx - 230, y + 50, 'XP:', { fontSize: '14px', color: '#888', fontFamily: 'Courier New' });
    this.xpBarBg = this.add.rectangle(cx - 150, y + 57, 200, 12, 0x333333).setOrigin(0, 0.5);
    this.xpBar = this.add.rectangle(cx - 150, y + 57, 200 * (p.xp / p.xpToNext), 12, 0x8844ff).setOrigin(0, 0.5);

    // Stats
    this.add.text(cx + 120, y, `ATK: ${p.atk}`, { fontSize: '14px', color: '#ff4444', fontFamily: 'Courier New' });
    this.add.text(cx + 120, y + 20, `DEF: ${p.def}`, { fontSize: '14px', color: '#4488ff', fontFamily: 'Courier New' });

    // Tokens
    this.add.text(cx - 230, y + 75, `稳定Token: ${p.stableTokens.length}  |  不稳定Token: ${p.unstableTokens}  |  积分: ${p.credits}`, {
      fontSize: '13px', color: '#aaaaaa', fontFamily: 'Courier New',
    });

    // PvP rating
    this.add.text(cx + 120, y + 45, `PvP: ${p.pvpRating}`, {
      fontSize: '13px', color: '#ff8800', fontFamily: 'Courier New',
    });
  }

  refreshPlayerInfo() {
    // Simple refresh — recreate would be cleaner but this works for MVP
    // In production, update individual text objects
  }
}
