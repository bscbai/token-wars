export class InputManager {
  constructor(scene) {
    this.scene = scene;
    this.keys = {};
    this.lastMoveTime = 0;
    this.moveInterval = 100; // ms between moves

    // WASD
    this.keys.w = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.keys.a = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.keys.s = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    this.keys.d = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);

    // Arrow keys
    this.keys.up = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.UP);
    this.keys.left = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT);
    this.keys.down = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN);
    this.keys.right = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT);

    // Skill keys — Q/E/R/F (W is used for movement, no conflict)
    this.keys.q = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Q);
    this.keys.e = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.keys.r = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);
    this.keys.f = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.F);

    // Number keys (alternative skill)
    this.keys.one = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ONE);
    this.keys.two = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.TWO);
    this.keys.three = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.THREE);
    this.keys.four = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.FOUR);

    // Click for targeting
    this.lastClickPos = null;
    scene.input.on('pointerdown', (pointer) => {
      const tileX = Math.floor(pointer.worldX / 32);
      const tileY = Math.floor(pointer.worldY / 32);
      this.lastClickPos = { x: tileX, y: tileY };
    });
  }

  getMovement() {
    const now = Date.now();
    if (now - this.lastMoveTime < this.moveInterval) return null;

    let dx = 0, dy = 0;

    if (this.keys.a.isDown || this.keys.left.isDown) dx = -1;
    else if (this.keys.d.isDown || this.keys.right.isDown) dx = 1;
    else if (this.keys.w.isDown || this.keys.up.isDown) dy = -1;
    else if (this.keys.s.isDown || this.keys.down.isDown) dy = 1;

    if (dx === 0 && dy === 0) return null;

    this.lastMoveTime = now;
    return { dx, dy };
  }

  getSkillInput() {
    // Skill 0: Q or 1  |  Skill 1: E or 2  |  Skill 2: R or 3  |  Skill 3: F or 4
    if (Phaser.Input.Keyboard.JustDown(this.keys.q) || Phaser.Input.Keyboard.JustDown(this.keys.one)) {
      return { skillIndex: 0, target: this.lastClickPos };
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.e) || Phaser.Input.Keyboard.JustDown(this.keys.two)) {
      return { skillIndex: 1, target: this.lastClickPos };
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.r) || Phaser.Input.Keyboard.JustDown(this.keys.three)) {
      return { skillIndex: 2, target: this.lastClickPos };
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.f) || Phaser.Input.Keyboard.JustDown(this.keys.four)) {
      return { skillIndex: 3, target: this.lastClickPos };
    }
    return null;
  }

  consumeClick() {
    const pos = this.lastClickPos;
    this.lastClickPos = null;
    return pos;
  }
}
