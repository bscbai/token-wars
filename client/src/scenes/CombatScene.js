// Token Wars: 算力征途 - PvP Combat Scene
// Cyberpunk arena with WASD movement, attack/shoot/dash and real-time multiplayer
class CombatScene extends Phaser.Scene {
  constructor() {
    super({ key: 'CombatScene' });
  }

  /* ======================== CREATE ======================== */
  create() {
    var self = this;
    var E = window.TokenWars.EVENTS;
    var C = window.TokenWars.COMBAT;
    var W = this.scale.width;
    var H = this.scale.height;

    // State
    this.localPlayer = null;
    this.remotePlayers = new Map();
    this.projectiles = new Map();
    this.hp = C.PLAYER_HP;
    this.maxHp = C.PLAYER_HP;
    this.tokens = 0;
    this.facingAngle = 0;
    this.lastMoveEmit = 0;
    this.lastSyncEmit = 0;
    this.attackCooldown = 0;
    this.shootCooldown = 0;
    this.dashCooldown = 0;
    this.dashActive = false;
    this.playerColors = [0x00ff88, 0xff4488, 0x44aaff, 0xffaa00, 0xcc44ff, 0xff4444, 0x44ffaa, 0xaaff44];

    // Input
    this.keys = {
      W: this.input.keyboard.addKey('W'),
      A: this.input.keyboard.addKey('A'),
      S: this.input.keyboard.addKey('S'),
      D: this.input.keyboard.addKey('D'),
      UP: this.input.keyboard.addKey('UP'),
      DOWN: this.input.keyboard.addKey('DOWN'),
      LEFT: this.input.keyboard.addKey('LEFT'),
      RIGHT: this.input.keyboard.addKey('RIGHT'),
      J: this.input.keyboard.addKey('J'),
      K: this.input.keyboard.addKey('K'),
      SPACE: this.input.keyboard.addKey('SPACE'),
      ESC: this.input.keyboard.addKey('ESC')
    };

    // Bind ESC
    this.keys.ESC.on('down', function() {
      self._cleanup();
      self.scene.start('LobbyScene');
    });

    // World bounds
    var margin = 100;
    this.worldBounds = {
      minX: margin,
      maxX: W - margin,
      minY: margin,
      maxY: H - margin
    };

    // Background
    this.drawArenaBackground(W, H);

    // Create local player triangle
    this.createLocalPlayer(W, H);

    // HUD
    this.createHUD(W, H);

    // Minimap
    this.createMinimap(W, H);

    // Network setup
    this._setupNetwork(E, C);

    // Connect if not connected
    if (!window.NetworkManager.isConnected()) {
      window.NetworkManager.connect('');
    }
  }

  /* ======================== BACKGROUND ======================== */
  drawArenaBackground(W, H) {
    var gfx = this.add.graphics();
    gfx.setDepth(-1);

    // Dark base
    gfx.fillStyle(0x0a0a1a, 1);
    gfx.fillRect(0, 0, W, H);

    // Grid
    var gs = 50;
    gfx.lineStyle(1, 0x004422, 0.15);
    for (var x = 0; x <= W; x += gs) {
      gfx.beginPath();
      gfx.moveTo(x, 0);
      gfx.lineTo(x, H);
      gfx.strokePath();
    }
    for (var y = 0; y <= H; y += gs) {
      gfx.beginPath();
      gfx.moveTo(0, y);
      gfx.lineTo(W, y);
      gfx.strokePath();
    }

    // Arena border
    var b = 100;
    gfx.lineStyle(2, 0x00ff44, 0.4);
    gfx.strokeRect(b, b, W - b * 2, H - b * 2);

    // Corner markers
    var cs = 30;
    gfx.lineStyle(2, 0x00ff44, 0.7);
    drawCorner(gfx, b, b, cs);
    drawCorner(gfx, W - b, b, cs);
    drawCorner(gfx, b, H - b, cs);
    drawCorner(gfx, W - b, H - b, cs);

    function drawCorner(g, cx, cy, s) {
      g.beginPath();
      g.moveTo(cx, cy + s);
      g.lineTo(cx, cy);
      g.lineTo(cx + s, cy);
      g.strokePath();
      g.beginPath();
      g.moveTo(cx, cy - s);
      g.lineTo(cx, cy);
      g.lineTo(cx + s, cy);
      g.strokePath();
      g.beginPath();
      g.moveTo(cx, cy - s);
      g.lineTo(cx, cy);
      g.lineTo(cx - s, cy);
      g.strokePath();
      g.beginPath();
      g.moveTo(cx, cy + s);
      g.lineTo(cx, cy);
      g.lineTo(cx - s, cy);
      g.strokePath();
    }
  }

