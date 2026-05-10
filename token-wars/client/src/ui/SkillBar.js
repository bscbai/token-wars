export class SkillBar {
  constructor(scene, skills) {
    this.scene = scene;
    this.skills = skills;
    this.slots = [];
    this.cooldownOverlays = [];

    const startX = 330;
    const y = 600;
    const slotSize = 56;
    const gap = 10;

    skills.forEach((skill, i) => {
      const x = startX + i * (slotSize + gap);

      // Background
      const bg = scene.add.rectangle(x, y, slotSize, slotSize, 0x1a1a2e, 0.9);
      bg.setStrokeStyle(2, 0x00ff88);

      // Key label
      const keyLabels = ['Q', 'W', 'E', 'R'];
      scene.add.text(x - slotSize / 2 + 4, y - slotSize / 2 + 2, keyLabels[i], {
        fontSize: '10px', fontFamily: 'Courier New', color: '#666',
      });

      // Skill name (abbreviated)
      scene.add.text(x, y - 6, skill.name.substring(0, 3), {
        fontSize: '12px', fontFamily: 'Courier New', color: '#00ff88',
      }).setOrigin(0.5);

      // Token cost
      scene.add.text(x, y + 14, skill.tokenCost > 0 ? `${skill.tokenCost}T` : 'FREE', {
        fontSize: '10px', fontFamily: 'Courier New',
        color: skill.tokenCost > 0 ? '#ffaa00' : '#888888',
      }).setOrigin(0.5);

      // Cooldown overlay
      const cdOverlay = scene.add.rectangle(x, y, slotSize, slotSize, 0x000000, 0.6);
      cdOverlay.setVisible(false);

      // Cooldown text
      const cdText = scene.add.text(x, y, '', {
        fontSize: '16px', fontFamily: 'Courier New', color: '#ffffff', fontStyle: 'bold',
      }).setOrigin(0.5);
      cdText.setVisible(false);

      this.slots.push({ bg, x, y });
      this.cooldownOverlays.push({ overlay: cdOverlay, text: cdText, lastUsed: 0, cooldown: skill.cooldown });
    });
  }

  updateCooldowns(skills) {
    const now = Date.now();
    skills.forEach((skill, i) => {
      const cd = this.cooldownOverlays[i];
      if (!cd) return;

      const elapsed = now - skill.lastUsed;
      if (elapsed < skill.cooldown) {
        cd.overlay.setVisible(true);
        cd.text.setVisible(true);
        const remaining = Math.ceil((skill.cooldown - elapsed) / 1000);
        cd.text.setText(`${remaining}`);
        // Shrink overlay from top
        const pct = elapsed / skill.cooldown;
        cd.overlay.height = (1 - pct) * 56;
        cd.overlay.y = this.slots[i].y - (56 - cd.overlay.height) / 2;
      } else {
        cd.overlay.setVisible(false);
        cd.text.setVisible(false);
      }
    });
  }

  highlightSlot(index) {
    if (this.slots[index]) {
      this.slots[index].bg.setStrokeStyle(3, 0xffffff);
      this.scene.time.delayedCall(200, () => {
        this.slots[index].bg.setStrokeStyle(2, 0x00ff88);
      });
    }
  }
}
