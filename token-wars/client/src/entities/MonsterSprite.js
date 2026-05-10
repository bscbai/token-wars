export class MonsterSprite {
  constructor(scene, monsterData) {
    this.scene = scene;
    this.id = monsterData.id;
    this.name = monsterData.name;

    const worldX = monsterData.x * 32 + 16;
    const worldY = monsterData.y * 32 + 16;
    const radius = monsterData.isBoss ? 20 : 12;
    const color = monsterData.color || 0xff4444;

    // Body
    this.sprite = scene.add.circle(worldX, worldY, radius, color);
    this.sprite.setStrokeStyle(2, 0xff8888);

    // HP bar
    this.hpBarBg = scene.add.rectangle(worldX, worldY - radius - 6, radius * 2, 4, 0x333333);
    this.hpBar = scene.add.rectangle(worldX - radius, worldY - radius - 6, radius * 2, 4, 0xff4444);
    this.hpBar.setOrigin(0, 0.5);

    // Name
    this.nameLabel = scene.add.text(worldX, worldY - radius - 16, monsterData.name, {
      fontSize: '10px', fontFamily: 'Courier New', color: '#ff8888',
    }).setOrigin(0.5);

    // Boss indicator
    if (monsterData.isBoss) {
      this.bossIndicator = scene.add.text(worldX, worldY - radius - 28, '★ BOSS ★', {
        fontSize: '12px', fontFamily: 'Courier New', color: '#ffff00', fontStyle: 'bold',
      }).setOrigin(0.5);
    }

    this.hp = monsterData.hp;
    this.maxHp = monsterData.maxHp;
    this.radius = radius;

    // Telegraph (danger zone indicator)
    this.telegraph = null;
  }

  updatePosition(x, y) {
    const worldX = x * 32 + 16;
    const worldY = y * 32 + 16;
    this.scene.tweens.add({
      targets: [this.sprite],
      x: worldX,
      y: worldY,
      duration: 80,
      ease: 'Linear',
    });
    this.hpBarBg.x = worldX;
    this.hpBarBg.y = worldY - this.radius - 6;
    this.hpBar.x = worldX - this.radius;
    this.hpBar.y = worldY - this.radius - 6;
    this.nameLabel.x = worldX;
    this.nameLabel.y = worldY - this.radius - 16;
    if (this.bossIndicator) {
      this.bossIndicator.x = worldX;
      this.bossIndicator.y = worldY - this.radius - 28;
    }
  }

  updateHp(hp, maxHp) {
    this.hp = hp;
    this.maxHp = maxHp;
    const pct = Math.max(hp / maxHp, 0);
    this.hpBar.width = this.radius * 2 * pct;
  }

  showTelegraph(x, y, radius, duration = 800) {
    const worldX = x * 32 + 16;
    const worldY = y * 32 + 16;
    this.telegraph = this.scene.add.circle(worldX, worldY, radius * 32, 0xff0000, 0.2);
    this.telegraph.setStrokeStyle(2, 0xff0000, 0.6);
    this.scene.time.delayedCall(duration, () => {
      if (this.telegraph) {
        this.telegraph.destroy();
        this.telegraph = null;
      }
    });
  }

  flashDamage() {
    this.sprite.setFillStyle(0xffffff);
    this.scene.time.delayedCall(100, () => {
      this.sprite.setFillStyle(this.sprite.fillColor || 0xff4444);
    });
  }

  destroy() {
    this.sprite.destroy();
    this.hpBarBg.destroy();
    this.hpBar.destroy();
    this.nameLabel.destroy();
    if (this.bossIndicator) this.bossIndicator.destroy();
    if (this.telegraph) this.telegraph.destroy();
  }
}