  /* ======================== LOCAL PLAYER ======================== */
  createLocalPlayer(W, H) {
    var C = window.TokenWars.COMBAT;
    this.hp = C.PLAYER_HP;
    this.maxHp = C.PLAYER_HP;

    // Triangle sprite
    var gfx = this.add.graphics();
    gfx.setDepth(20);

    // Body
    gfx.fillStyle(0x00ff88, 1);
    gfx.beginPath();
    gfx.moveTo(0, -15);
    gfx.lineTo(-12, 10);
    gfx.lineTo(0, 6);
    gfx.lineTo(12, 10);
    gfx.closePath();
    gfx.fillPath();

    // Outline
    gfx.lineStyle(2, 0x00ff44, 1);
    gfx.beginPath();
    gfx.moveTo(0, -15);
    gfx.lineTo(-12, 10);
    gfx.lineTo(0, 6);
    gfx.lineTo(12, 10);
    gfx.closePath();
    gfx.strokePath();

    // Center dot
    gfx.fillStyle(0xffffff, 0.8);
    gfx.fillCircle(0, 0, 2);

    this.localPlayer = gfx;
    this.localPlayer.x = W / 2;
    this.localPlayer.y = H / 2;

    // Name tag
    this.localNameTag = this.add.text(W / 2, H / 2 - 22, '你', {
      fontFamily: '"Courier New", monospace',
      fontSize: '11px',
      color: '#00ff88'
    }).setOrigin(0.5).setDepth(21);
  }

  /* ======================== HUD ======================== */
  createHUD(W, H) {
    var hudDepth = 100;

    // HP Bar background
    var hpGfx = this.add.graphics();
    hpGfx.setDepth(hudDepth);
    hpGfx.fillStyle(0x333333, 0.8);
    hpGfx.fillRoundedRect(10, 10, 200, 20, 4);

    this.hpBarFill = this.add.graphics();
    this.hpBarFill.setDepth(hudDepth + 1);

    this.hpText = this.add.text(110, 12, 'HP: 100 / 100', {
      fontFamily: '"Courier New", monospace',
      fontSize: '14px',
      color: '#ffffff'
    }).setOrigin(0.5, 0).setDepth(hudDepth + 2);

    this._updateHPBar();

    // Token counter
    this.tokenText = this.add.text(W - 10, 10, 'Token: 0', {
      fontFamily: '"Courier New", monospace',
      fontSize: '16px',
      color: '#ffcc00',
      align: 'right',
      stroke: '#000000',
      strokeThickness: 2
    }).setOrigin(1, 0).setDepth(hudDepth);

    // Cooldown indicators
    var cdY = H - 60;
    this.skillTexts = {
      attack: this.add.text(15, cdY, '⚔️ 就绪', { fontFamily: '"Courier New", monospace', fontSize: '13px', color: '#00ff88' }).setDepth(hudDepth),
      shoot: this.add.text(15, cdY + 20, '🏹 就绪', { fontFamily: '"Courier New", monospace', fontSize: '13px', color: '#00ff88' }).setDepth(hudDepth),
      dash: this.add.text(15, cdY + 40, '💨 就绪', { fontFamily: '"Courier New", monospace', fontSize: '13px', color: '#00ff88' }).setDepth(hudDepth)
    };

    // Controls hint
    this.add.text(W - 10, H - 10, 'WASD移动 | J攻击 | K射击 | SPACE闪避 | ESC返回', {
      fontFamily: '"Courier New", monospace',
      fontSize: '10px',
      color: '#00ff4466',
      align: 'right'
    }).setOrigin(1, 0.5).setDepth(hudDepth);
  }

  _updateHPBar() {
    var ratio = Math.max(0, this.hp / this.maxHp);
    var color = ratio > 0.5 ? 0x00ff44 : ratio > 0.25 ? 0xffaa00 : 0xff3333;
    this.hpBarFill.clear();
    this.hpBarFill.fillStyle(color, 0.9);
    this.hpBarFill.fillRoundedRect(12, 12, 196 * ratio, 16, 3);
    this.hpText.setText('HP: ' + Math.ceil(this.hp) + ' / ' + this.maxHp);
  }

