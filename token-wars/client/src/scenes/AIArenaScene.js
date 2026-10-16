import net from '../systems/NetworkManager.js';
import { t, onLangChange } from '../i18n.js';

// Grid replay constants
const GRID_OFFSET_X = 355;
const GRID_OFFSET_Y = 80;
const CELL_SIZE = 18;
const MAP_MAX_DISPLAY = 20;

// Special behaviors (ids are protocol-stable; display via i18n)
const BEHAVIOR_IDS = ['berserker', 'perfect_defense', 'greedy_algorithm', 'dodge_master'];

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
    this._lastHistory = null;
    this._lastSeason = null;
    this._lastTournament = null;
  }

  create() {
    const cx = 480;

    // Title
    this.titleText = this.add.text(cx, 25, t('arena.title'), {
      fontSize: '26px', fontFamily: 'Courier New', color: '#44ffaa', fontStyle: 'bold',
    }).setOrigin(0.5);

    // Subtitle
    this.subtitleText = this.add.text(cx, 50, t('arena.subtitle'), {
      fontSize: '12px', fontFamily: 'Courier New', color: '#666',
    }).setOrigin(0.5);

    // Agent list panel (left)
    this.drawAgentListPanel();

    // Detail panel (right) - initially empty
    this.hintText = this.add.text(cx, 80, t('arena.selectHint'), {
      fontSize: '13px', fontFamily: 'Courier New', color: '#555',
    }).setOrigin(0.5, 0);

    // Deploy button
    this.deployBtn = this.add.text(cx, 560, t('arena.deploy'), {
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
    this.backText = this.add.text(50, 620, t('arena.back'), {
      fontSize: '15px', fontFamily: 'Courier New', color: '#666',
    }).setOrigin(0, 1).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.scene.start('LobbyScene', { player: this.playerData }));

    // Keyboard listener registered once (rename flow references current selection)
    this.input.keyboard.on('keydown', (event) => this.handleRenameKey(event));

    // Live language switching: re-render every visible surface
    this._offLang = onLangChange(() => this.applyLang());
    this.events.once('shutdown', () => { if (this._offLang) this._offLang(); });

    this.setupNetwork();
    net.emit('ai_arena:get_agents', {});
  }

  applyLang() {
    this.titleText.setText(t('arena.title'));
    this.subtitleText.setText(t('arena.subtitle'));
    this.hintText.setText(t('arena.selectHint'));
    this.deployBtn.setText(t('arena.deploy'));
    this.backText.setText(t('arena.back'));
    this.refreshAgentList();
    if (this.selectedAgent) this.redrawDetailPanel();
    if (this._lastHistory) this.drawMatchHistory(this._lastHistory);
    if (this.replayData) {
      if (this.replayHeaderText) {
        this.replayHeaderText.setText(t('arena.replayHeader', { a: this.replayData.agentAName, b: this.replayData.agentBName }));
      }
      this.renderReplayStep();
    }
    if (this._lastSeason) this.drawSeasonPanel(this._lastSeason);
    if (this._lastTournament) this.drawTournamentPanel(this._lastTournament);
  }

  // ===== LEFT PANEL: AGENT LIST =====

  drawAgentListPanel() {
    this.add.rectangle(160, 270, 280, 380, 0x111122, 0.8).setStrokeStyle(1, 0x44ffaa);
    this.agentListTitle = this.add.text(30, 60, t('arena.yourAgents', { n: 0 }), {
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
    this.agentListTitle.setText(t('arena.yourAgents', { n: this.agents.length }));

    if (this.agents.length === 0) {
      const empty = this.add.text(160, 220, t('arena.emptyAgents'), {
        fontSize: '13px', fontFamily: 'Courier New', color: '#555',
        lineSpacing: 6,
      }).setOrigin(0.5);
      this.agentListContainer.push(empty);
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
        const badge = this.add.text(250, y + 5, t('arena.active'), {
          fontSize: '10px', fontFamily: 'Courier New', color: '#00ff44',
        }).setOrigin(1, 0);
        this.agentListContainer.push(badge);
      }

      // Special behavior
      if (agent.specialBehavior) {
        this.agentListContainer.push(
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

    // Rename flow starts inactive on every redraw
    this._renameActive = false;

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
      const recallBtn = this.add.text(cx - 100, btnY, t('arena.recall'), {
        fontSize: '14px', fontFamily: 'Courier New', color: '#ffaa00',
        backgroundColor: '#2a2a1a', padding: { x: 12, y: 5 },
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      recallBtn.on('pointerdown', () => net.emit('ai_arena:recall', { agentId: a.id }));
      this.detailObjects.push(recallBtn);
    } else {
      const deployBtn = this.add.text(cx - 100, btnY, t('arena.deployBtn'), {
        fontSize: '14px', fontFamily: 'Courier New', color: '#00ff88',
        backgroundColor: '#1a2a1a', padding: { x: 12, y: 5 },
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      deployBtn.on('pointerdown', () => net.emit('ai_arena:deploy', { tokenDisk: this.playerData.equippedTokens || [] }));
      this.detailObjects.push(deployBtn);
    }

    const trainBtn = this.add.text(cx + 30, btnY, t('arena.train'), {
      fontSize: '14px', fontFamily: 'Courier New', color: '#4488ff',
      backgroundColor: '#1a1a2a', padding: { x: 12, y: 5 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    trainBtn.on('pointerdown', () => { net.emit('ai_arena:train', { agentId: a.id }); this.setStatus('#4488ff', t('arena.training')); });
    this.detailObjects.push(trainBtn);

    const historyBtn = this.add.text(cx + 160, btnY, t('arena.history'), {
      fontSize: '14px', fontFamily: 'Courier New', color: '#888',
      backgroundColor: '#1a1a1a', padding: { x: 12, y: 5 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    historyBtn.on('pointerdown', () => {
      net.emit('ai_arena:match_history', { agentId: a.id });
      this.setStatus('#888', t('arena.loadingHistory'));
    });
    this.detailObjects.push(historyBtn);

    // --- Naming ---
    const nameY = btnY + 35;
    this.detailObjects.push(
      this.add.text(cx, nameY, t('arena.nameLabel'), {
        fontSize: '12px', fontFamily: 'Courier New', color: '#888',
      }).setOrigin(0.5, 0)
    );
    const nameInput = this.add.text(cx, nameY + 18, a.name, {
      fontSize: '14px', fontFamily: 'Courier New', color: '#00ff88',
    }).setOrigin(0.5, 0);
    this.detailObjects.push(nameInput);

    this._renameBuffer = a.name;
    const renameHint = this.add.text(cx, nameY + 36, t('arena.renameHint1'), {
      fontSize: '9px', fontFamily: 'Courier New', color: '#555',
    }).setOrigin(0.5, 0);
    this.detailObjects.push(renameHint);
    this._renameHint = renameHint;
    this._renameNameInput = nameInput;

    nameInput.setInteractive({ useHandCursor: true });
    nameInput.on('pointerdown', () => {
      this._renameActive = true;
      this._renameBuffer = '';
      nameInput.setText('|');
      renameHint.setText(t('arena.renameHint2'));
    });

    // --- Special behavior (if ★★★) ---
    if (a.level >= 3) {
      const specY = nameY + 65;
      this.detailObjects.push(
        this.add.text(cx, specY, t('arena.specialLabel'), {
          fontSize: '12px', fontFamily: 'Courier New', color: '#aa44ff',
        }).setOrigin(0.5, 0)
      );

      BEHAVIOR_IDS.forEach((id, i) => {
        const bx = cx - 140 + i * 93;
        const active = a.specialBehavior === id;
        const btn = this.add.text(bx, specY + 18, t(`arena.beh.${id}.name`), {
          fontSize: '10px', fontFamily: 'Courier New',
          color: active ? '#ff8800' : '#888',
          backgroundColor: active ? '#2a1a0a' : '#1a1a1a',
          padding: { x: 6, y: 3 },
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });
        btn.on('pointerdown', () => net.emit('ai_arena:set_behavior', { agentId: a.id, behaviorId: id }));
        this.detailObjects.push(btn);
        this.detailObjects.push(
          this.add.text(bx, specY + 34, t(`arena.beh.${id}.desc`), {
            fontSize: '8px', fontFamily: 'Courier New', color: '#666',
          }).setOrigin(0.5, 0)
        );
      });
    }
  }

  /** 重命名键盘输入（create 时注册一次，引用当前选中 agent） */
  handleRenameKey(event) {
    if (!this._renameActive || !this.selectedAgent) return;
    const a = this.selectedAgent;
    const nameInput = this._renameNameInput;
    const renameHint = this._renameHint;
    if (!nameInput) return;
    if (event.key === 'Enter') {
      this._renameActive = false;
      const finalName = this._renameBuffer.slice(0, 12) || a.name;
      net.emit('ai_arena:name_agent', { agentId: a.id, name: finalName });
      nameInput.setText(finalName);
      renameHint.setText(t('arena.nameSaved'));
    } else if (event.key === 'Backspace') {
      this._renameBuffer = this._renameBuffer.slice(0, -1);
      nameInput.setText(this._renameBuffer + '|');
    } else if (event.key.length === 1 && this._renameBuffer.length < 12) {
      this._renameBuffer += event.key;
      nameInput.setText(this._renameBuffer + '|');
    }
  }

  getBehaviorName(id) {
    const v = t(`arena.beh.${id}.name`);
    return v === `arena.beh.${id}.name` ? id : v;
  }

  getLeague(aelo) {
    if (aelo >= 2000) return { emoji: '◆', name: t('arena.league.master'), color: '#ff8800' };
    if (aelo >= 1500) return { emoji: '◆', name: t('arena.league.gold'), color: '#ffaa00' };
    if (aelo >= 1000) return { emoji: '◆', name: t('arena.league.silver'), color: '#aaaacc' };
    return { emoji: '◇', name: t('arena.league.bronze'), color: '#aa8844' };
  }

  // ===== NETWORK =====

  setupNetwork() {
    const evt = (name, cb) => net.on('ai_arena:' + name, cb);

    evt('agent_list', (data) => {
      this.agents = data.agents || [];
      this.refreshAgentList();
    });

    evt('deployed', (data) => {
      this.setStatus('#00ff88', t('arena.statusDeployed'));
      if (this.selectedAgent && this.selectedAgent.id === data.agentId) {
        this.selectedAgent.deployed = true;
        this.redrawDetailPanel();
      }
      net.emit('ai_arena:get_agents', {});
    });

    evt('recalled', () => {
      this.setStatus('#ffaa00', t('arena.statusRecalled'));
      net.emit('ai_arena:get_agents', {});
    });

    evt('queue_fail', (data) => {
      let msg;
      if (data.reason === 'daily_cap_reached') msg = t('arena.dailyCap');
      else if (data.reason === 'parity_suspended') msg = t('arena.paritySuspended');
      else msg = t('arena.cooldown', { s: data.cooldownSeconds || 0 });
      this.setStatus('#ff8800', msg);
    });

    evt('match_result', (data) => {
      const won = data.winnerId !== 'draw' && data.winnerId === data.agentId;
      const isDraw = data.winnerId === 'draw';
      const head = isDraw ? t('arena.resultDraw') : won ? t('arena.resultWin') : t('arena.resultLoss');
      const line = t('arena.aeloLine', {
        aelo: data.aelo,
        change: (data.aeloChange > 0 ? '+' : '') + data.aeloChange,
        level: data.level,
      });
      this.setStatus(won ? '#00ff44' : isDraw ? '#ffff00' : '#ff4444', head + line);
      this.time.delayedCall(3000, () => net.emit('ai_arena:get_agents', {}));
    });

    evt('replay', (data) => {
      if (data.error) { this.setStatus('#ff4444', t('arena.replayUnavailable')); return; }
      this.replayData = data;
      this.replayStep = 0;
      this.replayPlaying = false;
      if (this.replayTimer) { this.replayTimer.destroy(); this.replayTimer = null; }
      this.drawReplayViewer();
    });

    evt('match_history', (data) => {
      this.showMatchHistory = true;
      this._lastHistory = data.history || [];
      this.drawMatchHistory(this._lastHistory);
    });

    evt('agent_named', (data) => {
      if (this.selectedAgent && this.selectedAgent.id === data.agentId) {
        this.selectedAgent.name = data.name;
      }
      net.emit('ai_arena:get_agents', {});
    });

    evt('behavior_set', (data) => {
      if (data.success) this.setStatus('#00ff88', t('arena.behaviorUpdated'));
      net.emit('ai_arena:get_agents', {});
    });

    // Phase 3: Tournament & Season events
    evt('season_info', (data) => { this._lastSeason = data; this.drawSeasonPanel(data); });
    evt('season_update', (data) => { this._lastSeason = data; this.drawSeasonPanel(data); });
    evt('tournament_state', (data) => { this._lastTournament = data; this.drawTournamentPanel(data); });
    evt('tournament_start', (data) => { this.setStatus('#ff8800', t('arena.tourStart', { n: data.participants?.length || 0 })); this.drawTournamentStartAlert(data); });
    evt('tournament_match', (data) => this.showTournamentMatchAlert(data));
    evt('tournament_round', (data) => this.showTournamentRoundAlert(data));
    evt('tournament_end', (data) => this.showTournamentEnd(data));
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
    this.replayHeaderText = this.add.text(cx, 80, t('arena.replayHeader', { a: r.agentAName, b: r.agentBName }), {
      fontSize: '13px', fontFamily: 'Courier New', color: '#00ff88', fontStyle: 'bold',
    }).setOrigin(0.5, 0);
    this.detailObjects.push(this.replayHeaderText);

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

    // Play/Pause (symbols are language-neutral)
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
    // Distinguish next-step glyph from play glyph via color (both ▶ in legacy UI too)
    nextBtn.setColor('#888');
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

  /** 回放动作标签 → i18n key */
  replayActionKey(action) {
    const map = {
      attack: 'arena.act.attack', retreat: 'arena.act.retreat',
      chase_x: 'arena.act.chase', chase_y: 'arena.act.chase',
      dash: 'arena.act.dash', shield_retreat: 'arena.act.shieldRetreat',
      patrol: 'arena.act.patrol',
      combo: 'arena.act.combo', berserker_combo: 'arena.act.berserkerCombo',
      move_x: 'arena.act.move', move_y: 'arena.act.move', idle: 'arena.act.idle',
    };
    return map[action] || null;
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
    const key = this.replayActionKey(frame.action);
    const actionName = key ? t(key) : frame.action;
    this.replayActionText.setText(t('arena.replayStep', { tick: frame.tick, action: actionName, hp: frame.hp }));

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
      this.add.text(cx, 80, t('arena.matchHistory'), {
        fontSize: '14px', fontFamily: 'Courier New', color: '#44ffaa', fontStyle: 'bold',
      }).setOrigin(0.5, 0)
    );

    if (history.length === 0) {
      this.detailObjects.push(
        this.add.text(cx, 200, t('arena.noMatches'), {
          fontSize: '13px', fontFamily: 'Courier New', color: '#555',
        }).setOrigin(0.5)
      );
      return;
    }

    history.slice(0, 15).forEach((m, i) => {
      const y = 100 + i * 24;
      const resultColor = m.result === 'win' ? '#00ff44' : m.result === 'draw' ? '#ffff00' : '#ff4444';
      const resultKey = m.result === 'win' ? 'arena.res.win' : m.result === 'draw' ? 'arena.res.draw' : 'arena.res.loss';
      const resultLabel = t(resultKey);

      // Result badge
      this.detailObjects.push(
        this.add.text(340, y, `[${resultLabel}]`, {
          fontSize: '12px', fontFamily: 'Courier New', color: resultColor, fontStyle: 'bold',
        })
      );

      // Details
      this.detailObjects.push(
        this.add.text(390, y, t('arena.vs', { name: m.opponent }), {
          fontSize: '12px', fontFamily: 'Courier New', color: '#aaa',
        })
      );

      this.detailObjects.push(
        this.add.text(560, y, `${m.map}`, {
          fontSize: '11px', fontFamily: 'Courier New', color: '#888',
        })
      );

      const replayBtn = this.add.text(640, y, t('arena.replayBtn'), {
        fontSize: '11px', fontFamily: 'Courier New', color: '#4488ff',
      }).setInteractive({ useHandCursor: true });
      replayBtn.on('pointerdown', () => {
        net.emit('ai_arena:get_replay', { matchId: m.id });
        this.setStatus('#4488ff', t('arena.loadingReplay'));
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
    this.setStatus('#ffff00', t('arena.deploying'));
  }

  // ===== SEASON & TOURNAMENT UI =====

  /** 赛季 buff 优先按 id 映射 i18n；未知 buff 回退服务端下发文案 */
  formatBuff(buff) {
    if (!buff) return t('arena.season.none');
    const nameKey = `arena.buff.${buff.id}.name`;
    const name = t(nameKey);
    if (name === nameKey) return `${buff.name}: ${buff.description}`;
    return `${name}: ${t(`arena.buff.${buff.id}.desc`)}`;
  }

  formatWeekLabel(week) {
    return t(`arena.week${week}`) === `arena.week${week}` ? '' : t(`arena.week${week}`);
  }

  drawSeasonPanel(data) {
    const cx = 480;
    const y = 70;
    // Clear previous
    if (this.seasonPanel) this.seasonPanel.destroy();
    const panel = this.add.container(cx, y);
    const buff = this.formatBuff(data.buff);
    const weekLabel = this.formatWeekLabel(data.week);
    panel.add(this.add.text(0, 0, t('arena.seasonLine', { week: data.week, weekLabel, buff }), {
      fontSize: '11px', fontFamily: 'Courier New', color: '#ff8800',
    }).setOrigin(0.5, 0));
    this.seasonPanel = panel;
  }

  drawTournamentPanel(data) {
    if (!data || data.status === 'none') return;
    const cx = 480;
    // Clear previous
    if (this.tournamentPanel) this.tournamentPanel.destroy();
    const panel = this.add.container(cx, 75);
    const statusLabel = data.status === 'running' ? t('arena.tourRunning') : t('arena.tourEnded');
    panel.add(this.add.text(0, 0, t('arena.tourLine', { status: statusLabel, round: data.round, total: data.totalRounds }), {
      fontSize: '12px', fontFamily: 'Courier New', color: '#ff4444',
    }).setOrigin(0.5, 0));
    if (data.history) {
      data.history.slice(-5).forEach((h, i) => {
        panel.add(this.add.text(0, 20 + i * 16, `R${h.round}: ${h.match} → ${h.winner}`, {
          fontSize: '10px', fontFamily: 'Courier New', color: '#888',
        }).setOrigin(0.5, 0));
      });
    }
    if (data.champion) {
      panel.add(this.add.text(0, 20 + (data.history?.length || 0) * 16, t('arena.championLine', { name: data.champion.name }), {
        fontSize: '14px', fontFamily: 'Courier New', color: '#ff8800', fontStyle: 'bold',
      }).setOrigin(0.5, 0));
    }
    this.tournamentPanel = panel;
  }

  drawTournamentStartAlert(data) {
    const msg = t('arena.tourStart', { n: data.participants?.length || 0 });
    this.setStatus('#ff8800', msg);
    this.time.delayedCall(5000, () => {
      if (this.statusText.text === msg) this.statusText.setText('');
    });
  }

  showTournamentMatchAlert(data) {
    this.setStatus('#ff4444', t('arena.tourMatch', {
      round: data.round, total: data.totalRounds,
      a: data.agentA.name, b: data.agentB.name,
      w: data.winner.name, score: data.score,
    }));
  }

  showTournamentRoundAlert(data) {
    this.setStatus('#ff8800', t('arena.tourRound', { round: data.round, total: data.totalRounds, n: data.remaining }));
  }

  showTournamentEnd(data) {
    this.setStatus('#ff8800', t('arena.tourChampion', { name: data.champion?.name || '?' }));
    if (data.champion) {
      // Full screen champion celebration (simple version)
      const overlay = this.add.rectangle(480, 320, 960, 640, 0x000000, 0.6);
      const title = this.add.text(480, 220, 'TOURNAMENT CHAMPION', {
        fontSize: '28px', fontFamily: 'Courier New', color: '#ff8800', fontStyle: 'bold',
      }).setOrigin(0.5);
      const name = this.add.text(480, 280, data.champion.name, {
        fontSize: '22px', fontFamily: 'Courier New', color: '#ffaa00',
      }).setOrigin(0.5);
      const close = this.add.text(480, 340, t('arena.close'), {
        fontSize: '14px', fontFamily: 'Courier New', color: '#fff',
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      const dismiss = () => { overlay.destroy(); title.destroy(); name.destroy(); close.destroy(); };
      close.on('pointerdown', dismiss);
      this.time.delayedCall(8000, dismiss);
    }
  }
}
