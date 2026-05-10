import net from '../systems/NetworkManager.js';
import { MINING, RARITY_CONFIG } from '../../../shared/constants.js';

export class MiningScene extends Phaser.Scene {
  constructor() {
    super({ key: 'MiningScene' });
  }

  init(data) {
    this.playerData = data.player;
  }

  create() {
    const cx = 480;

    // Title
    this.add.text(cx, 40, '⛏ 挂机挖矿', {
      fontSize: '28px', fontFamily: 'Courier New', color: '#00aaff', fontStyle: 'bold',
    }).setOrigin(0.5);

    // Mining info panel
    this.add.rectangle(cx, 200, 500, 250, 0x111122, 0.8)
      .setStrokeStyle(1, 0x00aaff, 0.5);

    const miningLevel = this.playerData.miningLevel || 1;
    const miningConfig = MINING.LEVELS[miningLevel - 1];

    this.add.text(cx, 100, `挖矿等级: Lv.${miningLevel}`, {
      fontSize: '22px', fontFamily: 'Courier New', color: '#00aaff', fontStyle: 'bold',
    }).setOrigin(0.5);

    this.add.text(cx, 130, `产出速率: 每 ${(miningConfig.rate / 1000).toFixed(0)} 秒 1 Token`, {
      fontSize: '16px', fontFamily: 'Courier New', color: '#88aacc',
    }).setOrigin(0.5);

    this.add.text(cx, 155, `存储上限: ${miningConfig.capacity} Tokens`, {
      fontSize: '16px', fontFamily: 'Courier New', color: '#88aacc',
    }).setOrigin(0.5);

    // Pending tokens display
    this.pendingText = this.add.text(cx, 200, '待收集: 0 Tokens', {
      fontSize: '24px', fontFamily: 'Courier New', color: '#00ff88', fontStyle: 'bold',
    }).setOrigin(0.5);

    // Progress bar
    this.progressBg = this.add.rectangle(cx, 240, 400, 20, 0x333333).setOrigin(0.5);
    this.progressBar = this.add.rectangle(cx - 200, 240, 0, 20, 0x00aaff).setOrigin(0, 0.5);
    this.progressLabel = this.add.text(cx, 240, '0%', {
      fontSize: '12px', fontFamily: 'Courier New', color: '#ffffff',
    }).setOrigin(0.5);

    // Collect button
    this.collectBtn = this.add.text(cx, 310, '[ 收集 Tokens ]', {
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
    if (nextLevel) {
      const nextConfig = MINING.LEVELS[nextLevel - 1];
      const costRarity = nextConfig.costRarity || 'common';
      const rarityLabel = RARITY_CONFIG[costRarity]?.label || costRarity;

      this.upgradeBtn = this.add.text(cx, 380, `[ 升级到 Lv.${nextLevel} — 需要 ${nextConfig.cost} ${rarityLabel}Token ]`, {
        fontSize: '16px', fontFamily: 'Courier New', color: '#ffaa00',
        backgroundColor: '#2a2a1a', padding: { x: 20, y: 8 },
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });

      this.upgradeBtn.on('pointerdown', () => {
        net.emit('mining:upgrade', {});
      });
    } else {
      this.add.text(cx, 380, '已达到最高等级!', {
        fontSize: '16px', fontFamily: 'Courier New', color: '#ffff00',
      }).setOrigin(0.5);
    }

    // Status
    this.statusText = this.add.text(cx, 440, '', {
      fontSize: '14px', color: '#00ff88', fontFamily: 'Courier New',
    }).setOrigin(0.5);

    // Back button
    this.add.text(50, 600, '< 返回大厅', {
      fontSize: '16px', fontFamily: 'Courier New', color: '#666666',
    }).setOrigin(0, 1).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.scene.start('LobbyScene', { player: this.playerData }));

    // Listen for server updates
    net.on('mining:update', (data) => {
      this.pendingTokens = data.pendingTokens;
      this.pendingText.setText(`待收集: ${data.pendingTokens} Tokens`);
      const pct = Math.min(data.pendingTokens / data.capacity, 1);
      this.progressBar.width = 400 * pct;
      this.progressLabel.setText(`${Math.floor(pct * 100)}%`);
    });

    net.on('mining:collected', (data) => {
      this.statusText.setColor('#00ff88');
      this.statusText.setText(`收集了 ${data.amount} 个不稳定Token!`);
      this.time.delayedCall(3000, () => this.statusText.setText(''));
    });

    net.on('mining:upgraded', (data) => {
      this.statusText.setColor('#ffaa00');
      this.statusText.setText(`挖矿升级到 Lv.${data.newLevel}!`);
      this.time.delayedCall(3000, () => this.scene.restart({ player: this.playerData }));
    });

    // Request current mining state
    this.pendingTokens = 0;
  }

  update() {
    // Animate mining "progress" locally for visual feedback
    // Server is authoritative, this is just eye candy
  }
}