  /* ======================== MINIMAP ======================== */
  createMinimap(W, H) {
    var mmW = 150;
    var mmH = 150;
    var mmX = W - mmW - 10;
    var mmY = H - mmH - 80;

    this.minimapBg = this.add.graphics();
    this.minimapBg.setDepth(90);
    this.minimapBg.fillStyle(0x000000, 0.6);
    this.minimapBg.fillRect(mmX, mmY, mmW, mmH);
    this.minimapBg.lineStyle(1, 0x00ff44, 0.5);
    this.minimapBg.strokeRect(mmX, mmY, mmW, mmH);

    this.minimapDots = this.add.graphics();
    this.minimapDots.setDepth(91);

    this.minimapConfig = {
      x: mmX,
      y: mmY,
      w: mmW,
      h: mmH,
      worldW: W - 200,  // minus margins
      worldH: H - 200
    };
  }

  _updateMinimap() {
    var g = this.minimapDots;
    var cfg = this.minimapConfig;
    g.clear();

    // Clamp helper
    var clampX = function(wx) {
      return cfg.x + ((wx - 100) / cfg.worldW) * cfg.w;
    };
    var clampY = function(wy) {
      return cfg.y + ((wy - 100) / cfg.worldH) * cfg.h;
    };

    // Local player
    if (this.localPlayer) {
      var lx = Phaser.Math.Clamp(clampX(this.localPlayer.x), cfg.x + 1, cfg.x + cfg.w - 1);
      var ly = Phaser.Math.Clamp(clampY(this.localPlayer.y), cfg.y + 1, cfg.y + cfg.h - 1);
      g.fillStyle(0x00ff88, 1);
      g.fillCircle(lx, ly, 3);
    }

    // Remote players
    var self = this;
    this.remotePlayers.forEach(function(psprite, pid) {
      var rx = Phaser.Math.Clamp(clampX(psprite.x), cfg.x + 1, cfg.x + cfg.w - 1);
      var ry = Phaser.Math.Clamp(clampY(psprite.y), cfg.y + 1, cfg.y + cfg.h - 1);
      g.fillStyle(psprite.playerColor || 0xff4488, 1);
      g.fillCircle(rx, ry, 2);
    });

    // Projectiles
    this.projectiles.forEach(function(proj, pid) {
      var px = Phaser.Math.Clamp(clampX(proj.x), cfg.x + 1, cfg.x + cfg.w - 1);
      var py = Phaser.Math.Clamp(clampY(proj.y), cfg.y + 1, cfg.y + cfg.h - 1);
      g.fillStyle(0xffff00, 0.7);
      g.fillCircle(px, py, 1);
    });
  }

