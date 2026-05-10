import net from '../systems/NetworkManager.js';

export class PvPScene extends Phaser.Scene {
  constructor() {
    super({ key: 'PvPScene' });
  }

  init(data) {
    this.playerData = data.player;
  }

  create() {
    const cx = 480;

    this.add.text(cx, 40, '🏟 PvP 竞技场', {
      fontSize: '28px', fontFamily: 'Courier New', color: '#ff8800', fontStyle: 'bold',
    }).setOrigin(0.5);

    // Player rating
    this.add.text(cx, 80, `当前评分: ${this.playerData.pvpRating}`, {
      fontSize: '18px', fontFamily: 'Courier New', color: '#ffaa00',
    }).setOrigin(0.5);

    // Mode selection
    const modes = [
      { id: '1v1', name: '1v1 决斗', desc: '三局两胜 | 有限场地 | 缩圈机制', players: '2人' },
      { id: '3v3', name: '3v3 团队竞技', desc: '单局淘汰 | 绝境反击机制 | 角色配合', players: '6人' },
    ];

    modes.forEach((mode, i) => {
      const y = 180 + i * 160;

      this.add.rectangle(cx, y + 50, 450, 130, 0x111122, 0.8)
        .setStrokeStyle(2, 0xff8800);

      this.add.text(cx - 200, y, mode.name, {
        fontSize: '22px', fontFamily: 'Courier New', color: '#ff8800', fontStyle: 'bold',
      });

      this.add.text(cx + 200, y, mode.players, {
        fontSize: '14px', fontFamily: 'Courier New', color: '#888',
      }).setOrigin(1, 0);

      this.add.text(cx - 200, y + 30, mode.desc, {
        fontSize: '14px', fontFamily: 'Courier New', color: '#888888',
      });

      // Queue button
      const btn = this.add.text(cx, y + 90, '[ 加入匹配队列 ]', {
        fontSize: '20px', fontFamily: 'Courier New', color: '#ff8800', fontStyle: 'bold',
        backgroundColor: '#2a1a0a', padding: { x: 25, y: 8 },
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });

      btn.on('pointerdown', () => {
        net.emit('pvp:queue', { mode: mode.id });
        btn.setText('匹配中...');
        btn.setColor('#ffff00');
        this.statusText.setText(`正在寻找 ${mode.name} 对手...`);
      });
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
    this.add.text(50, 600, '< 返回大厅', {
      fontSize: '16px', fontFamily: 'Courier New', color: '#666666',
    }).setOrigin(0, 1).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        net.emit('pvp:dequeue', {});
        this.scene.start('LobbyScene', { player: this.playerData });
      });
  }
}
