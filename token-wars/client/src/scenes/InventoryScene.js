import net from '../systems/NetworkManager.js';
import { RARITY_CONFIG, SKILLS } from '../../../shared/constants.js';

export class InventoryScene extends Phaser.Scene {
  constructor() {
    super({ key: 'InventoryScene' });
  }

  init(data) {
    this.playerData = data.player;
  }

  create() {
    const cx = 480;

    this.add.text(cx, 30, '🎒 背包 & 技能盘', {
      fontSize: '28px', fontFamily: 'Courier New', color: '#44ffaa', fontStyle: 'bold',
    }).setOrigin(0.5);

    // Left panel: Token inventory
    this.drawTokenInventory(160, 80);

    // Right panel: Skill disk (4x4 grid)
    this.drawSkillDisk(640, 80);

    // Token counts
    this.add.text(160, 500, `不稳定Token (弹药): ${this.playerData.unstableTokens}`, {
      fontSize: '14px', fontFamily: 'Courier New', color: '#ffaa00',
    });

    // Skill list
    this.drawSkillList(640, 460);

    // Back button
    this.add.text(50, 620, '< 返回大厅', {
      fontSize: '16px', fontFamily: 'Courier New', color: '#666666',
    }).setOrigin(0, 1).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.scene.start('LobbyScene', { player: this.playerData }));
  }

  drawTokenInventory(startX, startY) {
    this.add.text(startX, startY, '稳定Token背包', {
      fontSize: '16px', fontFamily: 'Courier New', color: '#44ffaa', fontStyle: 'bold',
    }).setOrigin(0.5);

    const tokens = this.playerData.stableTokens || [];
    const cols = 6;
    const cellSize = 40;
    const gap = 4;

    // Grid
    for (let i = 0; i < 24; i++) { // 4 rows x 6 cols
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = startX - 110 + col * (cellSize + gap);
      const y = startY + 30 + row * (cellSize + gap);

      const token = tokens[i];
      if (token) {
        const rarityColor = RARITY_CONFIG[token.rarity]?.color || 0x888888;
        const cell = this.add.rectangle(x, y, cellSize, cellSize, rarityColor, 0.3);
        cell.setStrokeStyle(1, rarityColor);

        // Rarity label
        const label = RARITY_CONFIG[token.rarity]?.label || '?';
        this.add.text(x, y, label, {
          fontSize: '14px', fontFamily: 'Courier New',
          color: `#${rarityColor.toString(16).padStart(6, '0')}`,
        }).setOrigin(0.5);

        // Drag to skill disk
        cell.setInteractive({ useHandCursor: true, draggable: true });
        cell.setData('tokenIndex', i);
        cell.setData('token', token);
      } else {
        this.add.rectangle(x, y, cellSize, cellSize, 0x222233, 0.3)
          .setStrokeStyle(1, 0x333344);
      }
    }

    // Token count by rarity
    const counts = {};
    for (const t of tokens) {
      counts[t.rarity] = (counts[t.rarity] || 0) + 1;
    }
    let countStr = '';
    for (const [rarity, config] of Object.entries(RARITY_CONFIG)) {
      if (counts[rarity]) {
        countStr += `${config.label}${counts[rarity]}  `;
      }
    }
    if (countStr) {
      this.add.text(startX, startY + 220, countStr, {
        fontSize: '12px', fontFamily: 'Courier New', color: '#888',
      }).setOrigin(0.5);
    }
  }

  drawSkillDisk(centerX, startY) {
    this.add.text(centerX, startY, '技能盘 (4x4)', {
      fontSize: '16px', fontFamily: 'Courier New', color: '#44ffaa', fontStyle: 'bold',
    }).setOrigin(0.5);

    const gridSize = this.playerData.unlock?.gridSize || 2;
    const cellSize = 44;
    const gap = 4;
    const gridStartX = centerX - (4 * (cellSize + gap)) / 2;
    const gridStartY = startY + 30;

    this.diskSlots = [];

    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        const x = gridStartX + col * (cellSize + gap) + cellSize / 2;
        const y = gridStartY + row * (cellSize + gap) + cellSize / 2;
        const index = row * 4 + col;

        const unlocked = row < gridSize && col < gridSize;
        const token = this.playerData.equippedTokens?.[index];

        if (unlocked) {
          const cell = this.add.rectangle(x, y, cellSize, cellSize, 0x1a2a1a, 0.8);
          cell.setStrokeStyle(2, 0x44ffaa);

          if (token) {
            const rarityColor = RARITY_CONFIG[token.rarity]?.color || 0x888888;
            cell.setFillStyle(rarityColor, 0.2);
            const label = RARITY_CONFIG[token.rarity]?.label || '?';
            this.add.text(x, y, label, {
              fontSize: '14px', fontFamily: 'Courier New',
              color: `#${rarityColor.toString(16).padStart(6, '0')}`,
            }).setOrigin(0.5);
          } else {
            this.add.text(x, y, `${index + 1}`, {
              fontSize: '10px', fontFamily: 'Courier New', color: '#333',
            }).setOrigin(0.5);
          }

          // Drop zone
          cell.setInteractive({ dropZone: true });
          this.diskSlots.push({ cell, index, x, y });
        } else {
          this.add.rectangle(x, y, cellSize, cellSize, 0x111111, 0.3)
            .setStrokeStyle(1, 0x222222);
          this.add.text(x, y, '🔒', { fontSize: '14px' }).setOrigin(0.5);
        }
      }
    }

    // Drag and drop
    this.input.on('drag', (pointer, gameObject, dragX, dragY) => {
      gameObject.x = dragX;
      gameObject.y = dragY;
    });

    this.input.on('drop', (pointer, gameObject, dropZone) => {
      // Find which disk slot was dropped on
      for (const slot of this.diskSlots) {
        const dist = Phaser.Math.Distance.Between(pointer.worldX, pointer.worldY, slot.x, slot.y);
        if (dist < 22) {
          // Equip token to this slot
          const token = gameObject.getData('token');
          const tokenIndex = gameObject.getData('tokenIndex');
          if (token) {
            console.log(`Equip token ${tokenIndex} to slot ${slot.index}`);
            // TODO: send to server
          }
          break;
        }
      }
      // Snap back
      gameObject.x = gameObject.input.dragStartX;
      gameObject.y = gameObject.input.dragStartY;
    });

    this.input.on('dragend', (pointer, gameObject) => {
      gameObject.x = gameObject.input.dragStartX;
      gameObject.y = gameObject.input.dragStartY;
    });
  }

  drawSkillList(centerX, startY) {
    this.add.text(centerX, startY, '已装备技能', {
      fontSize: '14px', fontFamily: 'Courier New', color: '#44ffaa',
    }).setOrigin(0.5);

    const skills = [
      SKILLS.BASIC_ATTACK,
      SKILLS.DODGE_ROLL,
      SKILLS.SHIELD,
      SKILLS.TOKEN_BURST,
    ];
    const keyLabels = ['Q', 'W', 'E', 'R'];

    skills.forEach((skill, i) => {
      const y = startY + 25 + i * 25;
      const costStr = skill.tokenCost > 0 ? `${skill.tokenCost}T` : 'FREE';
      this.add.text(centerX - 120, y, `[${keyLabels[i]}] ${skill.name}`, {
        fontSize: '12px', fontFamily: 'Courier New', color: '#aaa',
      });
      this.add.text(centerX + 80, y, costStr, {
        fontSize: '12px', fontFamily: 'Courier New',
        color: skill.tokenCost > 0 ? '#ffaa00' : '#666',
      });
    });
  }
}
