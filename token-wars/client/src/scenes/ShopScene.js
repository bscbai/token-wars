import net from '../systems/NetworkManager.js';
import { t, onLangChange } from '../i18n.js';

export class ShopScene extends Phaser.Scene {
  constructor() {
    super({ key: 'ShopScene' });
  }

  init(data) {
    this.playerData = data.player;
    this.packs = null;
    this.packObjects = [];
    this.dailyClaimed = false;
  }

  create() {
    const cx = 480;

    this.titleText = this.add.text(cx, 30, t('shop.title'), {
      fontSize: '28px', fontFamily: 'Courier New', color: '#aa44ff', fontStyle: 'bold',
    }).setOrigin(0.5);

    // Credits display
    this.creditsText = this.add.text(cx, 65, t('shop.credits', { n: this.playerData.credits }), {
      fontSize: '18px', fontFamily: 'Courier New', color: '#ffff00',
    }).setOrigin(0.5);

    // Daily bonus button — claims via server
    this.dailyBtn = this.add.text(cx + 300, 65, t('shop.daily'), {
      fontSize: '12px', fontFamily: 'Courier New', color: '#00ff88',
    }).setOrigin(1, 0.5).setInteractive({ useHandCursor: true });
    this.dailyBtn.on('pointerdown', async () => {
      try {
        const resp = await fetch('/api/player/claim-daily', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${net.sessionToken}`,
          },
        });
        const data = await resp.json();
        if (!resp.ok) {
          this.statusText.setText(data.error || t('shop.claimFail'));
          return;
        }
        this.playerData = { ...this.playerData, ...data.player };
        this.creditsText.setText(t('shop.credits', { n: this.playerData.credits }));
        this.dailyClaimed = true;
        this.dailyBtn.setText(t('shop.claimed'));
        this.dailyBtn.disableInteractive();
        this.statusText.setColor('#00ff88');
        this.statusText.setText(t('shop.gained', { n: data.amount }));
        this.time.delayedCall(2000, () => this.statusText.setText(''));
      } catch (err) {
        this.statusText.setText(t('shop.networkError'));
      }
    });

    // Fetch packs from server
    this.loadPacks();

    // Status
    this.statusText = this.add.text(cx, 600, '', {
      fontSize: '14px', color: '#00ff88', fontFamily: 'Courier New',
    }).setOrigin(0.5);

    // Back button
    this.backText = this.add.text(50, 620, t('common.back'), {
      fontSize: '16px', fontFamily: 'Courier New', color: '#666666',
    }).setOrigin(0, 1).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.scene.start('LobbyScene', { player: this.playerData }));

    // Live language switching
    this._offLang = onLangChange(() => this.applyLang());
    this.events.once('shutdown', () => { if (this._offLang) this._offLang(); });
  }

  applyLang() {
    this.titleText.setText(t('shop.title'));
    this.creditsText.setText(t('shop.credits', { n: this.playerData.credits }));
    this.dailyBtn.setText(this.dailyClaimed ? t('shop.claimed') : t('shop.daily'));
    this.backText.setText(t('common.back'));
    if (this.packs) this.renderPacks(this.packs);
  }

  /** 服务端包名为中文常量；按 id 映射 i18n，未知包回退原名 */
  packName(pack) {
    const key = `shop.pack.${pack.id}`;
    const v = t(key);
    return v === key ? pack.name : v;
  }

  async loadPacks() {
    try {
      const resp = await fetch('/api/shop/packs');
      const data = await resp.json();
      this.packs = data.packs;
      this.renderPacks(this.packs);
    } catch (err) {
      this.statusText.setText(t('shop.loadFailed'));
    }
  }

  renderPacks(packs) {
    // Clear previous cards (language re-render)
    for (const obj of this.packObjects) obj.destroy();
    this.packObjects = [];
    const add = (x) => { this.packObjects.push(x); return x; };

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

      add(this.add.rectangle(x, y, cardW, cardH, 0x111122, 0.9)).setStrokeStyle(2, color);

      // Pack name
      add(this.add.text(x, y - 70, this.packName(pack), {
        fontSize: '14px', fontFamily: 'Courier New', color: `#${color.toString(16).padStart(6, '0')}`,
        fontStyle: 'bold', wordWrap: { width: cardW - 10 },
      })).setOrigin(0.5);

      // Contents
      let contentStr = '';
      if (pack.contents.unstable) contentStr += `${t('shop.unstable', { n: pack.contents.unstable })}\n`;
      if (pack.contents.stableCount) contentStr += `${t('shop.stable', { n: pack.contents.stableCount })}\n`;
      if (pack.contents.coprocessor) contentStr += `${t('shop.coprocessor')}\n`;

      add(this.add.text(x, y - 10, contentStr.trim(), {
        fontSize: '11px', fontFamily: 'Courier New', color: '#888',
        lineSpacing: 4,
      })).setOrigin(0.5);

      // Price
      const priceStr = pack.price === 0 ? t('shop.free') : t('shop.price', { n: pack.price });
      add(this.add.text(x, y + 50, priceStr, {
        fontSize: '14px', fontFamily: 'Courier New', color: '#ffff00', fontStyle: 'bold',
      })).setOrigin(0.5);

      // Buy button
      const buyBtn = add(this.add.text(x, y + 80, t('shop.buy'), {
        fontSize: '16px', fontFamily: 'Courier New', color: '#00ff88',
        backgroundColor: '#1a2a1a', padding: { x: 15, y: 4 },
      })).setOrigin(0.5).setInteractive({ useHandCursor: true });

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
      this.creditsText.setText(t('shop.credits', { n: this.playerData.credits }));

      // Show received items
      let msg = t('shop.buySuccess');
      if (data.received.unstable) msg += `${t('shop.unstable', { n: data.received.unstable })} `;
      if (data.received.stable?.length) msg += `${t('shop.stable', { n: data.received.stable.length })} `;

      this.statusText.setColor('#00ff88');
      this.statusText.setText(msg);
      this.time.delayedCall(3000, () => this.statusText.setText(''));
    } catch (err) {
      this.statusText.setColor('#ff4444');
      this.statusText.setText(t('shop.buyFail'));
    }
  }
}
