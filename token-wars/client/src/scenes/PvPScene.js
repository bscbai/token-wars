import net from '../systems/NetworkManager.js';
import { t, onLangChange } from '../i18n.js';

// 模式静态目录（mode id 是协议值）；展示文案走 i18n
const MODES = [
  { id: '1v1', keyPrefix: 'pvp.1v1', players: 2 },
  { id: '3v3', keyPrefix: 'pvp.3v3', players: 6 },
];

export class PvPScene extends Phaser.Scene {
  constructor() {
    super({ key: 'PvPScene' });
  }

  init(data) {
    this.playerData = data.player;
    this.queuedMode = null; // 排队中的 mode id（语言切换时保持按钮状态）
  }

  create() {
    const cx = 480;

    this.titleText = this.add.text(cx, 40, t('pvp.title'), {
      fontSize: '28px', fontFamily: 'Courier New', color: '#ff8800', fontStyle: 'bold',
    }).setOrigin(0.5);

    // Player rating
    this.ratingText = this.add.text(cx, 80, t('pvp.rating', { n: this.playerData.pvpRating }), {
      fontSize: '18px', fontFamily: 'Courier New', color: '#ffaa00',
    }).setOrigin(0.5);

    this.modeUi = [];
    MODES.forEach((mode, i) => {
      const y = 180 + i * 160;

      this.add.rectangle(cx, y + 50, 450, 130, 0x111122, 0.8)
        .setStrokeStyle(2, 0xff8800);

      const nameText = this.add.text(cx - 200, y, t(`${mode.keyPrefix}.name`), {
        fontSize: '22px', fontFamily: 'Courier New', color: '#ff8800', fontStyle: 'bold',
      });

      const playersText = this.add.text(cx + 200, y, t('pvp.players', { n: mode.players }), {
        fontSize: '14px', fontFamily: 'Courier New', color: '#888',
      }).setOrigin(1, 0);

      const descText = this.add.text(cx - 200, y + 30, t(`${mode.keyPrefix}.desc`), {
        fontSize: '14px', fontFamily: 'Courier New', color: '#888888',
      });

      // Queue button
      const btn = this.add.text(cx, y + 90, t('pvp.queue'), {
        fontSize: '20px', fontFamily: 'Courier New', color: '#ff8800', fontStyle: 'bold',
        backgroundColor: '#2a1a0a', padding: { x: 25, y: 8 },
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });

      btn.on('pointerdown', () => {
        net.emit('pvp:queue', { mode: mode.id });
        this.queuedMode = mode.id;
        btn.setText(t('pvp.matching'));
        btn.setColor('#ffff00');
        this.statusText.setText(t('pvp.searchStatus', { name: t(`${mode.keyPrefix}.name`) }));
      });

      this.modeUi.push({ mode, nameText, playersText, descText, btn });
    });

    // Status
    this.statusText = this.add.text(cx, 500, '', {
      fontSize: '16px', color: '#ffff00', fontFamily: 'Courier New',
    }).setOrigin(0.5);

    // Match found listener
    net.on('pvp:matched', (data) => {
      this.scene.start('CombatScene', {
        player: this.playerData,
        dungeonData: { mapData: data.mapData, playerPos: { x: 15, y: 28 }, monsters: [] },
        mode: 'pvp',
        arenaData: data,
      });
    });

    // Back button
    this.backText = this.add.text(50, 600, t('common.back'), {
      fontSize: '16px', fontFamily: 'Courier New', color: '#666666',
    }).setOrigin(0, 1).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        net.emit('pvp:dequeue', {});
        this.scene.start('LobbyScene', { player: this.playerData });
      });

    // Live language switching
    this._offLang = onLangChange(() => this.applyLang());
    this.events.once('shutdown', () => { if (this._offLang) this._offLang(); });
  }

  applyLang() {
    this.titleText.setText(t('pvp.title'));
    this.ratingText.setText(t('pvp.rating', { n: this.playerData.pvpRating }));
    this.backText.setText(t('common.back'));
    for (const { mode, nameText, playersText, descText, btn } of this.modeUi) {
      nameText.setText(t(`${mode.keyPrefix}.name`));
      playersText.setText(t('pvp.players', { n: mode.players }));
      descText.setText(t(`${mode.keyPrefix}.desc`));
      btn.setText(this.queuedMode === mode.id ? t('pvp.matching') : t('pvp.queue'));
    }
  }
}
