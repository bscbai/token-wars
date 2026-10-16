import net from '../systems/NetworkManager.js';
import { t, onLangChange } from '../i18n.js';

// 副本静态目录（与 server/models/Dungeon.js DUNGEON_TEMPLATES 前两项对应）；
// 展示文案走 i18n 键，服务端只认 id
const DUNGEONS = [
  { id: 'solo_easy', keyPrefix: 'dungeon.easy', color: '#44ff44' },
  { id: 'group_medium', keyPrefix: 'dungeon.medium', color: '#ffaa00' },
];

export class DungeonSelectScene extends Phaser.Scene {
  constructor() {
    super({ key: 'DungeonSelectScene' });
  }

  init(data) {
    this.playerData = data.player;
  }

  create() {
    const cx = 480;

    this.add.text(cx, 40, t('dungeon.title'), {
      fontSize: '28px', fontFamily: 'Courier New', color: '#ff4444', fontStyle: 'bold',
    }).setOrigin(0.5);

    DUNGEONS.forEach((d, i) => {
      const y = 150 + i * 180;

      // Card background
      this.add.rectangle(cx, y + 60, 500, 150, 0x111122, 0.8)
        .setStrokeStyle(2, Phaser.Display.Color.HexStringToColor(d.color.replace('#', '')).color);

      // Name
      this.add.text(cx - 230, y, t(`${d.keyPrefix}.name`), {
        fontSize: '22px', fontFamily: 'Courier New', color: d.color, fontStyle: 'bold',
      });

      // Difficulty
      this.add.text(cx + 230, y, t(`${d.keyPrefix}.diff`), {
        fontSize: '16px', fontFamily: 'Courier New', color: d.color,
      }).setOrigin(1, 0);

      // Description
      this.add.text(cx - 230, y + 30, t(`${d.keyPrefix}.desc`), {
        fontSize: '14px', fontFamily: 'Courier New', color: '#888888',
      });

      // Rewards
      this.add.text(cx - 230, y + 55, t('dungeon.rewards', { r: t(`${d.keyPrefix}.rewards`) }), {
        fontSize: '13px', fontFamily: 'Courier New', color: '#666666',
      });

      // Enter button
      const btn = this.add.text(cx, y + 110, t('dungeon.enter'), {
        fontSize: '18px', fontFamily: 'Courier New', color: d.color, fontStyle: 'bold',
        backgroundColor: '#1a1a2e', padding: { x: 20, y: 5 },
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });

      btn.on('pointerdown', () => {
        net.emit('dungeon:join', { dungeonId: d.id });
      });
      btn.on('pointerover', () => btn.setColor('#ffffff'));
      btn.on('pointerout', () => btn.setColor(d.color));
    });

    // Status
    this.statusText = this.add.text(cx, 550, '', {
      fontSize: '16px', color: '#ffff00', fontFamily: 'Courier New',
    }).setOrigin(0.5);

    // Listen for dungeon start
    net.on('dungeon:start', (data) => {
      this.scene.start('CombatScene', {
        player: this.playerData,
        dungeonData: data,
        mode: 'pve',
      });
    });

    net.on('error', (data) => {
      this.statusText.setText(data.message);
      this.time.delayedCall(3000, () => this.statusText.setText(''));
    });

    // Back button
    this.add.text(50, 600, t('common.back'), {
      fontSize: '16px', fontFamily: 'Courier New', color: '#666666',
    }).setOrigin(0, 1).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.scene.start('LobbyScene', { player: this.playerData }));

    // Live language switching: static card list — restart 是最简的正确重绘
    this._offLang = onLangChange(() => this.scene.restart({ player: this.playerData }));
    this.events.once('shutdown', () => { if (this._offLang) this._offLang(); });
  }
}
