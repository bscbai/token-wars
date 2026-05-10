export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload() {
    // Generate placeholder assets programmatically
    this.createPlaceholderAssets();
  }

  create() {
    this.scene.start('LoginScene');
  }

  createPlaceholderAssets() {
    // Player circle (green)
    const playerGfx = this.make.graphics({ add: false });
    playerGfx.fillStyle(0x00ff88, 1);
    playerGfx.fillCircle(16, 16, 16);
    playerGfx.generateTexture('player', 32, 32);
    playerGfx.destroy();

    // Monster circle (red)
    const monsterGfx = this.make.graphics({ add: false });
    monsterGfx.fillStyle(0xff4444, 1);
    monsterGfx.fillCircle(16, 16, 16);
    monsterGfx.generateTexture('monster', 32, 32);
    monsterGfx.destroy();

    // Boss circle (dark red, larger)
    const bossGfx = this.make.graphics({ add: false });
    bossGfx.fillStyle(0xcc0000, 1);
    bossGfx.fillCircle(24, 24, 24);
    bossGfx.generateTexture('boss', 48, 48);
    bossGfx.destroy();

    // Projectile line
    const projGfx = this.make.graphics({ add: false });
    projGfx.fillStyle(0xffff00, 1);
    projGfx.fillRect(0, 0, 8, 4);
    projGfx.generateTexture('projectile', 8, 4);
    projGfx.destroy();

    // Tile textures
    const floorGfx = this.make.graphics({ add: false });
    floorGfx.fillStyle(0x1a1a2e, 1);
    floorGfx.fillRect(0, 0, 32, 32);
    floorGfx.lineStyle(1, 0x2a2a4e, 0.3);
    floorGfx.strokeRect(0, 0, 32, 32);
    floorGfx.generateTexture('tile_floor', 32, 32);
    floorGfx.destroy();

    const wallGfx = this.make.graphics({ add: false });
    wallGfx.fillStyle(0x3a3a5e, 1);
    wallGfx.fillRect(0, 0, 32, 32);
    wallGfx.generateTexture('tile_wall', 32, 32);
    wallGfx.destroy();

    const hazardGfx = this.make.graphics({ add: false });
    hazardGfx.fillStyle(0x3a1a1a, 1);
    hazardGfx.fillRect(0, 0, 32, 32);
    hazardGfx.lineStyle(1, 0xff4444, 0.3);
    hazardGfx.strokeRect(0, 0, 32, 32);
    hazardGfx.generateTexture('tile_hazard', 32, 32);
    hazardGfx.destroy();
  }
}