  /* ======================== UPDATE ======================== */
  update(time, delta) {
    if (!this.localPlayer) return;

    var C = window.TokenWars.COMBAT;
    var E = window.TokenWars.EVENTS;
    var moveX = 0;
    var moveY = 0;
    var speed = C.PLAYER_SPEED;

    // Movement
    if (this.keys.W.isDown || this.keys.UP.isDown) moveY = -1;
    if (this.keys.S.isDown || this.keys.DOWN.isDown) moveY = 1;
    if (this.keys.A.isDown || this.keys.LEFT.isDown) moveX = -1;
    if (this.keys.D.isDown || this.keys.RIGHT.isDown) moveX = 1;

    if (moveX !== 0 || moveY !== 0) {
      // Normalize
      var len = Math.sqrt(moveX * moveX + moveY * moveY);
      moveX /= len;
      moveY /= len;

      // Update facing angle
      this.facingAngle = Math.atan2(moveY, moveX);

      // Apply speed
      var dx = moveX * speed * (delta / 1000);
      var dy = moveY * speed * (delta / 1000);

      this.localPlayer.x = Phaser.Math.Clamp(
        this.localPlayer.x + dx,
        this.worldBounds.minX,
        this.worldBounds.maxX
      );
      this.localPlayer.y = Phaser.Math.Clamp(
        this.localPlayer.y + dy,
        this.worldBounds.minY,
        this.worldBounds.maxY
      );

      // Rotate to face direction
      this.localPlayer.rotation = this.facingAngle + Math.PI / 2;

      // Update name tag
      if (this.localNameTag) {
        this.localNameTag.x = this.localPlayer.x;
        this.localNameTag.y = this.localPlayer.y - 22;
      }

      // Throttled move emit
      if (time - this.lastMoveEmit > 50) {
        window.NetworkManager.emit(E.PLAYER_MOVE, {
          x: this.localPlayer.x,
          y: this.localPlayer.y,
          angle: this.facingAngle
        });
        this.lastMoveEmit = time;
      }
    }

    // State sync (every 100ms)
    if (time - this.lastSyncEmit > 100) {
      window.NetworkManager.emit(E.STATE_SYNC, {
        x: this.localPlayer.x,
        y: this.localPlayer.y,
        angle: this.facingAngle,
        hp: this.hp
      });
      this.lastSyncEmit = time;
    }

    // Attack (J)
    if (Phaser.Input.Keyboard.JustDown(this.keys.J) && this.attackCooldown <= 0) {
      this._doAttack(time, E, C);
    }

    // Shoot (K)
    if (Phaser.Input.Keyboard.JustDown(this.keys.K) && this.shootCooldown <= 0) {
      this._doShoot(time, E, C);
    }

    // Dash (Space)
    if (Phaser.Input.Keyboard.JustDown(this.keys.SPACE) && this.dashCooldown <= 0) {
      this._doDash(time, E, C);
    }

    // Cooldown updates
    this.attackCooldown = Math.max(0, this.attackCooldown - delta);
    this.shootCooldown = Math.max(0, this.shootCooldown - delta);
    this.dashCooldown = Math.max(0, this.dashCooldown - delta);

    this._updateCooldownUI();

    // Minimap
    this._updateMinimap();
  }

