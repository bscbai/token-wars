import net from '../systems/NetworkManager.js';

export class AIArenaScene extends Phaser.Scene {
  constructor() {
    super({ key: 'AIArenaScene' });
  }

  init(data) {
    this.playerData = data.player;
    this.agents = [];
    this.selectedAgent = null;
    this.showDeploy = false;
    this.showReplay = false;
    this.replayData = null;
    this.replayStep = 0;
    this.replayTimer = null;
  }

  create() {
    const cx = 480;

    // Title
    this.add.text(cx, 30, 'AI 傀儡竞技场', {
      fontSize: '28px', fontFamily: 'Courier New', color: '#44ffaa', fontStyle: 'bold',
    }).setOrigin(0.5);

    // Subtitle
    this.add.text(cx, 55, '训练 AI 代理，让它替你战斗', {
      fontSize: '13px', fontFamily: 'Courier New', color: '#888',
    }).setOrigin(0.5);

    // League badge
    this.leagueText = this.add.text(cx + 200, 50, '', {
      fontSize: '13px', fontFamily: 'Courier New', color: '#888',
    }).setOrigin(0, 0.5);

    // Agent list panel
    this.agentListBg = this.add.rectangle(160, 270, 280, 380, 0x111122, 0.8)
      .setStrokeStyle(1, 0x44ffaa);
    this.agentListTitle = this.add.text(30, 60, '你的 AI 代理', {
      fontSize: '14px', fontFamily: 'Courier New', color: '#44ffaa', fontStyle: 'bold',
    });

    // Right panel: details / deploy
    this.detailBg = this.add.rectangle(590, 270, 530, 380, 0x111122, 0.8)
      .setStrokeStyle(1, 0x44ffaa);

    this.detailText = this.add.text(340, 80, '选择左侧代理查看详情\n或部署新的 AI', {
      fontSize: '13px', fontFamily: 'Courier New', color: '#666',
      lineSpacing: 8,
    }).setOrigin(0.5, 0);

    // Deploy button
    this.deployBtn = this.add.text(cx, 320, '[ 部署 AI 代理（使用当前装备的 Token）]', {
      fontSize: '15px', fontFamily: 'Courier New', color: '#44ffaa',
      backgroundColor: '#1a2a1a', padding: { x: 20, y: 10 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    this.deployBtn.on('pointerdown', () => {
      this.deployAgent();
    });
    this.deployBtn.on('pointerover', () => this.deployBtn.setColor('#88ffcc'));
    this.deployBtn.on('pointerout', () => this.deployBtn.setColor('#44ffaa'));

    // Leaderboard button
    this.leaderboardBtn = this.add.text(cx, 380, '[ 查看排行榜 ]', {
      fontSize: '14px', fontFamily: 'Courier New', color: '#ff8800',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    this.leaderboardBtn.on('pointerdown', () => {
      net.emit('ai_arena:leaderboard', {});
    });

    // Status text
    this.statusText = this.add.text(cx, 440, '', {
      fontSize: '14px', color: '#00ff88', fontFamily: 'Courier New',
    }).setOrigin(0.5);

    // Back button
    this.add.text(50, 620, '< 返回大厅', {
      fontSize: '16px', fontFamily: 'Courier New', color: '#666',
    }).setOrigin(0, 1).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.scene.start('LobbyScene', { player: this.playerData }));

    // Setup network listeners
    this.setupNetwork();

    // Request initial agent list
    net.emit('ai_arena:get_agents', {});
  }

  setupNetwork() {
    // Agent list
    net.on('ai_arena:agent_list', (data) => {
      this.agents = data.agents || [];
      this.renderAgentList();
    });

    // Agent deployed
    net.on('ai_arena:deployed', (data) => {
      this.statusText.setColor('#00ff88');
      this.statusText.setText('AI 代理已部署! 正在寻找对手...');
      // Refresh agent list
      net.emit('ai_arena:get_agents', {});
    });

    // Agent recalled
    net.on('ai_arena:recalled', (data) => {
      this.statusText.setColor('#ffaa00');
      this.statusText.setText('AI 代理已召回');
      net.emit('ai_arena:get_agents', {});
    });

    // Queue fail
    net.on('ai_arena:queue_fail', (data) => {
      if (data.reason === 'daily_cap_reached') {
        this.statusText.setColor('#ff8800');
        this.statusText.setText('今日匹配已达上限 (20 场)');
      } else if (data.reason === 'cooldown') {
        this.statusText.setColor('#ffaa00');
        this.statusText.setText(`冷却中... ${data.cooldownSeconds} 秒后可再次匹配`);
      }
    });

    // Match result notification
    net.on('ai_arena:match_result', (data) => {
      const won = data.winnerId !== 'draw' && data.winnerId === data.agentId;
      const isDraw = data.winnerId === 'draw';

      let msg = `[${data.agentId.slice(0, 6)}] `;
      if (isDraw) msg += '平局!';
      else if (won) msg += '胜利!';
      else msg += '失败';

      msg += ` AELO ${data.aelo}` +
        ` (${data.aeloChange > 0 ? '+' : ''}${data.aeloChange}) ` +
        `★${data.level}`;

      this.statusText.setColor(won ? '#00ff44' : isDraw ? '#ffff00' : '#ff4444');
      this.statusText.setText(msg);

      // Refresh after delay
      this.time.delayedCall(3000, () => {
        net.emit('ai_arena:get_agents', {});
      });
    });

    // Behavior set
    net.on('ai_arena:behavior_set', (data) => {
      if (data.success) {
        this.statusText.setColor('#00ff88');
        this.statusText.setText('特殊行为已设置');
      }
      net.emit('ai_arena:get_agents', {});
    });

    // Replay
    net.on('ai_arena:replay', (data) => {
      if (data.error) {
        this.statusText.setColor('#ff4444');
        this.statusText.setText('回放不可用');
        return;
      }
      this.replayData = data;
      this.replayStep = 0;
      this.showReplay = true;
      this.renderReplayControls();
    });

    // Leaderboard
    net.on('ai_arena:leaderboard', (data) => {
      this.showLeaderboard(data);
    });
  }

  renderAgentList() {
    const startY = 90;
    const itemH = 50;

    this.agentListTitle.setText(`你的 AI 代理 (${this.agents.length})`);

    if (this.agents.length === 0) {
      this.add.text(160, 200, '暂无 AI 代理\n点击下方按钮部署', {
        fontSize: '13px', fontFamily: 'Courier New', color: '#666',
        lineSpacing: 6,
      }).setOrigin(0.5);
      return;
    }

    this.agents.forEach((agent, i) => {
      const y = startY + i * (itemH + 5);
      const rect = this.add.rectangle(160, y + itemH / 2, 260, itemH, 0x0a1a0a, 0.6)
        .setStrokeStyle(1, agent.deployed ? 0x00ff44 : 0x44ffaa)
        .setInteractive({ useHandCursor: true });

      // Star level
      const stars = '★'.repeat(agent.level);
      this.add.text(40, y + 8, stars, {
        fontSize: '11px', fontFamily: 'Courier New', color: '#ffff00',
      });

      // Name
      this.add.text(60, y + 8, `${agent.name || 'AI-' + agent.playerName}`, {
        fontSize: '13px', fontFamily: 'Courier New', color: '#00ff88',
      });

      // AELO
      const league = this.getLeague(agent.aelo);
      this.add.text(60, y + 28, `${league.emoji} ${agent.aelo}`, {
        fontSize: '12px', fontFamily: 'Courier New', color: league.color,
      });

      // W/L/D
      const wld = `${agent.wins}W ${agent.losses}L ${agent.draws}D`;
      this.add.text(180, y + 28, wld, {
        fontSize: '11px', fontFamily: 'Courier New', color: '#888',
      });

      // Deployed badge
      if (agent.deployed) {
        this.add.text(250, y + 8, '◉ 活跃', {
          fontSize: '10px', fontFamily: 'Courier New', color: '#00ff44',
        }).setOrigin(1, 0);
      }

      // Special behavior
      if (agent.specialBehavior) {
        const specName = {
          berserker: '残血反杀', perfect_defense: '完美防御',
          greedy_algorithm: '贪婪算法', dodge_master: '闪避大师',
        }[agent.specialBehavior] || agent.specialBehavior;
        this.add.text(250, y + 28, specName, {
          fontSize: '10px', fontFamily: 'Courier New', color: '#aa44ff',
        }).setOrigin(1, 0);
      }

      rect.on('pointerdown', () => {
        this.selectAgent(agent);
      });
      rect.on('pointerover', () => rect.setFillStyle(0x1a3a1a, 0.8));
      rect.on('pointerout', () => rect.setFillStyle(0x0a1a0a, 0.6));
    });
  }

  selectAgent(agent) {
    this.selectedAgent = agent;
    this.showDeploy = true;
    this.refreshDetailPanel();
  }

  refreshDetailPanel() {
    const a = this.selectedAgent;

    // Clear previous detail content
    const detailY = 80;

    // Agent header
    this.detailHeader = this.add.text(340, detailY,
      `★${a.level} ${a.name}`, {
        fontSize: '16px', fontFamily: 'Courier New', color: '#00ff88', fontStyle: 'bold',
      }).setOrigin(0.5, 0);

    // Stats
    const league = this.getLeague(a.aelo);
    this.detailStats = this.add.text(340, detailY + 30,
      `${league.emoji} ${league.name}级  |  AELO ${a.aelo}  |  ${a.wins}W ${a.losses}L ${a.draws}D`, {
        fontSize: '12px', fontFamily: 'Courier New', color: league.color,
      }).setOrigin(0.5, 0);

    // EXP bar
    this.detailExpBarBg = this.add.rectangle(340, detailY + 60, 300, 12, 0x333).setOrigin(0.5, 0);
    const expPct = Math.min(a.exp / 500, 1);
    this.detailExpBar = this.add.rectangle(190, detailY + 60, 300 * expPct, 12, 0x44ffaa)
      .setOrigin(0, 0.5);
    this.detailExpText = this.add.text(340, detailY + 60, `EXP: ${a.exp}/500`, {
      fontSize: '10px', fontFamily: 'Courier New', color: '#fff',
    }).setOrigin(0.5);

    // Buttons
    const btnY = detailY + 100;

    // Recall / deploy
    if (a.deployed) {
      this.detailActionBtn = this.add.text(280, btnY, '[ 召回代理 ]', {
        fontSize: '14px', fontFamily: 'Courier New', color: '#ffaa00',
        backgroundColor: '#2a2a1a', padding: { x: 15, y: 6 },
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      this.detailActionBtn.on('pointerdown', () => {
        net.emit('ai_arena:recall', { agentId: a.id });
      });
    } else {
      this.detailActionBtn = this.add.text(280, btnY, '[ 重新部署 ]', {
        fontSize: '14px', fontFamily: 'Courier New', color: '#00ff88',
        backgroundColor: '#1a2a1a', padding: { x: 15, y: 6 },
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      this.detailActionBtn.on('pointerdown', () => {
        net.emit('ai_arena:deploy', { tokenDisk: this.playerData.equippedTokens || [] });
      });
    }

    // Train button
    const trainBtn = this.add.text(400, btnY, '[ 训练赛 ]', {
      fontSize: '14px', fontFamily: 'Courier New', color: '#4488ff',
      backgroundColor: '#1a1a2a', padding: { x: 15, y: 6 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    trainBtn.on('pointerdown', () => {
      net.emit('ai_arena:train', { agentId: a.id });
      this.statusText.setColor('#4488ff');
      this.statusText.setText('训练赛中...');
    });

    // Special behavior selection (if ★★★)
    if (a.level >= 3) {
      const specY = btnY + 45;
      this.add.text(340, specY, '选择特殊行为:', {
        fontSize: '12px', fontFamily: 'Courier New', color: '#aa44ff',
      }).setOrigin(0.5, 0);

      const behaviors = [
        { id: 'berserker', name: '残血反杀', desc: 'HP<10%: 攻击+200%' },
        { id: 'perfect_defense', name: '完美防御', desc: '护盾+50%, CD-2s' },
        { id: 'greedy_algorithm', name: '贪婪算法', desc: '拾取后3s伤害+30%' },
        { id: 'dodge_master', name: '闪避大师', desc: '闪避CD-40%, 距离+1' },
      ];

      behaviors.forEach((b, i) => {
        const bx = 240 + i * 130;
        const active = a.specialBehavior === b.id;
        const btn = this.add.text(bx, specY + 20, b.name, {
          fontSize: '11px', fontFamily: 'Courier New',
          color: active ? '#ff8800' : '#888',
          backgroundColor: active ? '#2a1a0a' : '#1a1a1a',
          padding: { x: 8, y: 4 },
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        btn.on('pointerdown', () => {
          net.emit('ai_arena:set_behavior', { agentId: a.id, behaviorId: b.id });
        });
        btn.on('pointerover', () => btn.setColor('#ffaa00'));
        btn.on('pointerout', () => btn.setColor(active ? '#ff8800' : '#888'));

        this.add.text(bx, specY + 38, b.desc, {
          fontSize: '9px', fontFamily: 'Courier New', color: '#666',
        }).setOrigin(0.5, 0);
      });
    }

    // Replay button
    const replayBtnY = a.level >= 3 ? 85 : 0;
    const replayBtn = this.add.text(340, 560, '[ 查看最近回放 ]', {
      fontSize: '13px', fontFamily: 'Courier New', color: '#4488ff',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    replayBtn.on('pointerdown', () => {
      net.emit('ai_arena:get_replay', { matchId: `last-${a.id}` });
      this.statusText.setColor('#4488ff');
      this.statusText.setText('加载回放中...');
    });
  }

  renderReplayControls() {
    if (!this.replayData || !this.replayData.log) return;

    // Simple replay view: show last few key frames
    const log = this.replayData.log;
    const maxShow = Math.min(log.length, 20);
    const startIdx = Math.max(log.length - maxShow, 0);

    let replayText = `[战斗回放] ${this.replayData.agentAName} vs ${this.replayData.agentBName}\n`;
    replayText += `地图: ${this.replayData.map} | 总 tick: ${this.replayData.totalTicks}\n\n`;

    for (let i = startIdx; i < log.length; i++) {
      const frame = log[i];
      if (frame.agent && frame.action) {
        replayText += `  t${frame.tick}: ${frame.action} | HP=${frame.hp}\n`;
      }
    }

    this.detailReplay = this.add.text(340, 480, replayText, {
      fontSize: '10px', fontFamily: 'Courier New', color: '#aaa',
      lineSpacing: 3,
    }).setOrigin(0.5, 0);
  }

  showLeaderboard(data) {
    // Simple leaderboard overlay
    const list = data.entries || [];
    let text = '===== AI 竞技场排行榜 =====\n\n';
    list.forEach((entry, i) => {
      text += `${i + 1}. ${entry.name}  AELO:${entry.aelo}  ${entry.wins}W/${entry.losses}L  ★${entry.level}\n`;
    });

    this.detailLeaderboard = this.add.text(340, 400, text, {
      fontSize: '11px', fontFamily: 'Courier New', color: '#ff8800',
      lineSpacing: 4,
    }).setOrigin(0.5, 0);

    this.time.delayedCall(10000, () => {
      if (this.detailLeaderboard) this.detailLeaderboard.destroy();
    });
  }

  getLeague(aelo) {
    if (aelo >= 2000) return { emoji: '◇', name: '大师', color: '#ff8800' };
    if (aelo >= 1500) return { emoji: '◆', name: '金', color: '#ffaa00' };
    if (aelo >= 1000) return { emoji: '♦', name: '银', color: '#aaaacc' };
    return { emoji: '♢', name: '铜', color: '#aa8844' };
  }

  deployAgent() {
    const tokenDisk = this.playerData.equippedTokens ||
      (this.playerData.stableTokens || []).slice(0, 16);
    net.emit('ai_arena:deploy', { tokenDisk });
    this.statusText.setColor('#ffff00');
    this.statusText.setText('部署 AI 代理中...');
  }
}
