import net from '../systems/NetworkManager.js';

// Grid replay constants
const GRID_OFFSET_X = 355;
const GRID_OFFSET_Y = 80;
const CELL_SIZE = 18;
const MAP_MAX_DISPLAY = 20;

export class AIArenaScene extends Phaser.Scene {
  constructor() {
    super({ key: 'AIArenaScene' });
  }

  init(data) {
    this.playerData = data.player;
    this.agents = [];
    this.selectedAgent = null;
    this.replayData = null;
    this.replayGraphics = null;
    this.replayStep = 0;
    this.replayTimer = null;
    this.replayPlaying = false;
    this.showReplay = false;
    this.showMatchHistory = false;
  }

  create() {
    const cx = 480;

    // Title
    this.add.text(cx, 25, 'AI 傀儡竞技场', {
      fontSize: '26px', fontFamily: 'Courier New', color: '#44ffaa', fontStyle: 'bold',
    }).setOrigin(0.5);

    // Subtitle
    this.add.text(cx, 50, '训练 AI 代理，让它替你战斗', {
      fontSize: '12px', fontFamily: 'Courier New', color: '#666',
    }).setOrigin(0.5);

    // Agent list panel (left)
    this.drawAgentListPanel();

    // Detail panel (right) - initially empty
    this.add.text(cx, 80, '选择左侧代理查看详情', {
      fontSize: '13px', fontFamily: 'Courier New', color: '#555',
    }).setOrigin(0.5, 0);

    // Deploy button
    this.deployBtn = this.add.text(cx, 560, '[ 部署 AI 代理（使用当前装备的 Token）]', {
      fontSize: '14px', fontFamily: 'Courier New', color: '#44ffaa',
      backgroundColor: '#1a2a1a', padding: { x: 20, y: 10 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    this.deployBtn.on('pointerdown', () => this.deployAgent());
    this.deployBtn.on('pointerover', () => this.deployBtn.setColor('#88ffcc'));
    this.deployBtn.on('pointerout', () => this.deployBtn.setColor('#44ffaa'));

    // Status text
    this.statusText = this.add.text(cx, 610, '', {
      fontSize: '13px', color: '#00ff88', fontFamily: 'Courier New',
    }).setOrigin(0.5);

    // Back button
    this.add.text(50, 620, '< 返回大厅', {
      fontSize: '15px', fontFamily: 'Courier New', color: '#666',
    }).setOrigin(0, 1).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.scene.start('LobbyScene', { player: this.playerData }));

    this.setupNetwork();
    net.emit('ai_arena:get_agents', {});
  }

  // ===== LEFT PANEL: AGENT LIST =====

  drawAgentListPanel() {
    this.add.rectangle(160, 270, 280, 380, 0x111122, 0.8).setStrokeStyle(1, 0x44ffaa);
    this.agentListTitle = this.add.text(30, 60, '你的 AI 代理', {
      fontSize: '14px', fontFamily: 'Courier New', color: '#44ffaa', fontStyle: 'bold',
    });
    this.agentListContainer = [];
  }

  refreshAgentList() {
    // Clear previous
    for (const obj of this.agentListContainer) obj.destroy();
    this.agentListContainer = [];

    const startY = 90;
    const itemH = 50;
    this.agentListTitle.setText(`你的 AI (${this.agents.length})`);

    if (this.agents.length === 0) {
      const t = this.add.text(160, 220, '暂无 AI\n点击下方按钮部署', {
        fontSize: '13px', fontFamily: 'Courier New', color: '#555',
        lineSpacing: 6,
      }).setOrigin(0.5);
      this.agentListContainer.push(t);
      return;
    }

    this.agents.forEach((agent, i) => {
      const y = startY + i * (itemH + 5);
      const league = this.getLeague(agent.aelo);

      const rect = this.add.rectangle(160, y + itemH / 2, 260, itemH, 0x0a1a0a, 0.6)
        .setStrokeStyle(1, agent.deployed ? 0x00ff44 : 0x44ffaa)
        .setInteractive({ useHandCursor: true });
      rect.on('pointerdown', () => this.selectAgent(agent));
      rect.on('pointerover', () => rect.setFillStyle(0x1a3a1a, 0.8));
      rect.on('pointerout', () => rect.setFillStyle(0x0a1a0a, 0.6));
      this.agentListContainer.push(rect);

      // Level stars
      const stars = '★'.repeat(agent.level);
      const starText = this.add.text(40, y + 5, stars, {
        fontSize: '11px', fontFamily: 'Courier New', color: '#ffff00',
      });
      this.agentListContainer.push(starText);

      // Name
      const nameText = this.add.text(62, y + 5, agent.name || 'AI-' + agent.playerName, {
        fontSize: '13px', fontFamily: 'Courier New', color: '#00ff88',
      });
      this.agentListContainer.push(nameText);

      // AELO
      const aeloText = this.add.text(62, y + 26, `${league.emoji} ${agent.aelo}`, {
        fontSize: '12px', fontFamily: 'Courier New', color: league.color,
      });
      this.agentListContainer.push(aeloText);

      // W/L/D
      const wld = `${agent.wins}W ${agent.losses}L ${agent.draws}D`;
      const statsText = this.add.text(180, y + 26, wld, {
        fontSize: '11px', fontFamily: 'Courier New', color: '#888',
      });
      this.agentListContainer.push(statsText);

      // Status badge
      if (agent.deployed) {
        const badge = this.add.text(250, y + 5, '● 活跃', {
          fontSize: '10px', fontFamily: 'Courier New', color: '#00ff44',
        }).setOrigin(1, 0);
        this.agentListContainer.push(badge);
      }

      // Special behavior
      if (agent.specialBehavior) {
        const spec = this.agentListContainer.push(
          this.add.text(250, y + 26, this.getBehaviorName(agent.specialBehavior), {
            fontSize: '10px', fontFamily: 'Courier New', color: '#aa44ff',
          }).setOrigin(1, 0)
        );
      }
    });
  }

  // ===== RIGHT PANEL: AGENT DETAIL =====

  selectAgent(agent) {
    this.selectedAgent = agent;
    this.redrawDetailPanel();
  }

  redrawDetailPanel() {
    // Clear detail area
    if (this.detailObjects) {
      for (const obj of this.detailObjects) obj.destroy();
    }
    this.detailObjects = [];
    const cx = 480;
    const a = this.selectedAgent;
    const league = this.getLeague(a.aelo);

    // Detail background
    this.detailObjects.push(
      this.add.rectangle(590, 315, 530, 350, 0x111122, 0.8).setStrokeStyle(1, 0x44ffaa)
    );

    // Name
    this.detailObjects.push(
      this.add.text(cx, 80, `${'★'.repeat(a.level)} ${a.name}`, {
        fontSize: '16px', fontFamily: 'Courier New', color: '#00ff88', fontStyle: 'bold',
      }).setOrigin(0.5, 0)
    );

    // League + AELO + W/L/D
    this.detailObjects.push(
      this.add.text(cx, 105,
        `${league.emoji} ${league.name} | AELO ${a.aelo} | ${a.wins}W ${a.losses}L ${a.draws}D`, {
          fontSize: '12px', fontFamily: 'Courier New', color: league.color,
        }).setOrigin(0.5, 0)
    );

    // EXP bar
    const expNeeded = a.level >= 3 ? 500 : (a.level >= 2 ? 100 : 1);
    const expPct = Math.min(a.exp / expNeeded, 1);
    this.detailObjects.push(
      this.add.rectangle(cx, 130, 300, 10, 0x333).setOrigin(0.5, 0)
    );
    this.detailObjects.push(
      this.add.rectangle(cx - 150, 130, 300 * expPct, 10, 0x44ffaa).setOrigin(0, 0.5)
    );
    this.detailObjects.push(
      this.add.text(cx, 130, `EXP: ${a.exp}/${expNeeded}`, {
        fontSize: '10px', fontFamily: 'Courier New', color: '#fff',
      }).setOrigin(0.5)
    );

    // --- Action buttons ---
    const btnY = 160;

    if (a.deployed) {
      const recallBtn = this.add.text(cx - 100, btnY, '[ 召回 ]', {
        fontSize: '14px', fontFamily: 'Courier New', color: '#ffaa00',
        backgroundColor: '#2a2a1a', padding: { x: 12, y: 5 },
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      recallBtn.on('pointerdown', () => net.emit('ai_arena:recall', { agentId: a.id }));
      this.detailObjects.push(recallBtn);
    } else {
      const deployBtn = this.add.text(cx - 100, btnY, '[ 部署 ]', {
        fontSize: '14px', fontFamily: 'Courier New', color: '#00ff88',
        backgroundColor: '#1a2a1a', padding: { x: 12, y: 5 },
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      deployBtn.on('pointerdown', () => net.emit('ai_arena:deploy', { tokenDisk: this.playerData.equippedTokens || [] }));
      this.detailObjects.push(deployBtn);
    }

    const trainBtn = this.add.text(cx + 30, btnY, '[ 训练 ]', {
      fontSize: '14px', fontFamily: 'Courier New', color: '#4488ff',
      backgroundColor: '#1a1a2a', padding: { x: 12, y: 5 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    trainBtn.on('pointerdown', () => { net.emit('ai_arena:train', { agentId: a.id }); this.setStatus('#4488ff', '训练中...'); });
    this.detailObjects.push(trainBtn);

    const historyBtn = this.add.text(cx + 160, btnY, '[ 历史 ]', {
      fontSize: '14px', fontFamily: 'Courier New', color: '#888',
      backgroundColor: '#1a1a1a', padding: { x: 12, y: 5 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    historyBtn.on('pointerdown', () => {
      net.emit('ai_arena:match_history', { agentId: a.id });
      this.setStatus('#888', '加载对战历史...');
    });
    this.detailObjects.push(historyBtn);

    // --- Naming ---
    const nameY = btnY + 35;
    this.detailObjects.push(
      this.add.text(cx, nameY, '名称:', {
        fontSize: '12px', fontFamily: 'Courier New', color: '#888',
      }).setOrigin(0.5, 0)
    );
    const nameInput = this.add.text(cx, nameY + 18, a.name, {
      fontSize: '14px', fontFamily: 'Courier New', color: '#00ff88',
    }).setOrigin(0.5, 0);
    this.detailObjects.push(nameInput);

    // Listen for keyboard to rename
    let renameActive = false;
    let renameBuffer = a.name;
    const renameHint = this.add.text(cx, nameY + 36, '点击名称编辑 (Enter 确认)', {
      fontSize: '9px', fontFamily: 'Courier New', color: '#555',
    }).setOrigin(0.5, 0);
    this.detailObjects.push(renameHint);

    nameInput.setInteractive({ useHandCursor: true });
    nameInput.on('pointerdown', () => {
      renameActive = true;
      renameBuffer = '';
      nameInput.setText('|');
      renameHint.setText('输入新名称，Enter 确认');
    });

    this.input.keyboard.on('keydown', (event) => {
      if (!renameActive || !this.selectedAgent || this.selectedAgent.id !== a.id) return;
      if (event.key === 'Enter') {
        renameActive = false;
        const finalName = renameBuffer.slice(0, 12) || a.name;
        net.emit('ai_arena:name_agent', { agentId: a.id, name: finalName });
        nameInput.setText(finalName);
        renameHint.setText('名称已保存');
      } else if (event.key === 'Backspace') {
        renameBuffer = renameBuffer.slice(0, -1);
        nameInput.setText(renameBuffer + '|');
      } else if (event.key.length === 1 && renameBuffer.length < 12) {
        renameBuffer += event.key;
        nameInput.setText(renameBuffer + '|');
      }
    });

    // --- Special behavior (if ★★★) ---
    if (a.level >= 3) {
      const specY = nameY + 65;
      this.detailObjects.push(
        this.add.text(cx, specY, '特殊行为:', {
          fontSize: '12px', fontFamily: 'Courier New', color: '#aa44ff',
        }).setOrigin(0.5, 0)
      );

      const behaviors = [
        { id: 'berserker', name: '残血反杀', desc: 'HP<10%: +200%攻击' },
        { id: 'perfect_defense', name: '完美防御', desc: '护盾+50% CD-2s' },
        { id: 'greedy_algorithm', name: '贪婪算法', desc: '拾取后+30%伤害' },
        { id: 'dodge_master', name: '闪避大师', desc: '闪避CD-40% 距离+1' },
      ];

      behaviors.forEach((b, i) => {
        const bx = cx - 140 + i * 93;
        const active = a.specialBehavior === b.id;
        const btn = this.add.text(bx, specY + 18, b.name, {
          fontSize: '10px', fontFamily: 'Courier New',
          color: active ? '#ff8800' : '#888',
          backgroundColor: active ? '#2a1a0a' : '#1a1a1a',
          padding: { x: 6, y: 3 },
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });
        btn.on('pointerdown', () => net.emit('ai_arena:set_behavior', { agentId: a.id, behaviorId: b.id }));
        this.detailObjects.push(btn);
        this.detailObjects.push(
          this.add.text(bx, specY + 34, b.desc, {
            fontSize: '8px', fontFamily: 'Courier New', color: '#666',
          }).setOrigin(0.5, 0)
        );
      });
    }
  }

  getBehaviorName(id) {
    return {
      berserker: '残血反杀', perfect_defense: '完美防御',
      greedy_algorithm: '贪婪算法', dodge_master: '闪避大师',
    }[id] || id;
  }

  getLeague(aelo) {
    if (aelo >= 2000) return { emoji: '◆', name: '大师', color: '#ff8800' };
    if (aelo >= 1500) return { emoji: '◆', name: '金', color: '#ffaa00' };
    if (aelo >= 1000) return { emoji: '◆', name: '银', color: '#aaaacc' };
    return { emoji: '◇', name: '铜', color: '#aa8844' };
  }

  // ===== NETWORK =====

  setupNetwork() {
    const evt = (name, cb) => net.on('ai_arena:' + name, cb);

    evt('agent_list', (data) => {
      this.agents = data.agents || [];
      this.refreshAgentList();
    });

    evt('deployed', (data) => {
      this.setStatus('#00ff88', 'AI 已部署!');
      if (this.selectedAgent && this.selectedAgent.id === data.agentId) {
        this.selectedAgent.deployed = true;
        this.redrawDetailPanel();
      }
      net.emit('ai_arena:get_agents', {});
    });

    evt('recalled', () => {
      this.setStatus('#ffaa00', 'AI 已召回');
      net.emit('ai_arena:get_agents', {});
    });

    evt('queue_fail', (data) => {
      const msg = data.reason === 'daily_cap_reached' ? '今日已达上限(20场)'
        : `冷却中 ${data.cooldownSeconds}秒`;
      this.setStatus('#ff8800', msg);
    });

    evt('match_result', (data) => {
      const won = data.winnerId !== 'draw' && data.winnerId === data.agentId;
      const isDraw = data.winnerId === 'draw';
      let msg = '';
      if (isDraw) msg += '平局!';
      else if (won) msg += '胜利!';
      else msg += '失败';
      msg += ` AELO ${data.aelo} (${data.aeloChange > 0 ? '+' : ''}${data.aeloChange}) ★${data.level}`;
      this.setStatus(won ? '#00ff44' : isDraw ? '#ffff00' : '#ff4444', msg);
      this.time.delayedCall(3000, () => net.emit('ai_arena:get_agents', {}));
    });

    evt('replay', (data) => {
      if (data.error) { this.setStatus('#ff4444', '回放不可用'); return; }
      this.replayData = data;
      this.replayStep = 0;
      this.replayPlaying = false;
      if (this.replayTimer) { this.replayTimer.destroy(); this.replayTimer = null; }
      this.drawReplayViewer();
    });

    evt('match_history', (data) => {
      this.showMatchHistory = true;
      this.drawMatchHistory(data.history || []);
    });

    evt('agent_named', (data) => {
      if (this.selectedAgent && this.selectedAgent.id === data.agentId) {
        this.selectedAgent.name = data.name;
      }
      net.emit('ai_arena:get_agents', {});
    });

    evt('behavior_set', (data) => {
      if (data.success) this.setStatus('#00ff88', '特殊行为已更新');
      net.emit('ai_arena:get_agents', {});
    });
  }

  // ===== REPLAY VIEWER =====

  drawReplayViewer() {
    if (!this.replayData) return;

    const r = this.replayData;
    const log = r.log || [];
    if (log.length === 0) return;

    // Clear previous detail area
    if (this.detailObjects) {
      for (const obj of this.detailObjects) obj.destroy();
    }
    this.detailObjects = [];
    const cx = 480;

    // Background
    this.detailObjects.push(
      this.add.rectangle(590, 315, 530, 380, 0x111122, 0.9).setStrokeStyle(1, 0x44ffaa)
    );

    // Header
    this.detailObjects.push(
      this.add.text(cx, 80, `回放: ${r.agentAName} vs ${r.agentBName}`, {
        fontSize: '13px', fontFamily: 'Courier New', color: '#00ff88', fontStyle: 'bold',
      }).setOrigin(0.5, 0)
    );

    const map = r.map;
    const w = map?.width || 20;
    const h = map?.height || 20;
    const obstacles = map?.obstacles || [];
    const gx = cx - (w * CELL_SIZE) / 2;
    const gy = 105;
    const gridW = w * CELL_SIZE;
    const gridH = h * CELL_SIZE;

    // Grid background
    this.detailObjects.push(
      this.add.rectangle(cx, gy + gridH / 2, gridW + 8, gridH + 8, 0x0a0a1a)
        .setStrokeStyle(1, 0x333)
    );
    // Grid lines
    for (let i = 0; i <= w; i++) {
      this.detailObjects.push(
        this.add.line(0, 0, gx + i * CELL_SIZE, gy, gx + i * CELL_SIZE, gy + gridH, 0x1a1a30, 0.5).setOrigin(0)
      );
    }
    for (let i = 0; i <= h; i++) {
      this.detailObjects.push(
        this.add.line(0, 0, gx, gy + i * CELL_SIZE, gx + gridW, gy + i * CELL_SIZE, 0x1a1a30, 0.5).setOrigin(0)
      );
    }
    // Walls
    for (const [ox, oy] of obstacles) {
      this.detailObjects.push(
        this.add.rectangle(gx + ox * CELL_SIZE + CELL_SIZE / 2, gy + oy * CELL_SIZE + CELL_SIZE / 2, CELL_SIZE, CELL_SIZE, 0x2a2a4e)
      );
    }

    // Spawn markers
    if (map?.spawnA) {
      this.detailObjects.push(
        this.add.text(gx + map.spawnA.x * CELL_SIZE + 9, gy + map.spawnA.y * CELL_SIZE + 9, 'A', {
          fontSize: '8px', fontFamily: 'Courier New', color: '#00ff88', fontStyle: 'bold',
        }).setOrigin(0.5)
      );
    }
    if (map?.spawnB) {
      this.detailObjects.push(
        this.add.text(gx + map.spawnB.x * CELL_SIZE + 9, gy + map.spawnB.y * CELL_SIZE + 9, 'B', {
          fontSize: '8px', fontFamily: 'Courier New', color: '#ff4444', fontStyle: 'bold',
        }).setOrigin(0.5)
      );
    }

    // Create moveable agent markers
    this.replayMarkerA = this.add.circle(0, 0, 6, 0x00ff88, 0.8).setVisible(false);
    this.replayMarkerB = this.add.circle(0, 0, 6, 0xff4444, 0.8).setVisible(false);
    this.replayHpBarA = this.add.rectangle(0, 0, 20, 3, 0xff4444).setOrigin(0.5).setVisible(false);
    this.replayHpBarB = this.add.rectangle(0, 0, 20, 3, 0xff4444).setOrigin(0.5).setVisible(false);
    this.replayActionText = this.add.text(cx, gy + gridH + 10, '', {
      fontSize: '11px', fontFamily: 'Courier New', color: '#aa44ff',
    }).setOrigin(0.5, 0);

    // Progress
    this.replayProgressText = this.add.text(cx, gy + gridH + 28, '', {
      fontSize: '10px', fontFamily: 'Courier New', color: '#888',
    }).setOrigin(0.5, 0);

    // Controls bar
    const ctrlY = gy + gridH + 50;

    const prevBtn = this.add.text(cx - 100, ctrlY, '◀', {
      fontSize: '18px', fontFamily: 'Courier New', color: '#888',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    prevBtn.on('pointerdown', () => {
      this.replayStep = Math.max(this.replayStep - 1, 0);
      this.renderReplayStep();
    });

    // Play/Pause
    const playPause = this.add.text(cx, ctrlY, '▶', {
      fontSize: '18px', fontFamily: 'Courier New', color: '#00ff88',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    playPause.on('pointerdown', () => {
      if (this.replayPlaying) {
        this.replayPlaying = false;
        if (this.replayTimer) { this.replayTimer.destroy(); this.replayTimer = null; }
        playPause.setText('▶');
      } else {
        this.replayPlaying = true;
        playPause.setText('⏸');
        this.autoAdvanceReplay();
      }
    });

    const nextBtn = this.add.text(cx + 100, ctrlY, '▶', {
      fontSize: '18px', fontFamily: 'Courier New', color: '#888',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    nextBtn.on('pointerdown', () => {
      this.replayStep = Math.min(this.replayStep + 1, log.length - 1);
      this.renderReplayStep();
    });

    this.detailObjects.push(prevBtn, playPause, nextBtn, this.replayMarkerA, this.replayMarkerB,
      this.replayHpBarA, this.replayHpBarB, this.replayActionText, this.replayProgressText);

    // Draw first frame
    this.replayStep = 0;
    this.renderReplayStep();
  }

  autoAdvanceReplay() {
    if (!this.replayPlaying || !this.replayData) return;
    this.replayTimer = this.time.delayedCall(200, () => {
      if (this.replayStep < (this.replayData.log?.length || 0) - 1) {
        this.replayStep++;
        this.renderReplayStep();
        this.autoAdvanceReplay();
      } else {
        this.replayPlaying = false;
      }
    });
  }

  renderReplayStep() {
    const r = this.replayData;
    if (!r || !r.log || r.log.length === 0) return;

    const frame = r.log[Math.min(this.replayStep, r.log.length - 1)];
    const map = r.map;
    const w = map?.width || 20;
    const gx = 480 - (w * CELL_SIZE) / 2;
    const gy = 105;

    // Update markers
    if (frame.x != null) {
      this.replayMarkerA.setPosition(gx + frame.x * CELL_SIZE + 9, gy + frame.y * CELL_SIZE + 9);
      this.replayMarkerA.setVisible(true);
    }
    if (frame.enemyX != null) {
      this.replayMarkerB.setPosition(gx + frame.enemyX * CELL_SIZE + 9, gy + frame.enemyY * CELL_SIZE + 9);
      this.replayMarkerB.setVisible(true);
    }

    // HP bars
    const hpPct = Math.max(frame.hp / 100, 0);
    this.replayHpBarA.setPosition(gx + frame.x * CELL_SIZE + 9, gy + frame.y * CELL_SIZE - 5);
    this.replayHpBarA.displayWidth = 20 * hpPct;
    this.replayHpBarA.setVisible(true);

    const enemyHpPct = Math.max(frame.enemyHp / 100, 0);
    this.replayHpBarB.setPosition(gx + frame.enemyX * CELL_SIZE + 9, gy + frame.enemyY * CELL_SIZE - 5);
    this.replayHpBarB.displayWidth = 20 * enemyHpPct;
    this.replayHpBarB.setVisible(true);

    // Action text
    const actionMap = {
      attack: '攻击', retreat: '撤退', chase_x: '追击', chase_y: '追击',
      dash: '闪避突击', shield_retreat: '护盾撤退', patrol: '巡逻',
      combo: '连招!', berserker_combo: '残血连招!!',
      move_x: '移动', move_y: '移动', idle: '等待',
    };
    const actionName = actionMap[frame.action] || frame.action;
    this.replayActionText.setText(`t${frame.tick}: ${actionName} (HP: ${frame.hp})`);

    // Progress
    this.replayProgressText.setText(`${this.replayStep + 1} / ${r.log.length}`);
  }

  // ===== MATCH HISTORY =====

  drawMatchHistory(history) {
    if (this.detailObjects) {
      for (const obj of this.detailObjects) obj.destroy();
    }
    this.detailObjects = [];
    const cx = 480;

    this.detailObjects.push(
      this.add.rectangle(590, 315, 530, 380, 0x111122, 0.9).setStrokeStyle(1, 0x44ffaa)
    );

    this.detailObjects.push(
      this.add.text(cx, 80, '对战历史', {
        fontSize: '14px', fontFamily: 'Courier New', color: '#44ffaa', fontStyle: 'bold',
      }).setOrigin(0.5, 0)
    );

    if (history.length === 0) {
      this.detailObjects.push(
        this.add.text(cx, 200, '暂无对战记录', {
          fontSize: '13px', fontFamily: 'Courier New', color: '#555',
        }).setOrigin(0.5)
      );
      return;
    }

    history.slice(0, 15).forEach((m, i) => {
      const y = 100 + i * 24;
      const resultColor = m.result === 'win' ? '#00ff44' : m.result === 'draw' ? '#ffff00' : '#ff4444';
      const resultLabel = m.result === 'win' ? '胜' : m.result === 'draw' ? '平' : '负';

      // Result badge
      this.detailObjects.push(
        this.add.text(340, y, `[${resultLabel}]`, {
          fontSize: '12px', fontFamily: 'Courier New', color: resultColor, fontStyle: 'bold',
        })
      );

      // Details
      this.detailObjects.push(
        this.add.text(390, y, `vs ${m.opponent}`, {
          fontSize: '12px', fontFamily: 'Courier New', color: '#aaa',
        })
      );

      this.detailObjects.push(
        this.add.text(560, y, `${m.map}`, {
          fontSize: '11px', fontFamily: 'Courier New', color: '#888',
        })
      );

      const replayBtn = this.add.text(640, y, '[回放]', {
        fontSize: '11px', fontFamily: 'Courier New', color: '#4488ff',
      }).setInteractive({ useHandCursor: true });
      replayBtn.on('pointerdown', () => {
        net.emit('ai_arena:get_replay', { matchId: m.id });
        this.setStatus('#4488ff', '加载回放...');
      });
      this.detailObjects.push(replayBtn);
    });
  }

  // ===== UTILS =====

  setStatus(color, msg) {
    this.statusText.setColor(color);
    this.statusText.setText(msg);
  }

  deployAgent() {
    net.emit('ai_arena:deploy', {
      tokenDisk: this.playerData.equippedTokens ||
        (this.playerData.stableTokens || []).slice(0, 16),
    });
    this.setStatus('#ffff00', '部署中...');
  }
}