  /* ======================== COMBAT ACTIONS ======================== */
  _doAttack(time, E, C) {
    var self = this;
    this.attackCooldown = C.ATTACK_COOLDOWN;

    window.NetworkManager.emit(E.PLAYER_ATTACK, {
      x: this.localPlayer.x,
      y: this.localPlayer.y,
      angle: this.facingAngle
    });

    // Visual: slash arc
    var slash = this.add.graphics();
    slash.setDepth(25);
    slash.lineStyle(3, 0x00ff88, 0.9);

    var px = this.localPlayer.x;
    var py = this.localPlayer.y;
    var startAngle = this.facingAngle - 0.5;
    var endAngle = this.facingAngle + 0.5;

    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 200,
      onUpdate: function(tween) {
        var p = tween.getValue();
        slash.clear();
        slash.lineStyle(3, 0x00ff88, 0.9 * (1 - p));
        slash.beginPath();
        slash.arc(px, py, C.ATTACK_RANGE, startAngle, startAngle + (endAngle - startAngle) * p);
        slash.strokePath();
      },
      onComplete: function() {
        slash.destroy();
      }
    });

    // Check for nearby remote players (client-side prediction for feedback)
    var nearestDist = Infinity;
    var nearestPlayer = null;
    this.remotePlayers.forEach(function(psprite, pid) {
      var dist = Phaser.Math.Distance.Between(px, py, psprite.x, psprite.y);
      if (dist < C.ATTACK_RANGE && dist < nearestDist) {
        nearestDist = dist;
        nearestPlayer = psprite;
      }
    });

    if (nearestPlayer) {
      this._showImpactFlash(nearestPlayer.x, nearestPlayer.y);
    }
  }

  _doShoot(time, E, C) {
    var self = this;
    this.shootCooldown = C.SHOOT_COOLDOWN;

    window.NetworkManager.emit(E.PLAYER_SHOOT, {
      x: this.localPlayer.x,
      y: this.localPlayer.y,
      angle: this.facingAngle
    });

    // Visual: projectile
    var dirX = Math.cos(this.facingAngle);
    var dirY = Math.sin(this.facingAngle);
    var px = this.localPlayer.x;
    var py = this.localPlayer.y;

    var bolt = this.add.graphics();
    bolt.setDepth(15);

    var traveled = 0;
    var maxDist = C.SHOOT_RANGE;
    var lifeMs = (maxDist / C.SHOOT_SPEED) * 1000;
    var speed = C.SHOOT_SPEED;
    var startTime = time;

    bolt.projectileTimer = this.time.addEvent({
      delay: 20,
      repeat: Math.floor(lifeMs / 20),
      callback: function() {
        traveled += speed * 0.02;
        var cx = px + dirX * traveled;
        var cy = py + dirY * traveled;

        bolt.clear();
        // Trail line
        bolt.lineStyle(2, 0xffcc00, 0.6);
        bolt.beginPath();
        bolt.moveTo(cx - dirX * 15, cy - dirY * 15);
        bolt.lineTo(cx, cy);
        bolt.strokePath();
        // Head
        bolt.fillStyle(0xffffff, 0.9);
        bolt.fillCircle(cx, cy, 3);
        bolt.fillStyle(0xffcc00, 0.5);
        bolt.fillCircle(cx, cy, 6);

        if (traveled >= maxDist) {
          bolt.projectileTimer.destroy();
          bolt.destroy();
        }
      }
    });
  }

  _doDash(time, E, C) {
    var self = this;
    this.dashCooldown = C.DASH_COOLDOWN;
    this.dashActive = true;

    window.NetworkManager.emit(E.PLAYER_DASH, {
      x: this.localPlayer.x,
      y: this.localPlayer.y,
      angle: this.facingAngle
    });

    // Dash tween
    var dirX = Math.cos(this.facingAngle);
    var dirY = Math.sin(this.facingAngle);
    var startX = this.localPlayer.x;
    var startY = this.localPlayer.y;
    var targetX = Phaser.Math.Clamp(startX + dirX * C.DASH_DISTANCE, this.worldBounds.minX, this.worldBounds.maxX);
    var targetY = Phaser.Math.Clamp(startY + dirY * C.DASH_DISTANCE, this.worldBounds.minY, this.worldBounds.maxY);

    // Trail effect
    var trail = this.add.graphics();
    trail.setDepth(19);

    this.tweens.add({
      targets: trail,
      alpha: 0,
      duration: 300,
      onUpdate: function() {
        trail.clear();
        trail.fillStyle(0x00ff88, 0.3);
        trail.fillCircle(self.localPlayer.x, self.localPlayer.y, 8);
      },
      onComplete: function() {
        trail.destroy();
      }
    });

    this.tweens.add({
      targets: this.localPlayer,
      x: targetX,
      y: targetY,
      duration: 200,
      ease: 'Power2',
      onUpdate: function() {
        self.localNameTag.x = self.localPlayer.x;
        self.localNameTag.y = self.localPlayer.y - 22;
      },
      onComplete: function() {
        self.localNameTag.x = self.localPlayer.x;
        self.localNameTag.y = self.localPlayer.y - 22;
        self.dashActive = false;
      }
    });
  }

  _showImpactFlash(x, y) {
    var flash = this.add.graphics();
    flash.setDepth(30);
    flash.fillStyle(0xffffff, 0.8);
    flash.fillCircle(x, y, 20);

    this.tweens.add({
      targets: flash,
      alpha: 0,
      duration: 100,
      onComplete: function() {
        flash.destroy();
      }
    });
  }

  /* ======================== COOLDOWN UI ======================== */
  _updateCooldownUI() {
    var ac = this.attackCooldown > 0;
    var sc = this.shootCooldown > 0;
    var dc = this.dashCooldown > 0;
    var C = window.TokenWars.COMBAT;

    this.skillTexts.attack.setText(ac ? '⚔️ ' + (this.attackCooldown / 1000).toFixed(1) + 's' : '⚔️ 就绪');
    this.skillTexts.attack.setColor(ac ? '#ff444488' : '#00ff88');
    this.skillTexts.shoot.setText(sc ? '🏹 ' + (this.shootCooldown / 1000).toFixed(1) + 's' : '🏹 就绪');
    this.skillTexts.shoot.setColor(sc ? '#ff444488' : '#00ff88');
    this.skillTexts.dash.setText(dc ? '💨 ' + (this.dashCooldown / 1000).toFixed(1) + 's' : '💨 就绪');
    this.skillTexts.dash.setColor(dc ? '#ff444488' : '#00ff88');
  }

  /* ======================== NETWORK ======================== */
  _setupNetwork(E, C) {
    var self = this;

    // State sync: update individual remote player
    window.NetworkManager.on(E.STATE_SYNC, function(data) {
      if (!data || !data.id) return;
      if (data.hp <= 0) return; // Skip dead players

      if (self.remotePlayers.has(data.id)) {
        var ps = self.remotePlayers.get(data.id);
        ps.x = data.x;
        ps.y = data.y;
        ps.rotation = (data.angle || 0) + Math.PI / 2;
        if (ps.nameTag) {
          ps.nameTag.x = data.x;
          ps.nameTag.y = data.y - 22;
        }
      } else {
        // Create new remote player from state sync
        var colorIdx = self.remotePlayers.size % self.playerColors.length;
        var color = self.playerColors[colorIdx];
        self._createRemotePlayer(data.id, data.x, data.y, color, data.id);
      }
    });

    // Player joined
    window.NetworkManager.on(E.PLAYER_JOINED, function(data) {
      if (data && data.id && data.x !== undefined) {
        var colorIdx = self.remotePlayers.size % self.playerColors.length;
        var color = self.playerColors[colorIdx];
        self._createRemotePlayer(data.id, data.x, data.y, color, data.name || data.id);
      }
    });

    // Player left
    window.NetworkManager.on(E.PLAYER_LEFT, function(data) {
      if (data && data.id) {
        self._removeRemotePlayer(data.id);
      }
    });

    // Player move
    window.NetworkManager.on(E.PLAYER_MOVE, function(data) {
      if (data && data.id && self.remotePlayers.has(data.id)) {
        var ps = self.remotePlayers.get(data.id);
        ps.x = data.x;
        ps.y = data.y;
        ps.rotation = (data.angle || 0) + Math.PI / 2;
        if (ps.nameTag) {
          ps.nameTag.x = data.x;
          ps.nameTag.y = data.y - 22;
        }
      }
    });

    // Player attack
    window.NetworkManager.on(E.PLAYER_ATTACK, function(data) {
      if (data && data.id && self.remotePlayers.has(data.id)) {
        var ps = self.remotePlayers.get(data.id);

        // Show attack arc on remote player
        var slash = self.add.graphics();
        slash.setDepth(25);
        var px = ps.x;
        var py = ps.y;
        var angle = data.angle || 0;
        self.tweens.addCounter({
          from: 0,
          to: 1,
          duration: 200,
          onUpdate: function(tween) {
            var p = tween.getValue();
            slash.clear();
            slash.lineStyle(3, ps.playerColor || 0xff4488, 0.9 * (1 - p));
            slash.beginPath();
            slash.arc(px, py, C.ATTACK_RANGE, angle - 0.5, angle - 0.5 + 1.0 * p);
            slash.strokePath();
          },
          onComplete: function() {
            slash.destroy();
          }
        });
      }
    });

    // Player shoot
    window.NetworkManager.on(E.PLAYER_SHOOT, function(data) {
      if (data && data.id && self.remotePlayers.has(data.id)) {
        var ps = self.remotePlayers.get(data.id);

        var dirX = Math.cos(data.angle || 0);
        var dirY = Math.sin(data.angle || 0);
        var px = ps.x;
        var py = ps.y;

        var bolt = self.add.graphics();
        bolt.setDepth(15);

        var traveled = 0;
        var maxDist = C.SHOOT_RANGE;
        var lifeMs = (maxDist / C.SHOOT_SPEED) * 1000;

        bolt.projectileTimer = self.time.addEvent({
          delay: 20,
          repeat: Math.floor(lifeMs / 20),
          callback: function() {
            traveled += C.SHOOT_SPEED * 0.02;
            var cx = px + dirX * traveled;
            var cy = py + dirY * traveled;

            bolt.clear();
            bolt.lineStyle(2, 0xffcc00, 0.6);
            bolt.beginPath();
            bolt.moveTo(cx - dirX * 15, cy - dirY * 15);
            bolt.lineTo(cx, cy);
            bolt.strokePath();
            bolt.fillStyle(0xffffff, 0.9);
            bolt.fillCircle(cx, cy, 3);

            if (traveled >= maxDist) {
              bolt.projectileTimer.destroy();
              bolt.destroy();
            }
          }
        });
      }
    });

    // Player dash
    window.NetworkManager.on(E.PLAYER_DASH, function(data) {
      if (data && data.id && self.remotePlayers.has(data.id)) {
        var ps = self.remotePlayers.get(data.id);

        // Dash effect on remote
        var dirX = Math.cos(data.angle || 0);
        var dirY = Math.sin(data.angle || 0);
        var targetX = data.x + dirX * C.DASH_DISTANCE;
        var targetY = data.y + dirY * C.DASH_DISTANCE;

        self.tweens.add({
          targets: ps,
          x: targetX,
          y: targetY,
          duration: 200,
          ease: 'Power2',
          onUpdate: function() {
            if (ps.nameTag) { ps.nameTag.x = ps.x; ps.nameTag.y = ps.y - 22; }
          }
        });
      }
    });

    // Projectile spawn (server converts PLAYER_SHOOT → PROJECTILE_SPAWN for remote clients)
    window.NetworkManager.on(E.PROJECTILE_SPAWN, function(data) {
      if (!data || !data.projectileId) return;

      var startX = data.x;
      var startY = data.y;
      var angle = data.angle || 0;
      var dirX = data.dirX || Math.cos(angle);
      var dirY = data.dirY || Math.sin(angle);

      // Store for minimap tracking
      self.projectiles.set(data.projectileId, {
        id: data.projectileId,
        x: startX,
        y: startY,
        dirX: dirX,
        dirY: dirY,
        angle: angle,
        ownerColor: 0xffcc00
      });

      // Render the projectile as a glowing bolt
      var bolt = self.add.graphics();
      bolt.setDepth(15);

      var traveled = 0;
      var maxDist = C.SHOOT_RANGE;
      var speed = C.SHOOT_SPEED;

      bolt.projectileTimer = self.time.addEvent({
        delay: 20,
        repeat: Math.floor((maxDist / speed * 1000) / 20),
        callback: function() {
          traveled += speed * 0.02;
          var cx = startX + dirX * traveled;
          var cy = startY + dirY * traveled;

          // Update stored position for minimap
          var proj = self.projectiles.get(data.projectileId);
          if (proj) {
            proj.x = cx;
            proj.y = cy;
          }

          bolt.clear();
          // Trail line
          bolt.lineStyle(2, 0xffcc00, 0.6);
          bolt.beginPath();
          bolt.moveTo(cx - dirX * 15, cy - dirY * 15);
          bolt.lineTo(cx, cy);
          bolt.strokePath();
          // Glowing head
          bolt.fillStyle(0xffffff, 0.9);
          bolt.fillCircle(cx, cy, 3);
          bolt.fillStyle(0xffcc00, 0.5);
          bolt.fillCircle(cx, cy, 6);

          if (traveled >= maxDist) {
            bolt.projectileTimer.destroy();
            bolt.destroy();
            self.projectiles.delete(data.projectileId);
          }
        }
      });
    });

    // Projectile hit
    window.NetworkManager.on(E.PROJECTILE_HIT, function(data) {
      if (data) {
        self._showImpactFlash(data.x, data.y);
      }
    });

    // Projectile destroy
    window.NetworkManager.on(E.PROJECTILE_DESTROY, function(data) {
      if (data && data.id) {
        self.projectiles.delete(data.id);
      }
    });

    // Player died
    window.NetworkManager.on(E.PLAYER_DIED, function(data) {
      if (data && data.id) {
        if (self.remotePlayers.has(data.id)) {
          self._playDeathAnimation(data.id);
        }
      }
    });

    // Chat broadcast
    window.NetworkManager.on(E.CHAT_BROADCAST, function(data) {
      if (data && data.message) {
        self._showChatBubble(data.x, data.y, data.message);
      }
    });

    // Token update
    window.NetworkManager.on(E.TOKEN_UPDATE, function(data) {
      if (data && data.balance !== undefined) {
        self.tokens = data.balance;
        self.tokenText.setText('Token: ' + self.tokens);
      }
    });

    // HP update (from server combat resolution)
    window.NetworkManager.on(E.HP_UPDATE, function(data) {
      if (data) {
        self.hp = data.hp;
        self._updateHPBar();
        if (self.hp <= 0) {
          self._playDeathAnimation(null);
        }
      }
    });
  }

  /* ======================== REMOTE PLAYER HELPERS ======================== */
  _createRemotePlayer(id, x, y, color, name) {
    var gfx = this.add.graphics();
    gfx.setDepth(20);
    gfx.playerColor = color;
    gfx.playerId = id;

    // Body triangle
    gfx.fillStyle(color, 1);
    gfx.beginPath();
    gfx.moveTo(0, -15);
    gfx.lineTo(-12, 10);
    gfx.lineTo(0, 6);
    gfx.lineTo(12, 10);
    gfx.closePath();
    gfx.fillPath();

    gfx.lineStyle(2, color, 1);
    gfx.beginPath();
    gfx.moveTo(0, -15);
    gfx.lineTo(-12, 10);
    gfx.lineTo(0, 6);
    gfx.lineTo(12, 10);
    gfx.closePath();
    gfx.strokePath();

    gfx.fillStyle(0xffffff, 0.8);
    gfx.fillCircle(0, 0, 2);

    gfx.x = x;
    gfx.y = y;

    // Name tag with color
    var nameTag = this.add.text(x, y - 22, name, {
      fontFamily: '"Courier New", monospace',
      fontSize: '11px',
      color: '#' + color.toString(16).padStart(6, '0')
    }).setOrigin(0.5).setDepth(21);
    gfx.nameTag = nameTag;

    this.remotePlayers.set(id, gfx);
  }

  _removeRemotePlayer(id) {
    if (this.remotePlayers.has(id)) {
      var ps = this.remotePlayers.get(id);
      if (ps.nameTag) ps.nameTag.destroy();
      ps.destroy();
      this.remotePlayers.delete(id);
    }
  }

  _playDeathAnimation(id) {
    var self = this;
    var C = window.TokenWars.COMBAT;

    if (id === null) {
      // Local player death
      if (!this.localPlayer) return;

      this.localNameTag.setText('[已阵亡]');

      this.tweens.add({
        targets: this.localPlayer,
        scaleX: 0.1,
        scaleY: 0.1,
        angle: 360,
        duration: 500,
        ease: 'Back.easeIn',
        onComplete: function() {
          self._spawnNewRoom(C);
        }
      });
    } else if (this.remotePlayers.has(id)) {
      var ps = this.remotePlayers.get(id);
      if (ps.nameTag) ps.nameTag.setText('[已阵亡]');

      this.tweens.add({
        targets: ps,
        scaleX: 0.1,
        scaleY: 0.1,
        angle: 360,
        duration: 500,
        ease: 'Back.easeIn',
        onComplete: function() {
          self._removeRemotePlayer(id);
        }
      });
    }
  }

  _spawnNewRoom(C) {
    var self = this;
    var E = window.TokenWars.EVENTS;
    var W = this.scale.width;
    var H = this.scale.height;

    // Wait for respawn time, then reset
    this.time.delayedCall(C.RESPAWN_TIME, function() {
      // Reset HP
      self.hp = C.PLAYER_HP;
      self._updateHPBar();

      // Reset position
      if (self.localPlayer) {
        self.localPlayer.x = W / 2;
        self.localPlayer.y = H / 2;
        self.localPlayer.setScale(1, 1);
        self.localPlayer.setAngle(0);
        self.localNameTag.setText('你');
        self.localNameTag.x = self.localPlayer.x;
        self.localNameTag.y = self.localPlayer.y - 22;
      }

      // Reset cooldowns
      self.attackCooldown = 0;
      self.shootCooldown = 0;
      self.dashCooldown = 0;
    });
  }

  _showChatBubble(x, y, message) {
    var truncated = message.length > 20 ? message.substring(0, 20) + '...' : message;
    var bubble = this.add.text(x, y - 35, truncated, {
      fontFamily: '"Courier New", monospace',
      fontSize: '11px',
      color: '#ffffff',
      backgroundColor: '#000000aa',
      padding: { x: 6, y: 3 }
    }).setOrigin(0.5, 1).setDepth(50);

    this.tweens.add({
      targets: bubble,
      y: y - 55,
      alpha: 0,
      duration: 2000,
      onComplete: function() {
        bubble.destroy();
      }
    });
  }

  /* ======================== CLEANUP ======================== */
  _cleanup() {
    var E = window.TokenWars.EVENTS;

    // Leave room
    window.NetworkManager.emit(E.LEAVE_ROOM, {});

    // Clear remote players
    this.remotePlayers.forEach(function(ps, id) {
      if (ps.nameTag) ps.nameTag.destroy();
      ps.destroy();
    });
    this.remotePlayers.clear();
    this.projectiles.clear();
  }
}
