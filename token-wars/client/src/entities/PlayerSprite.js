export class PlayerSprite {
  constructor(scene, x, y, playerData, isLocal) {
    this.scene = scene;
    this.id = playerData.id;
    this.isLocal = isLocal;
    this.targetX = x;
    this.targetY = y;

    // Visual: circle
    const color = isLocal ? 0x00ff88 : 0x4488ff;
    this.sprite = scene.add.circle(x * 32 + 16, y * 32 + 16, 14, color);
    this.sprite.setStrokeStyle(2, isLocal ? 0x88ffcc : 0x88aaff);

    // HP bar background
    this.hpBarBg = scene.add.rectangle(x * 32 + 16, y * 32 - 4, 28, 4, 0x333333);
    // HP bar
    this.hpBar = scene.add.rectangle(x * 32 + 16, y * 32 - 4, 28, 4, 0x00ff44);
    this.hpBar.setOrigin(0, 0.5);
    this.hpBar.x = x * 32 + 2;

    // Name label
    this.nameLabel = scene.add.text(x * 32 + 16, y * 32 - 12, playerData.username || '', {
      fontSize: '10px', fontFamily: 'Courier New', color: '#ffffff',
    }).setOrigin(0.5);

    this.hp = playerData.hp || 100;
    this.maxHp = playerData.maxHp || 100;
  }

  updatePosition(x, y) {
    this.targetX = x;
    this.targetY = y;
    // Smooth interpolation
    const worldX = x * 32 + 16;
    const worldY = y * 32 + 16;
    this.scene.tweens.add({
      targets: [this.sprite],
      x: worldX,
      y: worldY,
      duration: 50,
      ease: 'Linear',
    });
    this.hpBarBg.x = worldX;
    this.hpBarBg.y = worldY - 4;
    this.hpBar.x = worldX - 14;
    this.hpBar.y = worldY - 4;
    this.nameLabel.x = worldX;
    this.nameLabel.y = worldY - 12;
  }

  updateHp(hp, maxHp) {
    this.hp = hp;
    this.maxHp = maxHp;
    const pct = Math.max(hp / maxHp, 0);
    this.hpBar.width = 28 * pct;
    // Color: green > yellow > red
    if (pct > 0.5) this.hpBar.setFillStyle(0x00ff44);
    else if (pct > 0.25) this.hpBar.setFillStyle(0xffaa00);
    else this.hpBar.setFillStyle(0xff4444);
  }

  setShield(active) {
    if (active) {
      this.sprite.setStrokeStyle(3, 0x4488ff);
    } else {
      this.sprite.setStrokeStyle(2, this.isLocal ? 0x88ffcc : 0x88aaff);
    }
  }

  destroy() {
    this.sprite.destroy();
    this.hpBarBg.destroy();
    this.hpBar.destroy();
    this.nameLabel.destroy();
  }
}
