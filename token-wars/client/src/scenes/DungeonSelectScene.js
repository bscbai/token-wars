import net from '../systems/NetworkManager.js';

export class DungeonSelectScene extends Phaser.Scene {
  constructor() {
    super({ key: 'DungeonSelectScene' });
  }

  init(data) {
    this.playerData = data.player;
  }

  create() {
    const cx = 480;

    this.add.text(cx, 40, '⚔ PvE 副本选择', {
      fontSize: '28px', fontFamily: 'Courier New', color: '#ff4444', fontStyle: 'bold',
    }).setOrigin(0.5);

    const dungeons = [
      {
        id: 'solo_easy',
        name: '初级数据矿洞',
        desc: '单人副本 | 3波怪物 + Boss',
        diff: '简单',
        color: '#44ff44',
        rewards: 'Common-Unstable Token, 蓝色稳定Token概率',
      },
      {
        id: 'group_medium',
        name: '中级算力仓库',
        desc: '3-5人副本 | 3波怪物 + Boss',
        diff: '中等',
        color: '#ffaa00',
        rewards: 'Green-Blue Unstable + Stable Token, 稀有协处理器概率',
      },
    ];

    dungeons.forEach((d, i) => {
      const y = 150 + i * 180;

      // Card background
      this.add.rectangle(cx, y + 60, 500, 150, 0x111122, 0.8)
        .setStrokeStyle(2, Phaser.Display.Color.HexStringToColor(d.color.replace('#', '')).color);

      // Name
      this.add.text(cx - 230, y, d.name, {
        fontSize: '22px', fontFamily: 'Courier New', color: d.color, fontStyle: 'bold',
      });

      // Difficulty
      this.add.text(cx + 230, y, d.diff, {
        fontSize: '16px', fontFamily: 'Courier New', color: d.color,
      }).setOrigin(1, 0);

      // Description
      this.add.text(cx - 230, y + 30, d.desc, {
        fontSize: '14px', fontFamily: 'Courier New', color: '#888888',
      });

      // Rewards
      this.add.text(cx - 230, y + 55, `奖励: ${d.rewards}`, {
        fontSize: '13px', fontFamily: 'Courier New', color: '#666666',
      });

      // Enter button
      const btn = this.add.text(cx, y + 110, '[ 进入副本 ]', {
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
    this.add.text(50, 600, '< 返回大厅', {
      fontSize: '16px', fontFamily: 'Courier New', color: '#666666',
    }).setOrigin(0, 1).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.scene.start('LobbyScene', { player: this.playerData }));
  }
}
