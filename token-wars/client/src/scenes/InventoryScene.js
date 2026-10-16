import net from '../systems/NetworkManager.js';
import { RARITY_CONFIG, SKILLS } from '../shared.js';
import { t, onLangChange } from '../i18n.js';

// SKILLS 常量展示名为中文；按协议 id 映射 i18n
const SKILL_VIEWS = [
  { skill: SKILLS.BASIC_ATTACK, id: 'basic_attack', key: 'Q' },
  { skill: SKILLS.DODGE_ROLL, id: 'dodge_roll', key: 'W' },
  { skill: SKILLS.SHIELD, id: 'shield', key: 'E' },
  { skill: SKILLS.TOKEN_BURST, id: 'token_burst', key: 'R' },
];

export class InventoryScene extends Phaser.Scene {
  constructor() {
    super({ key: 'InventoryScene' });
  }

  init(data) {
    this.playerData = data.player;
  }

  create() {
    const cx = 480;

    this.add.text(cx, 30, t('inv.title'), {
      fontSize: '28px', fontFamily: 'Courier New', color: '#44ffaa', fontStyle: 'bold',
    }).setOrigin(0.5);

    // Left panel: Token inventory
    this.drawTokenInventory(160, 80);

    // Right panel: Skill disk (4x4 grid)
    this.drawSkillDisk(640, 80);

    // Token counts
    this.add.text(160, 500, t('inv.unstable', { n: this.playerData.unstableTokens }), {
      fontSize: '14px', fontFamily: 'Courier New', color: '#ffaa00',
    });

    // Skill list
    this.drawSkillList(640, 460);

    // Back button
    this.add.text(50, 620, t('common.back'), {
      fontSize: '16px', fontFamily: 'Courier New', color: '#666666',
    }).setOrigin(0, 1).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.scene.start('LobbyScene', { player: this.playerData }));

    // 纯静态布局；语言切换用 restart 重绘（拖拽监听随场景销毁，无泄漏）
    this._offLang = onLangChange(() => this.scene.restart({ player: this.playerData }));
    this.events.once('shutdown', () => { if (this._offLang) this._offLang(); });
  }

  /** 稀有度短标签走 i18n（白/绿/蓝/紫/橙 ↔ 颜色英文名） */
  rarityLabel(rarity) {
    const key = `rarity.${rarity}`;
    const v = t(key);
    return v === key ? '?' : v;
  }

  drawTokenInventory(startX, startY) {
    this.add.text(startX, startY, t('inv.stableBag'), {
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
        this.add.text(x, y, this.rarityLabel(token.rarity), {
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
    for (const tok of tokens) {
      counts[tok.rarity] = (counts[tok.rarity] || 0) + 1;
    }
    let countStr = '';
    for (const rarity of Object.keys(RARITY_CONFIG)) {
      if (counts[rarity]) {
        countStr += `${this.rarityLabel(rarity)}${counts[rarity]}  `;
      }
    }
    if (countStr) {
      this.add.text(startX, startY + 220, countStr, {
        fontSize: '12px', fontFamily: 'Courier New', color: '#888',
      }).setOrigin(0.5);
    }
  }

  drawSkillDisk(centerX, startY) {
    this.add.text(centerX, startY, t('inv.skillDisk'), {
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
            this.add.text(x, y, this.rarityLabel(token.rarity), {
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
            net.emit('inventory:equip', { tokenIndex, slotIndex: slot.index });
            // Optimistic update: move token to slot visually
            const rarityColor = RARITY_CONFIG[token.rarity]?.color || 0x888888;
            slot.cell.setFillStyle(rarityColor, 0.2);
            this.add.text(slot.x, slot.y, this.rarityLabel(token.rarity), {
              fontSize: '14px', fontFamily: 'Courier New',
              color: `#${rarityColor.toString(16).padStart(6, '0')}`,
            }).setOrigin(0.5);
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
    this.add.text(centerX, startY, t('inv.equipped'), {
      fontSize: '14px', fontFamily: 'Courier New', color: '#44ffaa',
    }).setOrigin(0.5);

    SKILL_VIEWS.forEach(({ skill, id, key }, i) => {
      const y = startY + 25 + i * 25;
      const costStr = skill.tokenCost > 0 ? `${skill.tokenCost}T` : 'FREE';
      this.add.text(centerX - 120, y, `[${key}] ${t(`skill.${id}`)}`, {
        fontSize: '12px', fontFamily: 'Courier New', color: '#aaa',
      });
      this.add.text(centerX + 80, y, costStr, {
        fontSize: '12px', fontFamily: 'Courier New',
        color: skill.tokenCost > 0 ? '#ffaa00' : '#666',
      });
    });
  }
}
