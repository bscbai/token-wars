export class Projectile {
  constructor(scene, data) {
    this.scene = scene;
    this.id = data.id;

    const startX = data.x * 32 + 16;
    const startY = data.y * 32 + 16;
    const endX = data.targetX * 32 + 16;
    const endY = data.targetY * 32 + 16;

    // Visual: glowing line
    this.sprite = scene.add.circle(startX, startY, 4, 0xffff00);
    this.sprite.setStrokeStyle(1, 0xffaa00);

    // Trail effect
    this.trail = scene.add.graphics();
    this.trail.lineStyle(2, 0xffff00, 0.5);
    this.trail.lineBetween(startX, startY, startX, startY);

    // Animate to target
    const distance = Phaser.Math.Distance.Between(startX, startY, endX, endY);
    const duration = Math.max(distance * 2, 100);

    scene.tweens.add({
      targets: this.sprite,
      x: endX,
      y: endY,
      duration,
      ease: 'Linear',
      onComplete: () => this.destroy(),
    });
  }

  destroy() {
    if (this.sprite) this.sprite.destroy();
    if (this.trail) this.trail.destroy();
  }
}
