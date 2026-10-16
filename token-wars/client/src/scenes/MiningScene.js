import net from '../systems/NetworkManager.js';
import { MINING, RARITY_CONFIG } from '../shared.js';
import { t, onLangChange } from '../i18n.js';

export class MiningScene extends Phaser.Scene {
  constructor() {
    super({ key: 'MiningScene' });
  }

  init(data) {
    this.playerData = data.player;
  }

  create() {
    const cx = 480;
    const miningLevel = this.playerData.miningLevel || 1;
    const miningConfig = MINING.LEVELS[miningLevel - 1];
    this.miningLevel = miningLevel;
    this.miningConfig = miningConfig;
    this.lastMiningData = null;

    // Title
    this.titleText = this.add.text(cx, 40, t('mining.title'), {
      fontSize: '28px', fontFamily: 'Courier New', color: '#00aaff', fontStyle: 'bold',
    }).setOrigin(0.5);

    // Mining info panel
    this.add.rectangle(cx, 200, 500, 250, 0x111122, 0.8)
      .setStrokeStyle(1, 0x00aaff, 0.5);

    this.levelText = this.add.text(cx, 100, t('mining.level', { n: miningLevel }), {
      fontSize: '22px', fontFamily: 'Courier New', color: '#00aaff', fontStyle: 'bold',
    }).setOrigin(0.5);

    this.rateText = this.add.text(cx, 130, t('mining.rate', { s: (miningConfig.rate / 1000).toFixed(0) }), {
      fontSize: '16px', fontFamily: 'Courier New', color: '#88aacc',
    }).setOrigin(0.5);

    this.capacityText = this.add.text(cx, 155, t('mining.capacity', { n: miningConfig.capacity }), {
      fontSize: '16px', fontFamily: 'Courier New', color: '#88aacc',
    }).setOrigin(0.5);

    // Pending tokens display
    this.pendingText = this.add.text(cx, 200, t('mining.pending', { n: 0 }), {
      fontSize: '24px', fontFamily: 'Courier New', color: '#00ff88', fontStyle: 'bold',
    }).setOrigin(0.5);

    // Progress bar
    this.progressBg = this.add.rectangle(cx, 240, 400, 20, 0x333333).setOrigin(0.5);
    this.progressBar = this.add.rectangle(cx - 200, 240, 0, 20, 0x00aaff).setOrigin(0, 0.5);
    this.progressLabel = this.add.text(cx, 240, '0%', {
      fontSize: '12px', fontFamily: 'Courier New', color: '#ffffff',
    }).setOrigin(0.5);

    // Collect button
    this.collectBtn = this.add.text(cx, 310, t('mining.collect'), {
      fontSize: '22px', fontFamily: 'Courier New', color: '#00ff88', fontStyle: 'bold',
      backgroundColor: '#1a3a2e', padding: { x: 30, y: 10 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    this.collectBtn.on('pointerdown', () => {
      net.emit('mining:collect', {});
    });
    this.collectBtn.on('pointerover', () => this.collectBtn.setColor('#88ffcc'));
    this.collectBtn.on('pointerout', () => this.collectBtn.setColor('#00ff88'));

    // Upgrade button
    const nextLevel = miningLevel < 5 ? miningLevel + 1 : null;
    this.upgradeText = null;
    if (nextLevel) {
      const nextConfig = MINING.LEVELS[nextLevel - 1];
      this.nextLevel = nextLevel;
      this.nextConfig = nextConfig;
      this.upgradeText = this.add.text(cx, 380, this.upgradeLabel(), {
        fontSize: '16px', fontFamily: 'Courier New', color: '#ffaa00',
        backgroundColor: '#2a2a1a', padding: { x: 20, y: 8 },
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });

      this.upgradeText.on('pointerdown', () => {
        net.emit('mining:upgrade', {});
      });
    } else {
      this.maxLevelText = this.add.text(cx, 380, t('mining.maxLevel'), {
        fontSize: '16px', fontFamily: 'Courier New', color: '#ffff00',
      }).setOrigin(0.5);
    }

    // Status
    this.statusText = this.add.text(cx, 440, '', {
      fontSize: '14px', color: '#00ff88', fontFamily: 'Courier New',
    }).setOrigin(0.5);

    // Back button
    this.backText = this.add.text(50, 600, t('common.back'), {
      fontSize: '16px', fontFamily: 'Courier New', color: '#666666',
    }).setOrigin(0, 1).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.scene.start('LobbyScene', { player: this.playerData }));

    // Live language switching
    this._offLang = onLangChange(() => this.applyLang());
    this.events.once('shutdown', () => { if (this._offLang) this._offLang(); });

    // Listen for server updates
    net.on('mining:update', (data) => {
      this.lastMiningData = data;
      this.pendingTokens = data.pendingTokens;
      this.pendingText.setText(t('mining.pending', { n: data.pendingTokens }));
      const pct = Math.min(data.pendingTokens / data.capacity, 1);
      this.progressBar.width = 400 * pct;
      this.progressLabel.setText(`${Math.floor(pct * 100)}%`);
    });

    net.on('mining:collected', (data) => {
      this.statusText.setColor('#00ff88');
      this.statusText.setText(t('mining.collected', { n: data.amount }));
      this.time.delayedCall(3000, () => this.statusText.setText(''));
    });

    net.on('mining:upgraded', (data) => {
      this.statusText.setColor('#ffaa00');
      this.statusText.setText(t('mining.upgraded', { n: data.newLevel }));
      this.time.delayedCall(3000, () => this.scene.restart({ player: this.playerData }));
    });

    // Request current mining state
    this.pendingTokens = 0;
  }

  /** 稀有度 id → 本地化短标签（回退服务端配置 label） */
  rarityLabel(costRarity) {
    const key = `rarity.${costRarity}`;
    const v = t(key);
    return v === key ? (RARITY_CONFIG[costRarity]?.label || costRarity) : v;
  }

  upgradeLabel() {
    return t('mining.upgrade', {
      n: this.nextLevel,
      cost: this.nextConfig.cost,
      rarity: this.rarityLabel(this.nextConfig.costRarity || 'common'),
    });
  }

  applyLang() {
    this.titleText.setText(t('mining.title'));
    this.levelText.setText(t('mining.level', { n: this.miningLevel }));
    this.rateText.setText(t('mining.rate', { s: (this.miningConfig.rate / 1000).toFixed(0) }));
    this.capacityText.setText(t('mining.capacity', { n: this.miningConfig.capacity }));
    this.collectBtn.setText(t('mining.collect'));
    if (this.upgradeText) this.upgradeText.setText(this.upgradeLabel());
    if (this.maxLevelText) this.maxLevelText.setText(t('mining.maxLevel'));
    this.backText.setText(t('common.back'));
    if (this.lastMiningData) {
      const data = this.lastMiningData;
      this.pendingText.setText(t('mining.pending', { n: data.pendingTokens }));
    } else {
      this.pendingText.setText(t('mining.pending', { n: 0 }));
    }
  }

  update() {
    // Animate mining "progress" locally for visual feedback
    // Server is authoritative, this is just eye candy
  }
}
