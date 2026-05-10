export class HUD {
  constructor(scene, playerData) {
    this.scene = scene;

    // HP bar
    scene.add.text(20, 10, 'HP', { fontSize: '12px', fontFamily: 'Courier New', color: '#888' });
    this.hpBarBg = scene.add.rectangle(50, 16, 150, 14, 0x333333).setOrigin(0, 0.5);
    this.hpBar = scene.add.rectangle(50, 16, 150, 14, 0x00ff44).setOrigin(0, 0.5);
    this.hpText = scene.add.text(205, 10, `${playerData.hp}/${playerData.maxHp}`, {
      fontSize: '11px', fontFamily: 'Courier New', color: '#aaa',
    });

    // Shield bar
    scene.add.text(20, 28, 'SP', { fontSize: '12px', fontFamily: 'Courier New', color: '#888' });
    this.shieldBarBg = scene.add.rectangle(50, 34, 150, 10, 0x333333).setOrigin(0, 0.5);
    this.shieldBar = scene.add.rectangle(50, 34, 0, 10, 0x4488ff).setOrigin(0, 0.5);
    this.shieldText = scene.add.text(205, 28, '', {
      fontSize: '11px', fontFamily: 'Courier New', color: '#4488ff',
    });

    // Token count
    this.tokenText = scene.add.text(880, 10, `不稳定Token: ${playerData.unstableTokens}`, {
      fontSize: '14px', fontFamily: 'Courier New', color: '#ffaa00',
    }).setOrigin(1, 0);

    // Room / status
    this.statusText = scene.add.text(480, 10, '', {
      fontSize: '14px', fontFamily: 'Courier New', color: '#ffff00',
    }).setOrigin(0.5, 0);
  }

  updateHp(hp, maxHp) {
    const pct = Math.max(hp / maxHp, 0);
    this.hpBar.width = 150 * pct;
    this.hpText.setText(`${hp}/${maxHp}`);
    if (pct > 0.5) this.hpBar.setFillStyle(0x00ff44);
    else if (pct > 0.25) this.hpBar.setFillStyle(0xffaa00);
    else this.hpBar.setFillStyle(0xff4444);
  }

  updateShield(active, amount) {
    if (active) {
      this.shieldBar.width = Math.min(amount * 3, 150);
      this.shieldText.setText(`${amount}`);
    } else {
      this.shieldBar.width = 0;
      this.shieldText.setText('');
    }
  }

  updateTokens(unstable) {
    this.tokenText.setText(`不稳定Token: ${unstable}`);
  }

  setStatus(text) {
    this.statusText.setText(text);
  }
}
