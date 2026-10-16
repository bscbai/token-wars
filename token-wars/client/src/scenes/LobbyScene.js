import net from '../systems/NetworkManager.js';
import { t, onLangChange } from '../i18n.js';

export class LobbyScene extends Phaser.Scene {
  constructor() {
    super({ key: 'LobbyScene' });
  }

  init(data) {
    this.playerData = data ? data.player : null;
  }

  create() {
    try {
      if (!this.playerData) {
        console.error('[Lobby] No player data!');
        this.add.text(480, 320, t('lobby.errNoPlayer'), { fontSize: '20px', color: '#ff4444' }).setOrigin(0.5);
        return;
      }

      const cx = 480;

      // Title
      this.titleText = this.add.text(cx, 40, t('lobby.title'), {
        fontSize: '32px', fontFamily: 'Courier New', color: '#00ff88', fontStyle: 'bold',
      }).setOrigin(0.5);

      // Player info panel
      this.drawPlayerInfo(cx, 100);

      // Navigation buttons (labels are i18n keys; re-rendered on language change)
      const buttons = [
        { key: 'lobby.mining', scene: 'MiningScene', color: '#00aaff' },
        { key: 'lobby.pve', scene: 'DungeonSelectScene', color: '#ff4444' },
        { key: 'lobby.pvp', scene: 'PvPScene', color: '#ff8800' },
        { key: 'lobby.aiarena', scene: 'AIArenaScene', color: '#44ffaa' },
        { key: 'lobby.shop', scene: 'ShopScene', color: '#aa44ff' },
        { key: 'lobby.inventory', scene: 'InventoryScene', color: '#44ffaa' },
      ];
      this.navButtons = [];

      buttons.forEach((btn, i) => {
        const y = 280 + i * 60;
        const colorInt = Phaser.Display.Color.HexStringToColor(btn.color).color;

        const rect = this.add.rectangle(cx, y, 300, 45, colorInt, 0.15)
          .setStrokeStyle(2, colorInt)
          .setInteractive({ useHandCursor: true });

        const text = this.add.text(cx, y, t(btn.key), {
          fontSize: '20px', fontFamily: 'Courier New', color: btn.color, fontStyle: 'bold',
        }).setOrigin(0.5);
        this.navButtons.push({ text, key: btn.key });

        rect.on('pointerover', () => rect.setFillStyle(colorInt, 0.3));
        rect.on('pointerout', () => rect.setFillStyle(colorInt, 0.15));
        rect.on('pointerdown', () => {
          if (this.scene.manager.keys[btn.scene]) {
            this.scene.start(btn.scene, { player: this.playerData });
          } else {
            this.statusText.setText(t(btn.key) + t('lobby.comingSoon'));
            this.time.delayedCall(2000, () => this.statusText.setText(''));
          }
        });
      });

      // Status text
      this.statusText = this.add.text(cx, 590, '', {
        fontSize: '14px', color: '#ffff00', fontFamily: 'Courier New',
      }).setOrigin(0.5);

      // Listen for player updates
      net.on('player:update', (data) => {
        this.playerData = { ...this.playerData, ...data };
        this.refreshPlayerInfo();
      });

      // Live language switching: refresh title / nav / player info
      this._offLang = onLangChange(() => {
        this.titleText.setText(t('lobby.title'));
        for (const { text, key } of this.navButtons) text.setText(t(key));
        this.refreshPlayerInfo();
      });
      this.events.once('shutdown', () => { if (this._offLang) this._offLang(); });

      console.log('[Lobby] create() OK');
    } catch (e) {
      console.error('[Lobby] create() error:', e.message, e.stack);
      this.add.text(480, 320, t('lobby.renderError', { msg: e.message }), { fontSize: '14px', color: '#ff4444' }).setOrigin(0.5);
    }
  }

  /** Token / credits summary line (localized) */
  formatTokenLine(p) {
    const stableCount = Array.isArray(p.stableTokens) ? p.stableTokens.length : 0;
    return t('lobby.stable') + stableCount + '  |  ' +
      t('lobby.unstable') + (p.unstableTokens || 0) + '  |  ' +
      t('lobby.credits') + (p.credits || 0);
  }

  drawPlayerInfo(cx, y) {
    const p = this.playerData;

    // Background panel
    this.add.rectangle(cx, y + 40, 500, 120, 0x111122, 0.8)
      .setStrokeStyle(1, 0x00ff88, 0.5);

    // Player name + level
    this.nameText = this.add.text(cx - 230, y, p.username + '  Lv.' + p.level, {
      fontSize: '20px', fontFamily: 'Courier New', color: '#00ff88', fontStyle: 'bold',
    });

    // HP bar
    this.add.text(cx - 230, y + 30, 'HP:', { fontSize: '14px', color: '#888', fontFamily: 'Courier New' });
    this.hpBarBg = this.add.rectangle(cx - 150, y + 37, 200, 12, 0x333333).setOrigin(0, 0.5);
    this.hpBar = this.add.rectangle(cx - 150, y + 37, 200 * (p.hp / p.maxHp), 12, 0x00ff44).setOrigin(0, 0.5);
    this.hpText = this.add.text(cx + 60, y + 30, p.hp + '/' + p.maxHp, {
      fontSize: '12px', color: '#aaa', fontFamily: 'Courier New',
    });

    // XP bar
    this.add.text(cx - 230, y + 50, 'XP:', { fontSize: '14px', color: '#888', fontFamily: 'Courier New' });
    this.xpBarBg = this.add.rectangle(cx - 150, y + 57, 200, 12, 0x333333).setOrigin(0, 0.5);
    this.xpBar = this.add.rectangle(cx - 150, y + 57, 200 * (p.xp / (p.xpToNext || 1)), 12, 0x8844ff).setOrigin(0, 0.5);

    // Stats
    this.add.text(cx + 120, y, 'ATK: ' + p.atk, { fontSize: '14px', color: '#ff4444', fontFamily: 'Courier New' });
    this.add.text(cx + 120, y + 20, 'DEF: ' + p.def, { fontSize: '14px', color: '#4488ff', fontFamily: 'Courier New' });

    // Tokens
    this.tokenText = this.add.text(cx - 230, y + 75, this.formatTokenLine(p), {
      fontSize: '13px', color: '#aaaaaa', fontFamily: 'Courier New',
    });

    // PvP rating
    this.pvpText = this.add.text(cx + 120, y + 45, 'PvP: ' + (p.pvpRating || 1000), {
      fontSize: '13px', color: '#ff8800', fontFamily: 'Courier New',
    });
  }

  refreshPlayerInfo() {
    if (!this.nameText) return;
    const p = this.playerData;

    this.nameText.setText(p.username + '  Lv.' + p.level);

    const hpPct = Math.max(p.hp / p.maxHp, 0);
    this.hpBar.width = 200 * hpPct;
    this.hpText.setText(p.hp + '/' + p.maxHp);
    if (hpPct > 0.5) this.hpBar.setFillStyle(0x00ff44);
    else if (hpPct > 0.25) this.hpBar.setFillStyle(0xffaa00);
    else this.hpBar.setFillStyle(0xff4444);

    const xpPct = Math.min(p.xp / (p.xpToNext || 1), 1);
    this.xpBar.width = 200 * xpPct;

    this.tokenText.setText(this.formatTokenLine(p));
    this.pvpText.setText('PvP: ' + (p.pvpRating || 1000));
  }
}
