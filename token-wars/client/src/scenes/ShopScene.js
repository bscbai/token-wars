import net from '../systems/NetworkManager.js';

export class ShopScene extends Phaser.Scene {
  constructor() {
    super({ key: 'ShopScene' });
  }

  init(data) {
    this.playerData = data.player;
  }

  create() {
    const cx = 480;

    this.add.text(cx, 30, '🛒 算力商城', {
      fontSize: '28px', fontFamily: 'Courier New', color: '#aa44ff', fontStyle: 'bold',
    }).setOrigin(0.5);

    // Credits display
    this.creditsText = this.add.text(cx, 65, `积分: ${this.playerData.credits}`, {
      fontSize: '18px', fontFamily: 'Courier New', color: '#ffff00',
    }).setOrigin(0.5);

    // Daily bonus button
    const dailyBtn = this.add.text(cx + 300, 65, '[ 领取每日50积分 ]', {
      fontSize: '12px', fontFamily: 'Courier New', color: '#00ff88',
    }).setOrigin(1, 0.5).setInteractive({ useHandCursor: true });
    dailyBtn.on('pointerdown', () => {
      // For prototype: just add credits
      this.playerData.credits += 50;
      this.creditsText.setText(`积分: ${this.playerData.credits}`);
      dailyBtn.setText('已领取');
      dailyBtn.disableInteractive();
    });

    // Fetch packs from server
    this.loadPacks();

    // Status
    this.statusText = this.add.text(cx, 600, '', {
      fontSize: '14px', color: '#00ff88', fontFamily: 'Courier New',
    }).setOrigin(0.5);

    // Back button
    this.add.text(50, 620, '< 返回大厅', {
      fontSize: '16px', fontFamily: 'Courier New', color: '#666666',
    }).setOrigin(0, 1).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.scene.start('LobbyScene', { player: this.playerData }));
  }

  async loadPacks() {
    try {
      const resp = await fetch('/api/shop/packs');
      const data = await resp.json();
      this.renderPacks(data.packs);
    } catch (err) {
      this.statusText.setText('加载商城失败');
    }
  }

  renderPacks(packs) {
    const startX = 100;
    const startY = 110;
    const cardW = 170;
    const cardH = 200;
    const gap = 15;

    packs.forEach((pack, i) => {
      const col = i % 5;
      const row = Math.floor(i / 5);
      const x = startX + col * (cardW + gap) + cardW / 2;
      const y = startY + row * (cardH + gap) + cardH / 2;

      // Card background
      const colors = {
        starter: 0x44ff44,
        basic: 0x00aaff,
        premium: 0xaa44ff,
        legendary: 0xff8800,
        ammo: 0xffff00,
      };
      const color = colors[pack.id] || 0x888888;

      const card = this.add.rectangle(x, y, cardW, cardH, 0x111122, 0.9);
      card.setStrokeStyle(2, color);

      // Pack name
      this.add.text(x, y - 70, pack.name, {
        fontSize: '14px', fontFamily: 'Courier New', color: `#${color.toString(16).padStart(6, '0')}`,
        fontStyle: 'bold', wordWrap: { width: cardW - 10 },
      }).setOrigin(0.5);

      // Contents
      let contentStr = '';
      if (pack.contents.unstable) contentStr += `${pack.contents.unstable} 不稳定Token\n`;
      if (pack.contents.stableCount) contentStr += `${pack.contents.stableCount} 稳定Token\n`;
      if (pack.contents.coprocessor) contentStr += `1 协处理器Token\n`;

      this.add.text(x, y - 10, contentStr.trim(), {
        fontSize: '11px', fontFamily: 'Courier New', color: '#888',
        lineSpacing: 4,
      }).setOrigin(0.5);

      // Price
      const priceStr = pack.price === 0 ? '免费' : `${pack.price} 积分`;
      this.add.text(x, y + 50, priceStr, {
        fontSize: '14px', fontFamily: 'Courier New', color: '#ffff00', fontStyle: 'bold',
      }).setOrigin(0.5);

      // Buy button
      const buyBtn = this.add.text(x, y + 80, '[ 购买 ]', {
        fontSize: '16px', fontFamily: 'Courier New', color: '#00ff88',
        backgroundColor: '#1a2a1a', padding: { x: 15, y: 4 },
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });

      buyBtn.on('pointerdown', () => this.buyPack(pack.id));
      buyBtn.on('pointerover', () => buyBtn.setColor('#88ffcc'));
      buyBtn.on('pointerout', () => buyBtn.setColor('#00ff88'));
    });
  }

  async buyPack(packId) {
    try {
      const sessionToken = net.sessionToken;
      const resp = await fetch('/api/shop/buy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ packId }),
      });
      const data = await resp.json();

      if (!resp.ok) {
        this.statusText.setColor('#ff4444');
        this.statusText.setText(data.error);
        return;
      }

      // Update local player data
      this.playerData = { ...this.playerData, ...data.player };
      this.creditsText.setText(`积分: ${this.playerData.credits}`);

      // Show received items
      let msg = `购买成功! 获得: `;
      if (data.received.unstable) msg += `${data.received.unstable} 不稳定Token `;
      if (data.received.stable?.length) msg += `${data.received.stable.length} 稳定Token `;

      this.statusText.setColor('#00ff88');
      this.statusText.setText(msg);
      this.time.delayedCall(3000, () => this.statusText.setText(''));
    } catch (err) {
      this.statusText.setColor('#ff4444');
      this.statusText.setText('购买失败: 网络错误');
    }
  }
}
