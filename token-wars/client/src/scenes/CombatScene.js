import net from '../systems/NetworkManager.js';
import { InputManager } from '../systems/InputManager.js';
import { PlayerSprite } from '../entities/PlayerSprite.js';
import { MonsterSprite } from '../entities/MonsterSprite.js';
import { HUD } from '../ui/HUD.js';
import { SkillBar } from '../ui/SkillBar.js';
import { MAP_WIDTH, MAP_HEIGHT, TILE, SKILLS } from '../shared.js';

export class CombatScene extends Phaser.Scene {
  constructor() {
    super({ key: 'CombatScene' });
  }

  init(data) {
    this.playerData = data.player;
    this.dungeonData = data.dungeonData;
    this.mode = data.mode || 'pve'; // 'pve' or 'pvp'
  }

  create() {
    // Camera setup
    this.cameras.main.setBackgroundColor('#0a0a1a');

    // Tilemap layer
    this.mapGroup = this.add.group();
    this.renderMap(this.dungeonData.mapData);

    // Entity sprites
    this.playerSprites = new Map();
    this.monsterSprites = new Map();
    this.projectiles = new Map();

    // Create local player sprite
    const localPlayer = {
      id: net.playerId || this.playerData.id,
      username: this.playerData.username,
      hp: this.playerData.hp,
      maxHp: this.playerData.maxHp,
    };
    const startX = this.dungeonData.playerPos?.x || 15;
    const startY = this.dungeonData.playerPos?.y || 28;
    this.localPlayerSprite = new PlayerSprite(this, startX, startY, localPlayer, true);
    this.playerSprites.set(localPlayer.id, this.localPlayerSprite);

    // Input
    this.inputManager = new InputManager(this);

    // UI
    this.hud = new HUD(this, this.playerData);
    const skillList = [
      SKILLS.BASIC_ATTACK,
      SKILLS.DODGE_ROLL,
      SKILLS.SHIELD,
      SKILLS.TOKEN_BURST,
    ];
    this.skillBar = new SkillBar(this, skillList);

    // Spawn monster sprites from dungeon data
    if (this.dungeonData.monsters) {
      for (const m of this.dungeonData.monsters) {
        const sprite = new MonsterSprite(this, m);
        this.monsterSprites.set(m.id, sprite);
      }
    }

    // Network listeners
    this.setupNetworkListeners();

    // Room info
    const roomIdx = this.dungeonData.roomIndex || 0;
    const totalRooms = 4; // from template
    this.hud.setStatus(`房间 ${roomIdx + 1} / ${totalRooms}`);

    // Death overlay (hidden)
    this.deathOverlay = this.add.container(480, 320);
    this.deathOverlay.setDepth(100);
    const deathBg = this.add.rectangle(0, 0, 400, 200, 0x000000, 0.8);
    this.deathText = this.add.text(0, -30, '你被击败了', {
      fontSize: '28px', fontFamily: 'Courier New', color: '#ff4444', fontStyle: 'bold',
    }).setOrigin(0.5);
    this.respawnText = this.add.text(0, 20, '5秒后重生...', {
      fontSize: '16px', fontFamily: 'Courier New', color: '#888888',
    }).setOrigin(0.5);
    this.deathOverlay.add([deathBg, this.deathText, this.respawnText]);
    this.deathOverlay.setVisible(false);

    // Victory overlay (hidden)
    this.victoryOverlay = this.add.container(480, 320);
    this.victoryOverlay.setDepth(100);
    const victoryBg = this.add.rectangle(0, 0, 500, 250, 0x000000, 0.8);
    this.victoryText = this.add.text(0, -60, '副本完成!', {
      fontSize: '32px', fontFamily: 'Courier New', color: '#00ff88', fontStyle: 'bold',
    }).setOrigin(0.5);
    this.victoryRewards = this.add.text(0, 0, '', {
      fontSize: '16px', fontFamily: 'Courier New', color: '#ffaa00',
    }).setOrigin(0.5);
    const returnBtn = this.add.text(0, 60, '[ 返回大厅 ]', {
      fontSize: '18px', fontFamily: 'Courier New', color: '#00ff88',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    returnBtn.on('pointerdown', () => {
      this.scene.start('LobbyScene', { player: this.playerData });
    });
    this.victoryOverlay.add([victoryBg, this.victoryText, this.victoryRewards, returnBtn]);
    this.victoryOverlay.setVisible(false);

    // Back button
    this.add.text(20, 620, '< 退出副本', {
      fontSize: '12px', fontFamily: 'Courier New', color: '#666',
    }).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.scene.start('LobbyScene', { player: this.playerData }));
  }

  update() {
    // Process input
    const move = this.inputManager.getMovement();
    if (move) {
      net.emit('input:move', move);
      // Client-side prediction
      const local = this.localPlayerSprite;
      if (local) {
        local.updatePosition(local.targetX + move.dx, local.targetY + move.dy);
      }
    }

    const skillInput = this.inputManager.getSkillInput();
    if (skillInput) {
      const target = skillInput.target;
      net.emit('input:skill', {
        skillId: skillInput.skillIndex,
        targetX: target?.x,
        targetY: target?.y,
      });
      this.skillBar.highlightSlot(skillInput.skillIndex);
    }
  }

  renderMap(mapData) {
    this.mapGroup.clear(true, true);
    if (!mapData) return;

    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        const tile = mapData[y]?.[x] ?? TILE.FLOOR;
        let texture = 'tile_floor';
        if (tile === TILE.WALL) texture = 'tile_wall';
        else if (tile === TILE.HAZARD) texture = 'tile_hazard';

        const img = this.add.image(x * 32 + 16, y * 32 + 16, texture);
        this.mapGroup.add(img);
      }
    }
  }

  setupNetworkListeners() {
    net.on('state:sync', (data) => {
      // Update monster positions
      if (data.monsters) {
        for (const mData of data.monsters) {
          let sprite = this.monsterSprites.get(mData.id);
          if (!sprite) {
            sprite = new MonsterSprite(this, mData);
            this.monsterSprites.set(mData.id, sprite);
          }
          sprite.updatePosition(mData.x, mData.y);
          sprite.updateHp(mData.hp, mData.maxHp);
        }
      }

      // Update player positions
      if (data.players) {
        for (const pData of data.players) {
          if (pData.id === (net.playerId || this.playerData.id)) {
            // Server position overrides prediction
            this.localPlayerSprite.updatePosition(pData.x, pData.y);
          }
        }
      }
    });

    net.on('combat:hit', (data) => {
      // Show damage number
      const targetSprite = this.monsterSprites.get(data.targetId) ||
                           this.playerSprites.get(data.targetId);
      if (targetSprite) {
        const worldX = targetSprite.sprite.x;
        const worldY = targetSprite.sprite.y;
        const dmgText = this.add.text(worldX, worldY - 20, `-${data.damage}`, {
          fontSize: '14px', fontFamily: 'Courier New',
          color: data.isCrit ? '#ffff00' : '#ff4444',
          fontStyle: data.isCrit ? 'bold' : 'normal',
        }).setOrigin(0.5);
        this.tweens.add({
          targets: dmgText,
          y: worldY - 50,
          alpha: 0,
          duration: 800,
          onComplete: () => dmgText.destroy(),
        });

        if (targetSprite.flashDamage) targetSprite.flashDamage();
      }
    });

    net.on('combat:death', (data) => {
      const monsterSprite = this.monsterSprites.get(data.entityId);
      if (monsterSprite) {
        // Death animation
        this.tweens.add({
          targets: monsterSprite.sprite,
          alpha: 0,
          scaleX: 0,
          scaleY: 0,
          duration: 300,
          onComplete: () => {
            monsterSprite.destroy();
            this.monsterSprites.delete(data.entityId);
          },
        });
      }
    });

    net.on('combat:shield', (data) => {
      if (data.playerId === (net.playerId || this.playerData.id)) {
        this.hud.updateShield(data.active, data.absorbRemaining);
        this.localPlayerSprite.setShield(data.active);
      }
    });

    net.on('player:update', (data) => {
      if (data.id === (net.playerId || this.playerData.id)) {
        this.hud.updateHp(data.hp, data.maxHp);
        this.hud.updateTokens(data.unstableTokens);
        this.localPlayerSprite.updateHp(data.hp, data.maxHp);
        this.playerData = { ...this.playerData, ...data };
      }
    });

    net.on('player:dead', (data) => {
      this.deathOverlay.setVisible(true);
      this.deathText.setText('你被击败了');
      const dropped = data.droppedTokens?.length || 0;
      this.respawnText.setText(`丢失了 ${dropped} 个稳定Token\n5秒后重生...`);

      // Countdown
      let countdown = 5;
      this.time.addEvent({
        delay: 1000,
        repeat: 4,
        callback: () => {
          countdown--;
          this.respawnText.setText(`丢失了 ${dropped} 个稳定Token\n${countdown}秒后重生...`);
        },
      });
    });

    net.on('player:respawn', (data) => {
      this.deathOverlay.setVisible(false);
      this.localPlayerSprite.updatePosition(data.x, data.y);
      this.hud.updateHp(this.playerData.maxHp, this.playerData.maxHp);
    });

    net.on('dungeon:room_clear', (data) => {
      this.hud.setStatus(`房间 ${data.nextRoom + 1} 清除完毕!`);
    });

    net.on('dungeon:start', (data) => {
      // New room
      this.renderMap(data.mapData);
      this.hud.setStatus(`房间 ${(data.roomIndex || 0) + 1}`);

      // Clear old monster sprites
      for (const [, sprite] of this.monsterSprites) {
        sprite.destroy();
      }
      this.monsterSprites.clear();

      // Spawn new monsters
      if (data.monsters) {
        for (const m of data.monsters) {
          const sprite = new MonsterSprite(this, m);
          this.monsterSprites.set(m.id, sprite);
        }
      }
    });

    net.on('dungeon:complete', (data) => {
      this.victoryOverlay.setVisible(true);
      const r = data.rewards;
      this.victoryRewards.setText(
        `奖励:\n+${r.unstable} 不稳定Token\n+${r.xp} XP`
      );
    });

    net.on('projectile:spawn', (data) => {
      // Projectile rendering handled by Projectile entity
    });

    // Update skill cooldowns each frame
    this.time.addEvent({
      delay: 100,
      loop: true,
      callback: () => {
        this.skillBar.updateCooldowns([
          { lastUsed: this.playerData.skills?.[0]?.lastUsed || 0, cooldown: SKILLS.BASIC_ATTACK.cooldown },
          { lastUsed: this.playerData.skills?.[1]?.lastUsed || 0, cooldown: SKILLS.DODGE_ROLL.cooldown },
          { lastUsed: this.playerData.skills?.[2]?.lastUsed || 0, cooldown: SKILLS.SHIELD.cooldown },
          { lastUsed: this.playerData.skills?.[3]?.lastUsed || 0, cooldown: SKILLS.TOKEN_BURST.cooldown },
        ]);
      },
    });
  }
}
