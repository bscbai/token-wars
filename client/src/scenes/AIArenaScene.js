// Token Wars: 算力征途 - AI Arena Scene
// Agent management, leaderboard, season, tournament, match queue, replay viewer
class AIArenaScene extends Phaser.Scene {
  constructor() {
    super({ key: 'AIArenaScene' });
  }

  /* ======================== CREATE ======================== */
  create() {
    var self = this;
    var E = window.TokenWars.EVENTS;
    var AA = window.TokenWars.AI_ARENA;
    var W = this.scale.width;
    var H = this.scale.height;

    // State
    this.agents = [];
    this.selectedAgent = null;
    this.selectedAgentId = null;
    this.leaderboard = [];
    this.seasonInfo = null;
    this.tournamentInfo = null;
    this.currentTab = 'leaderboard'; // leaderboard | season | tournament
    this.inQueue = false;
    this.replayActive = false;
    this.replayData = null;
    this.replayTurn = 0;
    this.replayTimer = null;
    this.replayPaused = false;
    this.tokens = 0;
    this.matchCount = 0;
    this.dailyMatches = 0;
    this.playerName = '';

    // Panel dimensions
    this.leftPanelW = 250;
    this.centerPanelW = 400;
    this.rightPanelW = 300;
    this.topBarH = 50;
    this.leftX = 0;
    this.centerX = this.leftPanelW;
    this.rightX = this.leftPanelW + this.centerPanelW;

    // Draw layout
    this.drawBackground(W, H);
    this.drawTopBar(W);
    this.drawLeftPanelBG();
    this.drawCenterPanelBG();
    this.drawRightPanelBG();
    this.drawBottomBar(W, H);

    // Content containers
    this.leftContent = [];
    this.centerContent = [];
    this.rightContent = [];
    this.replayElements = [];

    // Initial right panel tab
    this.renderRightPanelTabs();
    this.switchTab('leaderboard');

    // Queue button
    this.queueButton = null;
    this.queueStatusText = null;
    this.drawQueueButton(W, H);

    // Replay overlay (hidden)
    this.replayContainer = this.add.container(0, 0).setDepth(200).setVisible(false);

    // Input: ESC
    this.input.keyboard.on('keydown-ESC', function() {
      if (self.replayActive) {
        self.closeReplay();
        return;
      }
      self._cleanup();
      self.scene.start('LobbyScene');
    });

    // Network setup
    this._setupNetwork(E, AA);

    // Connect and load
    if (!window.NetworkManager.isConnected()) {
      window.NetworkManager.connect('');
    }

    // Request initial data
    this.time.delayedCall(500, function() {
      window.NetworkManager.emit(E.AI_ARENA_AGENT_LIST);
      window.NetworkManager.emit(E.AI_ARENA_LEADERBOARD);
      window.NetworkManager.emit(E.AI_ARENA_SEASON_INFO);
    });
  }

  /* ======================== BACKGROUND ======================== */
  drawBackground(W, H) {
    var gfx = this.add.graphics();
    gfx.setDepth(-1);

    gfx.fillStyle(0x0a0a1a, 1);
    gfx.fillRect(0, 0, W, H);

    // Grid
    var gs = 40;
    gfx.lineStyle(1, 0x004422, 0.1);
    for (var x = 0; x <= W; x += gs) {
      gfx.beginPath(); gfx.moveTo(x, 0); gfx.lineTo(x, H); gfx.strokePath();
    }
    for (var y = 0; y <= H; y += gs) {
      gfx.beginPath(); gfx.moveTo(0, y); gfx.lineTo(W, y); gfx.strokePath();
    }

    // Panel separators
    gfx.lineStyle(2, 0x00ff44, 0.3);
    gfx.beginPath(); gfx.moveTo(this.leftPanelW, this.topBarH); gfx.lineTo(this.leftPanelW, H - 50); gfx.strokePath();
    gfx.beginPath(); gfx.moveTo(this.centerX + this.centerPanelW, this.topBarH); gfx.lineTo(this.centerX + this.centerPanelW, H - 50); gfx.strokePath();
  }

  drawTopBar(W) {
    var gfx = this.add.graphics();
    gfx.setDepth(5);
    gfx.fillStyle(0x0a2a15, 0.95);
    gfx.fillRect(0, 0, W, this.topBarH);
    gfx.lineStyle(1, 0x00ff44, 0.5);
    gfx.beginPath(); gfx.moveTo(0, this.topBarH); gfx.lineTo(W, this.topBarH); gfx.strokePath();

    this.add.text(W / 2, this.topBarH / 2, '🤖 AI 竞技场', {
      fontFamily: '"Courier New", "SimHei", monospace',
      fontSize: '22px',
      color: '#00ff88',
      fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(10);

    this.add.text(W - 15, this.topBarH / 2, '[ ESC 返回大厅 ]', {
      fontFamily: '"Courier New", monospace',
      fontSize: '11px',
      color: '#00ff4466',
      align: 'right'
    }).setOrigin(1, 0.5).setDepth(10);
  }

  drawBottomBar(W, H) {
    var gfx = this.add.graphics();
    gfx.setDepth(5);
    gfx.fillStyle(0x0a2a15, 0.95);
    gfx.fillRect(0, H - 50, W, 50);
    gfx.lineStyle(1, 0x00ff44, 0.5);
    gfx.beginPath(); gfx.moveTo(0, H - 50); gfx.lineTo(W, H - 50); gfx.strokePath();

    this.tokenText = this.add.text(15, H - 25, 'Token: 0', {
      fontFamily: '"Courier New", monospace',
      fontSize: '14px',
      color: '#ffcc00'
    }).setOrigin(0, 0.5).setDepth(10);

    this.matchText = this.add.text(200, H - 25, '今日对战: 0/' + window.TokenWars.AI_ARENA.SEASON.MATCHES_PER_DAY, {
      fontFamily: '"Courier New", monospace',
      fontSize: '13px',
      color: '#00ff8888'
    }).setOrigin(0, 0.5).setDepth(10);
  }

  /* ======================== LEFT PANEL - AGENT LIST ======================== */
  drawLeftPanelBG() {
    var gfx = this.add.graphics();
    gfx.setDepth(5);
    gfx.fillStyle(0x0a0a15, 0.85);
    gfx.fillRect(0, this.topBarH, this.leftPanelW, this.scale.height - this.topBarH - 50);

    this.add.text(this.leftPanelW / 2, this.topBarH + 10, '我的AI代理', {
      fontFamily: '"Courier New", "SimHei", monospace',
      fontSize: '16px',
      color: '#00ff88',
      fontStyle: 'bold'
    }).setOrigin(0.5, 0).setDepth(10);
  }

  renderAgentList() {
    var self = this;
    var H = this.scale.height;
    var E = window.TokenWars.EVENTS;
    var AA = window.TokenWars.AI_ARENA;

    // Clear old content
    this.leftContent.forEach(function(e) { if (e && e.destroy) e.destroy(); });
    this.leftContent = [];

    var listY = this.topBarH + 40;
    var itemH = 55;

    if (this.agents.length === 0) {
      var emptyText = this.add.text(this.leftPanelW / 2, listY + 30, '暂无代理\n\n点击下方按钮创建', {
        fontFamily: '"Courier New", "SimHei", monospace',
        fontSize: '12px',
        color: '#00ff4488',
        align: 'center'
      }).setOrigin(0.5, 0).setDepth(10);
      this.leftContent.push(emptyText);
    } else {
      var maxVisible = Math.floor((H - this.topBarH - 170) / itemH);
      for (var i = 0; i < this.agents.length && i < maxVisible; i++) {
        var agent = this.agents[i];
        var y = listY + i * itemH;
        var stars = '⭐'.repeat(Math.min(agent.stars || 0, AA.TRAINING.MAX_STARS));

        // Background for item
        var bg = this.add.graphics();
        bg.setDepth(10);
        var isSelected = this.selectedAgentId === agent.id;
        bg.fillStyle(isSelected ? 0x0a3a25 : 0x0a1a10, 0.8);
        bg.fillRoundedRect(5, y, this.leftPanelW - 10, itemH - 4, 4);
        bg.lineStyle(1, isSelected ? 0x00ff88 : 0x004422, isSelected ? 0.8 : 0.4);
        bg.strokeRoundedRect(5, y, this.leftPanelW - 10, itemH - 4, 4);
        this.leftContent.push(bg);

        // Name
        var nameTxt = this.add.text(12, y + 4, agent.name || '未命名', {
          fontFamily: '"Courier New", "SimHei", monospace',
          fontSize: '13px',
          color: isSelected ? '#ffffff' : '#00ff88'
        }).setDepth(11);
        this.leftContent.push(nameTxt);

        // Stars & rating (server sends aeloRating, client may also use rating)
        var rating = agent.aeloRating || agent.rating || AA.INITIAL_RATING;
        var infoTxt = this.add.text(12, y + 22, stars + '  评级:' + rating, {
          fontFamily: '"Courier New", monospace',
          fontSize: '11px',
          color: '#aaccaa',
          align: 'left'
        }).setDepth(11);
        this.leftContent.push(infoTxt);

        // Status (server sends deployed boolean, client expects status string)
        var deployed = agent.deployed;
        var status = deployed ? 'deployed' : 'idle';
        var statusColors = { idle: '#00ff88', deployed: '#ffaa00', training: '#44aaff' };
        var statusNames = { idle: '待命', deployed: '已部署', training: '训练中' };
        var statusTxt = this.add.text(12, y + 37, statusNames[status] || status, {
          fontFamily: '"Courier New", monospace',
          fontSize: '10px',
          color: statusColors[status] || '#888888'
        }).setDepth(11);
        this.leftContent.push(statusTxt);

        // Click area
        (function(agent, idx) {
          var hitArea = self.add.rectangle(self.leftPanelW / 2, y + itemH / 2, self.leftPanelW - 10, itemH - 4, 0x000000, 0)
            .setInteractive({ useHandCursor: true })
            .setDepth(12);
          hitArea.on('pointerdown', function() {
            self.selectAgent(agent.id);
          });
          self.leftContent.push(hitArea);

          // Buttons: deploy/recall
          var btnX = self.leftPanelW - 90;
          var isDeployed = agent.deployed === true;
          var btnTxt = isDeployed ? '召回' : '部署';
          var btnAction = isDeployed ? E.AI_ARENA_RECALL : E.AI_ARENA_DEPLOY;

          var btn = self.add.text(btnX, y + 30, '[' + btnTxt + ']', {
            fontFamily: '"Courier New", monospace',
            fontSize: '11px',
            color: '#00ff88',
            backgroundColor: '#0a2a15',
            padding: { x: 4, y: 2 }
          }).setInteractive({ useHandCursor: true }).setDepth(13);
          btn.on('pointerover', function() { btn.setColor('#ffffff'); });
          btn.on('pointerout', function() { btn.setColor('#00ff88'); });
          btn.on('pointerdown', function() {
            window.NetworkManager.emit(btnAction, { agentId: agent.id });
          });
          self.leftContent.push(btn);

          // Train button
          var trainBtn = self.add.text(btnX - 45, y + 30, '[训练]', {
            fontFamily: '"Courier New", monospace',
            fontSize: '11px',
            color: '#44aaff',
            backgroundColor: '#0a1a2a',
            padding: { x: 4, y: 2 }
          }).setInteractive({ useHandCursor: true }).setDepth(13);
          trainBtn.on('pointerover', function() { trainBtn.setColor('#ffffff'); });
          trainBtn.on('pointerout', function() { trainBtn.setColor('#44aaff'); });
          trainBtn.on('pointerdown', function() {
            window.NetworkManager.emit(E.AI_ARENA_TRAIN, { agentId: agent.id });
          });
          self.leftContent.push(trainBtn);
        })(agent, i);
      }
    }

    // Create new agent button
    var createY = this.scale.height - 120;
    var createBg = this.add.graphics();
    createBg.fillStyle(0x0a3a25, 0.9);
    createBg.fillRoundedRect(20, createY, this.leftPanelW - 40, 36, 6);
    createBg.lineStyle(2, 0x00ff44, 0.8);
    createBg.strokeRoundedRect(20, createY, this.leftPanelW - 40, 36, 6);
    this.leftContent.push(createBg);

    var createTxt = this.add.text(this.leftPanelW / 2, createY + 18, '+ 创建新代理', {
      fontFamily: '"Courier New", "SimHei", monospace',
      fontSize: '15px',
      color: '#00ff88',
      fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(10);
    this.leftContent.push(createTxt);

    var createHit = this.add.rectangle(this.leftPanelW / 2, createY + 18, this.leftPanelW - 40, 36, 0x000000, 0)
      .setInteractive({ useHandCursor: true }).setDepth(12);
    createHit.on('pointerdown', function() {
      self._promptCreateAgent(E);
    });
    this.leftContent.push(createHit);
  }

  /* ======================== CENTER PANEL - AGENT DETAIL ======================== */
  drawCenterPanelBG() {
    var H = this.scale.height;
    var gfx = this.add.graphics();
    gfx.setDepth(5);
    gfx.fillStyle(0x0a0a15, 0.85);
    gfx.fillRect(this.centerX, this.topBarH, this.centerPanelW, H - this.topBarH - 50);
  }

  renderAgentDetail() {
    var self = this;
    var AA = window.TokenWars.AI_ARENA;
    var E = window.TokenWars.EVENTS;

    this.centerContent.forEach(function(e) { if (e && e.destroy) e.destroy(); });
    this.centerContent = [];

    if (!this.selectedAgent) {
      var hint = this.add.text(this.centerX + this.centerPanelW / 2, this.scale.height / 2, '← 选择一个代理查看详情', {
        fontFamily: '"Courier New", "SimHei", monospace',
        fontSize: '14px',
        color: '#00ff4488',
        align: 'center'
      }).setOrigin(0.5).setDepth(10);
      this.centerContent.push(hint);
      return;
    }

    var agent = this.selectedAgent;
    var x = this.centerX + 15;
    var y = this.topBarH + 10;

    // Agent name (clickable to edit)
    var nameTxt = this.add.text(this.centerX + this.centerPanelW / 2, y, agent.name || '未命名', {
      fontFamily: '"Courier New", "SimHei", monospace',
      fontSize: '20px',
      color: '#00ff88',
      fontStyle: 'bold'
    }).setOrigin(0.5, 0).setDepth(10);
    nameTxt.setInteractive({ useHandCursor: true });
    nameTxt.on('pointerdown', function() {
      self._promptRename(agent, E);
    });
    this.centerContent.push(nameTxt);

    y += 30;

    // Stars
    var starsStr = '⭐'.repeat(agent.stars || 0) + '☆'.repeat(AA.TRAINING.MAX_STARS - (agent.stars || 0));
    var starsText = this.add.text(this.centerX + this.centerPanelW / 2, y, starsStr, {
      fontFamily: '"Courier New", monospace',
      fontSize: '18px',
      color: '#ffcc00'
    }).setOrigin(0.5, 0).setDepth(10);
    this.centerContent.push(starsText);

    y += 35;

    // Separator
    var sep = this.add.graphics();
    sep.lineStyle(1, 0x00ff44, 0.3);
    sep.beginPath(); sep.moveTo(x, y); sep.lineTo(x + this.centerPanelW - 30, y); sep.strokePath();
    this.centerContent.push(sep);
    y += 10;

    // AELO rating (server sends aeloRating)
    var rating = agent.aeloRating || agent.rating || AA.INITIAL_RATING;
    var ratingText = this.add.text(x, y, 'AELO评级: ' + rating, {
      fontFamily: '"Courier New", monospace',
      fontSize: '16px',
      color: '#44aaff'
    }).setDepth(10);
    this.centerContent.push(ratingText);
    y += 22;

    // W/L/D record
    var wins = agent.wins || 0;
    var losses = agent.losses || 0;
    var draws = agent.draws || 0;
    var totalGames = wins + losses + draws;
    var winRate = totalGames > 0 ? ((wins / totalGames) * 100).toFixed(1) : '0.0';
    var recordText = this.add.text(x, y, '战绩: ' + wins + 'W / ' + losses + 'L / ' + draws + 'D  (' + winRate + '%)', {
      fontFamily: '"Courier New", monospace',
      fontSize: '13px',
      color: '#aaccaa'
    }).setDepth(10);
    this.centerContent.push(recordText);
    y += 22;

    // Streak
    var streak = agent.streak || 0;
    var streakStr = streak > 0 ? '+' + streak + '连胜' : streak < 0 ? streak + '连败' : '无连败';
    var streakText = this.add.text(x, y, '连胜/连败: ' + streakStr, {
      fontFamily: '"Courier New", monospace',
      fontSize: '12px',
      color: streak >= 0 ? '#00ff88' : '#ff4444'
    }).setDepth(10);
    this.centerContent.push(streakText);
    y += 30;

    // Token disk slots
    var categories = AA.CATEGORIES;
    var catNames = { attack: '攻击', defense: '防御', mobility: '机动', economy: '经济' };
    var catIcons = { attack: '⚔️', defense: '🛡️', mobility: '💨', economy: '💰' };

    var slotLabel = this.add.text(x, y, '技能槽位:', {
      fontFamily: '"Courier New", "SimHei", monospace',
      fontSize: '14px',
      color: '#00ff88',
      fontStyle: 'bold'
    }).setDepth(10);
    this.centerContent.push(slotLabel);
    y += 22;

    // Token disk slots (server sends tokens array, derive active_slots from it)
    var activeSlots = {};
    if (agent.tokens && Array.isArray(agent.tokens)) {
      for (var ti = 0; ti < agent.tokens.length; ti++) {
        var tk = agent.tokens[ti];
        if (tk.category && !activeSlots[tk.category]) {
          activeSlots[tk.category] = tk.name || (tk.rarity || 'common') + ' ' + tk.category;
        }
      }
    }
    // Also check if server already provides active_slots
    if (agent.active_slots) {
      activeSlots = agent.active_slots;
    }
    var slotBg = this.add.graphics();
    slotBg.setDepth(10);
    this.centerContent.push(slotBg);

    for (var ci = 0; ci < categories.length; ci++) {
      var cat = categories[ci];
      var cx = x + 10;
      var cy = y + ci * 40;

      // Slot background
      slotBg.fillStyle(0x0a1a10, 0.8);
      slotBg.fillRoundedRect(cx, cy, this.centerPanelW - 50, 34, 4);
      slotBg.lineStyle(1, 0x004422, 0.5);
      slotBg.strokeRoundedRect(cx, cy, this.centerPanelW - 50, 34, 4);

      var slotTxt = this.add.text(cx + 8, cy + 17, catIcons[cat] + ' ' + catNames[cat] + ': ' + (activeSlots[cat] || '空'), {
        fontFamily: '"Courier New", "SimHei", monospace',
        fontSize: '12px',
        color: activeSlots[cat] ? '#ffcc00' : '#888888'
      }).setOrigin(0, 0.5).setDepth(11);
      this.centerContent.push(slotTxt);

      // Click to assign
      slotTxt.setInteractive({ useHandCursor: true });
      (function(category) {
        slotTxt.on('pointerdown', function() {
          self._promptAssignToken(E, agent, category);
        });
      })(cat);
    }

    y += categories.length * 40 + 15;

    // Weight breakdown
    var weights = agent.weights || { attack: 25, defense: 25, mobility: 25, economy: 25 };
    var weightLabel = this.add.text(x, y, '权重分配:', {
      fontFamily: '"Courier New", "SimHei", monospace',
      fontSize: '13px',
      color: '#00ff88',
      fontStyle: 'bold'
    }).setDepth(10);
    this.centerContent.push(weightLabel);
    y += 20;

    // Weight bars
    var totalWeight = weights.attack + weights.defense + weights.mobility + weights.economy || 1;
    var weightBarW = this.centerPanelW - 60;
    var weightColors = { attack: 0xff4444, defense: 0x44aaff, mobility: 0x44ff44, economy: 0xffcc00 };

    var wbX = x;
    var wbGfx = this.add.graphics();
    wbGfx.setDepth(10);
    this.centerContent.push(wbGfx);

    var wOffset = 0;
    for (var wi = 0; wi < categories.length; wi++) {
      var wcat = categories[wi];
      var wVal = weights[wcat] || 0;
      var wPct = wVal / totalWeight;
      var wWidth = weightBarW * wPct;

      wbGfx.fillStyle(weightColors[wcat], 0.8);
      wbGfx.fillRect(wbX + wOffset, y, wWidth, 16);

      var wPctLabel = this.add.text(wbX + wOffset + wWidth / 2, y + 8, wcat[0].toUpperCase() + ' ' + (wPct * 100).toFixed(1) + '%', {
        fontFamily: '"Courier New", monospace',
        fontSize: '10px',
        color: '#ffffff',
        align: 'center'
      }).setOrigin(0.5).setDepth(11);
      this.centerContent.push(wPctLabel);

      wOffset += wWidth;
    }

    y += 25;

    // Special behavior (unlocked at 3 stars)
    if (agent.stars >= AA.TRAINING.MAX_STARS) {
      var specialLabel = this.add.text(x, y, '特殊行为: (' + AA.TRAINING.MAX_STARS + '星解锁)', {
        fontFamily: '"Courier New", "SimHei", monospace',
        fontSize: '14px',
        color: '#ffcc00',
        fontStyle: 'bold'
      }).setDepth(10);
      this.centerContent.push(specialLabel);
      y += 20;

      var behavior = agent.specialBehavior || 'none';
      for (var bk in AA.SPECIAL_BEHAVIORS) {
        var b = AA.SPECIAL_BEHAVIORS[bk];
        var isActive = bk === agent.specialBehavior;
        var bTxt = this.add.text(x + 10, y, (isActive ? '▶ ' : '  ') + b.name + ': ' + b.desc, {
          fontFamily: '"Courier New", "SimHei", monospace',
          fontSize: '12px',
          color: isActive ? '#ffcc00' : '#888888'
        }).setDepth(10);
        bTxt.setInteractive({ useHandCursor: true });
        (function(key) {
          bTxt.on('pointerdown', function() {
            window.NetworkManager.emit(E.AI_ARENA_SPECIAL, { agentId: agent.id, behaviorId: key });
          });
        })(bk);
        this.centerContent.push(bTxt);
        y += 16;
      }
    }

    // Match history
    y += 10;
    var histLabel = this.add.text(x, y, '最近对战:', {
      fontFamily: '"Courier New", "SimHei", monospace',
      fontSize: '13px',
      color: '#00ff88',
      fontStyle: 'bold'
    }).setDepth(10);
    this.centerContent.push(histLabel);
    y += 18;

    var history = agent.matchHistory || [];
    for (var hi = 0; hi < Math.min(history.length, 5); hi++) {
      var h = history[hi];
      var resultIcon = h.result === 'win' ? 'W' : h.result === 'loss' ? 'L' : 'D';
      var resultColor = h.result === 'win' ? '#00ff44' : h.result === 'loss' ? '#ff4444' : '#aaaaaa';
      var histTxt = this.add.text(x + 5, y + hi * 18, '[' + resultIcon + '] ' + (h.opponent || '???') + '  Δ' + (h.ratingChange || 0), {
        fontFamily: '"Courier New", monospace',
        fontSize: '11px',
        color: resultColor
      }).setDepth(10);
      this.centerContent.push(histTxt);
    }
  }

  /* ======================== RIGHT PANEL - TABS ======================== */
  drawRightPanelBG() {
    var H = this.scale.height;
    var gfx = this.add.graphics();
    gfx.setDepth(5);
    gfx.fillStyle(0x0a0a15, 0.85);
    gfx.fillRect(this.rightX, this.topBarH, this.rightPanelW, H - this.topBarH - 50);
  }

  renderRightPanelTabs() {
    var self = this;
    var tabX = this.rightX + 10;
    var tabY = this.topBarH + 5;
    var tabW = (this.rightPanelW - 20) / 3;

    var tabs = [
      { key: 'leaderboard', label: '排行榜' },
      { key: 'season', label: '赛季' },
      { key: 'tournament', label: '锦标赛' }
    ];

    tabs.forEach(function(tab, idx) {
      var x = tabX + idx * tabW;
      var isActive = self.currentTab === tab.key;
      var tabBg = self.add.graphics();
      tabBg.setDepth(10);
      tabBg.fillStyle(isActive ? 0x0a3a25 : 0x0a1a10, 0.9);
      tabBg.fillRoundedRect(x, tabY, tabW - 2, 28, 4);
      tabBg.lineStyle(1, isActive ? 0x00ff88 : 0x004422, isActive ? 0.8 : 0.4);
      tabBg.strokeRoundedRect(x, tabY, tabW - 2, 28, 4);

      var tabTxt = self.add.text(x + (tabW - 2) / 2, tabY + 14, tab.label, {
        fontFamily: '"Courier New", "SimHei", monospace',
        fontSize: '12px',
        color: isActive ? '#00ff88' : '#888888',
        fontStyle: isActive ? 'bold' : 'normal'
      }).setOrigin(0.5).setDepth(11);

      var tabHit = self.add.rectangle(x + (tabW - 2) / 2, tabY + 14, tabW - 2, 28, 0x000000, 0)
        .setInteractive({ useHandCursor: true }).setDepth(12);

      tabHit.on('pointerdown', function() {
        self.switchTab(tab.key);
      });
    });
  }

  switchTab(tabKey) {
    this.currentTab = tabKey;
    this.renderRightPanelTabs();

    if (tabKey === 'leaderboard') {
      this.renderLeaderboard();
    } else if (tabKey === 'season') {
      this.renderSeason();
    } else if (tabKey === 'tournament') {
      this.renderTournament();
    }
  }

  renderLeaderboard() {
    var self = this;
    this.rightContent.forEach(function(e) { if (e && e.destroy) e.destroy(); });
    this.rightContent = [];

    var x = this.rightX + 10;
    var y = this.topBarH + 45;

    var title = this.add.text(this.rightX + this.rightPanelW / 2, y, 'TOP 50 AELO', {
      fontFamily: '"Courier New", monospace',
      fontSize: '14px',
      color: '#ffcc00',
      fontStyle: 'bold'
    }).setOrigin(0.5, 0).setDepth(10);
    this.rightContent.push(title);
    y += 22;

    // Header
    var headerGfx = this.add.graphics();
    headerGfx.setDepth(10);
    headerGfx.fillStyle(0x0a2a15, 0.8);
    headerGfx.fillRect(x, y, this.rightPanelW - 20, 20);
    this.rightContent.push(headerGfx);

    var headerTxt = this.add.text(x + 5, y + 10, '排名  名称          AELO  W/L/D', {
      fontFamily: '"Courier New", monospace',
      fontSize: '10px',
      color: '#aaccaa'
    }).setOrigin(0, 0.5).setDepth(11);
    this.rightContent.push(headerTxt);
    y += 24;

    // Rows
    var maxRows = Math.min(this.leaderboard.length, 20);
    for (var i = 0; i < maxRows; i++) {
      var entry = this.leaderboard[i];
      var rowY = y + i * 18;

      if (i % 2 === 0) {
        var rowBg = this.add.graphics();
        rowBg.setDepth(9);
        rowBg.fillStyle(0x0a1a10, 0.4);
        rowBg.fillRect(x, rowY, this.rightPanelW - 20, 17);
        this.rightContent.push(rowBg);
      }

      var rankColor = i < 3 ? ['#ffcc00', '#cccccc', '#cc8844'][i] : '#888888';
      var row = (i + 1) + '.';
      var entryRating = entry.aeloRating || entry.rating || 0;
      var rowText = this.add.text(x + 5, rowY + 8, row.padEnd(3) + (entry.name || 'N/A').substring(0, 12).padEnd(14) + entryRating.toString().padEnd(6) + (entry.wins || 0) + '/' + (entry.losses || 0) + '/' + (entry.draws || 0), {
        fontFamily: '"Courier New", monospace',
        fontSize: '10px',
        color: rankColor
      }).setOrigin(0, 0.5).setDepth(11);
      this.rightContent.push(rowText);
    }
  }

  renderSeason() {
    var self = this;
    this.rightContent.forEach(function(e) { if (e && e.destroy) e.destroy(); });
    this.rightContent = [];

    var x = this.rightX + 10;
    var y = this.topBarH + 45;
    var AA = window.TokenWars.AI_ARENA;

    if (this.seasonInfo) {
      var s = this.seasonInfo;
      var buff = s.currentBuff || AA.SEASON.SEASON_BUFFS[0];

      var seasonTitle = this.add.text(this.rightX + this.rightPanelW / 2, y, buff.name || '当前赛季', {
        fontFamily: '"Courier New", "SimHei", monospace',
        fontSize: '16px',
        color: '#ffcc00',
        fontStyle: 'bold'
      }).setOrigin(0.5, 0).setDepth(10);
      this.rightContent.push(seasonTitle);
      y += 30;

      var buffDesc = this.add.text(x, y, '赛季效果:', {
        fontFamily: '"Courier New", "SimHei", monospace',
        fontSize: '13px',
        color: '#00ff88'
      }).setDepth(10);
      this.rightContent.push(buffDesc);
      y += 20;

      var descText = this.add.text(x + 5, y, (buff.desc || '无特殊效果'), {
        fontFamily: '"Courier New", "SimHei", monospace',
        fontSize: '12px',
        color: '#aaccaa'
      }).setDepth(10);
      this.rightContent.push(descText);
      y += 30;

      var progressLabel = this.add.text(x, y, '赛季进度:', {
        fontFamily: '"Courier New", "SimHei", monospace',
        fontSize: '13px',
        color: '#00ff88'
      }).setDepth(10);
      this.rightContent.push(progressLabel);
      y += 20;

      var daysRemaining = s.daysRemaining !== undefined ? s.daysRemaining : AA.SEASON.DURATION_DAYS;
      var progressText = this.add.text(x + 5, y, '剩余 ' + daysRemaining + ' 天', {
        fontFamily: '"Courier New", monospace',
        fontSize: '14px',
        color: '#44aaff'
      }).setDepth(10);
      this.rightContent.push(progressText);
      y += 25;

      var matchesLabel = this.add.text(x, y, '今日对战:', {
        fontFamily: '"Courier New", "SimHei", monospace',
        fontSize: '13px',
        color: '#00ff88'
      }).setDepth(10);
      this.rightContent.push(matchesLabel);
      y += 20;

      var matchesText = this.add.text(x + 5, y, this.dailyMatches + ' / ' + AA.SEASON.MATCHES_PER_DAY, {
        fontFamily: '"Courier New", monospace',
        fontSize: '14px',
        color: '#aaccaa'
      }).setDepth(10);
      this.rightContent.push(matchesText);
    } else {
      var loading = this.add.text(this.rightX + this.rightPanelW / 2, y, '加载中...', {
        fontFamily: '"Courier New", monospace',
        fontSize: '14px',
        color: '#888888'
      }).setOrigin(0.5, 0).setDepth(10);
      this.rightContent.push(loading);
    }
  }

  renderTournament() {
    var self = this;
    this.rightContent.forEach(function(e) { if (e && e.destroy) e.destroy(); });
    this.rightContent = [];

    var x = this.rightX + 10;
    var y = this.topBarH + 45;
    var AA = window.TokenWars.AI_ARENA;

    if (this.tournamentInfo) {
      var t = this.tournamentInfo;
      var title = this.add.text(this.rightX + this.rightPanelW / 2, y, '锦标赛 - TOP ' + AA.TOURNAMENT.TOP_N, {
        fontFamily: '"Courier New", "SimHei", monospace',
        fontSize: '14px',
        color: '#ffcc00',
        fontStyle: 'bold'
      }).setOrigin(0.5, 0).setDepth(10);
      this.rightContent.push(title);
      y += 30;

      // Status
      var statusMap = { upcoming: '即将开始', active: '进行中', finished: '已结束' };
      var status = this.add.text(x, y, '状态: ' + (statusMap[t.status] || t.status), {
        fontFamily: '"Courier New", "SimHei", monospace',
        fontSize: '13px',
        color: t.status === 'active' ? '#00ff44' : '#888888'
      }).setDepth(10);
      this.rightContent.push(status);
      y += 22;

      // Bracket visualization (simple text-based)
      var bracket = t.bracket || [];
      if (bracket.length > 0) {
        var bracketTitle = this.add.text(x, y, '对阵表:', {
          fontFamily: '"Courier New", "SimHei", monospace',
          fontSize: '12px',
          color: '#00ff88'
        }).setDepth(10);
        this.rightContent.push(bracketTitle);
        y += 18;

        for (var i = 0; i < Math.min(bracket.length, 8); i++) {
          var match = bracket[i];
          var p1 = match.agent1 || match.player1 || 'TBD';
          var p2 = match.agent2 || match.player2 || 'TBD';
          var matchTxt = p1 + ' vs ' + p2;
          var mTxt = this.add.text(x + 5, y, matchTxt, {
            fontFamily: '"Courier New", monospace',
            fontSize: '10px',
            color: '#aaccaa'
          }).setDepth(10);
          this.rightContent.push(mTxt);
          y += 14;
        }
      }

      // Champion
      if (t.champion) {
        y += 10;
        var champTitle = this.add.text(x, y, '上届冠军:', {
          fontFamily: '"Courier New", "SimHei", monospace',
          fontSize: '12px',
          color: '#ffcc00'
        }).setDepth(10);
        this.rightContent.push(champTitle);
        y += 18;

        var champText = this.add.text(x + 5, y, t.champion.name || 'N/A', {
          fontFamily: '"Courier New", monospace',
          fontSize: '13px',
          color: '#ffcc00'
        }).setDepth(10);
        this.rightContent.push(champText);
      }
    } else {
      var loading = this.add.text(this.rightX + this.rightPanelW / 2, y, '加载中...', {
        fontFamily: '"Courier New", monospace',
        fontSize: '14px',
        color: '#888888'
      }).setOrigin(0.5, 0).setDepth(10);
      this.rightContent.push(loading);
    }
  }

  /* ======================== MATCH QUEUE ======================== */
  drawQueueButton(W, H) {
    var self = this;
    // Queue button is in the right panel area, at the bottom
    var qX = this.rightX + this.rightPanelW / 2;
    var qY = H - 100;

    var qBg = this.add.graphics();
    qBg.setDepth(15);
    qBg.fillStyle(0x0a3a25, 0.9);
    qBg.fillRoundedRect(qX - 80, qY - 15, 160, 36, 6);
    qBg.lineStyle(2, 0x00ff44, 0.8);
    qBg.strokeRoundedRect(qX - 80, qY - 15, 160, 36, 6);
    this.queueButton = { bg: qBg };

    this.queueStatusText = this.add.text(qX, qY + 3, '开始匹配', {
      fontFamily: '"Courier New", "SimHei", monospace',
      fontSize: '16px',
      color: '#00ff88',
      fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(16);

    var qHit = this.add.rectangle(qX, qY + 3, 160, 36, 0x000000, 0)
      .setInteractive({ useHandCursor: true }).setDepth(17);

    qHit.on('pointerdown', function() {
      if (!self.selectedAgentId) {
        self._showNotification('请先选择一个代理');
        return;
      }
      var E = window.TokenWars.EVENTS;
      if (self.inQueue) {
        // Already in queue, do nothing
        return;
      }
      // Deploy agent first then match
      window.NetworkManager.emit(E.AI_ARENA_DEPLOY, { agentId: self.selectedAgentId });
      self.time.delayedCall(500, function() {
        window.NetworkManager.emit(E.AI_ARENA_MATCH_QUEUE, { agentId: self.selectedAgentId });
        self.setQueueStatus(true);
      });
    });

    qHit.on('pointerover', function() {
      self.queueStatusText.setColor('#ffffff');
    });
    qHit.on('pointerout', function() {
      self.queueStatusText.setColor(self.inQueue ? '#ffaa00' : '#00ff88');
    });
  }

  setQueueStatus(inQueue) {
    this.inQueue = inQueue;
    if (inQueue) {
      this.queueStatusText.setText('匹配中...');
      this.queueStatusText.setColor('#ffaa00');
    } else {
      this.queueStatusText.setText('开始匹配');
      this.queueStatusText.setColor('#00ff88');
    }
  }

  /* ======================== REPLAY VIEWER ======================== */
  showReplay(replayData) {
    var self = this;
    this.replayActive = true;
    this.replayData = replayData;
    this.replayTurn = 0;
    this.replayPaused = false;
    this.replayContainer.setVisible(true);

    // Clear previous replay elements
    this.replayElements.forEach(function(e) { if (e && e.destroy) e.destroy(); });
    this.replayElements = [];

    var W = this.scale.width;
    var H = this.scale.height;
    var AA = window.TokenWars.AI_ARENA;

    // Dark overlay
    var overlay = this.add.graphics();
    overlay.setDepth(199);
    overlay.fillStyle(0x000000, 0.85);
    overlay.fillRect(0, 0, W, H);
    this.replayElements.push(overlay);

    // Replay panel
    var rpX = W / 2 - 350;
    var rpY = 60;
    var rpW = 700;
    var rpH = H - 120;

    var panel = this.add.graphics();
    panel.setDepth(200);
    panel.fillStyle(0x0a0a1a, 0.95);
    panel.fillRoundedRect(rpX, rpY, rpW, rpH, 8);
    panel.lineStyle(2, 0x00ff44, 0.6);
    panel.strokeRoundedRect(rpX, rpY, rpW, rpH, 8);
    this.replayElements.push(panel);

    // Title
    var title = this.add.text(W / 2, rpY + 15, '对战回放', {
      fontFamily: '"Courier New", "SimHei", monospace',
      fontSize: '20px',
      color: '#00ff88',
      fontStyle: 'bold'
    }).setOrigin(0.5, 0).setDepth(201);
    this.replayElements.push(title);

    // Turn counter
    this.replayTurnText = this.add.text(W / 2, rpY + 40, '回合: 0 / ' + AA.MATCH.TURN_COUNT, {
      fontFamily: '"Courier New", monospace',
      fontSize: '14px',
      color: '#aaccaa'
    }).setOrigin(0.5, 0).setDepth(201);
    this.replayElements.push(this.replayTurnText);

    // Map area
    var mapX = rpX + 20;
    var mapY = rpY + 65;
    var mapW = Math.min(400, rpW - 40);
    var mapH = mapW;
    var cellSize = mapW / 8; // Assume 8x8 grid

    var mapBg = this.add.graphics();
    mapBg.setDepth(200);
    mapBg.fillStyle(0x0a1a10, 0.9);
    mapBg.fillRect(mapX, mapY, mapW, mapH);
    mapBg.lineStyle(1, 0x004422, 0.5);
    for (var gx = 0; gx <= 8; gx++) {
      mapBg.beginPath(); mapBg.moveTo(mapX + gx * cellSize, mapY); mapBg.lineTo(mapX + gx * cellSize, mapY + mapH); mapBg.strokePath();
    }
    for (var gy = 0; gy <= 8; gy++) {
      mapBg.beginPath(); mapBg.moveTo(mapX, mapY + gy * cellSize); mapBg.lineTo(mapX + mapW, mapY + gy * cellSize); mapBg.strokePath();
    }
    this.replayElements.push(mapBg);

    // Spawn markers
    var spawn1 = this.add.graphics();
    spawn1.setDepth(202);
    spawn1.fillStyle(0x00ff44, 0.15);
    spawn1.fillRect(mapX, mapY, cellSize * 2, cellSize * 2);
    spawn1.lineStyle(1, 0x00ff44, 0.5);
    spawn1.strokeRect(mapX, mapY, cellSize * 2, cellSize * 2);
    this.replayElements.push(spawn1);

    var spawn2 = this.add.graphics();
    spawn2.setDepth(202);
    spawn2.fillStyle(0xff4444, 0.15);
    spawn2.fillRect(mapX + mapW - cellSize * 2, mapY + mapH - cellSize * 2, cellSize * 2, cellSize * 2);
    spawn2.lineStyle(1, 0xff4444, 0.5);
    spawn2.strokeRect(mapX + mapW - cellSize * 2, mapY + mapH - cellSize * 2, cellSize * 2, cellSize * 2);
    this.replayElements.push(spawn2);

    // Agent circles (will be drawn on frame update)
    this.replayMapConfig = { x: mapX, y: mapY, w: mapW, h: mapH, cellSize: cellSize };
    this.replayAgentGraphics = this.add.graphics();
    this.replayAgentGraphics.setDepth(205);
    this.replayElements.push(this.replayAgentGraphics);

    // Info panel (right of map)
    var infoX = mapX + mapW + 15;
    var infoW = rpW - mapW - 55;
    this.replayInfoTexts = [];
    this.replayInfoConfig = { x: infoX, y: mapY, w: infoW, h: mapH };

    // Controls
    var ctrlY = rpY + rpH - 40;
    var ctrlCenterX = W / 2;

    this.replayPrevBtn = this.add.text(ctrlCenterX - 80, ctrlY, '◀◀', {
      fontFamily: '"Courier New", monospace',
      fontSize: '20px',
      color: '#00ff88',
      backgroundColor: '#0a2a15',
      padding: { x: 10, y: 5 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true }).setDepth(201);
    this.replayPrevBtn.on('pointerdown', function() { self.replayPrevStep(); });
    this.replayElements.push(this.replayPrevBtn);

    this.replayPlayBtn = this.add.text(ctrlCenterX, ctrlY, '▶', {
      fontFamily: '"Courier New", monospace',
      fontSize: '22px',
      color: '#00ff88',
      backgroundColor: '#0a2a15',
      padding: { x: 12, y: 5 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true }).setDepth(201);
    this.replayPlayBtn.on('pointerdown', function() { self.toggleReplay(); });
    this.replayElements.push(this.replayPlayBtn);

    this.replayNextBtn = this.add.text(ctrlCenterX + 80, ctrlY, '▶▶', {
      fontFamily: '"Courier New", monospace',
      fontSize: '20px',
      color: '#00ff88',
      backgroundColor: '#0a2a15',
      padding: { x: 10, y: 5 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true }).setDepth(201);
    this.replayNextBtn.on('pointerdown', function() { self.replayNextStep(); });
    this.replayElements.push(this.replayNextBtn);

    // Close button
    var closeBtn = this.add.text(rpX + rpW - 15, rpY + 10, '[× 关闭回放]', {
      fontFamily: '"Courier New", monospace',
      fontSize: '13px',
      color: '#ff4444'
    }).setOrigin(1, 0).setInteractive({ useHandCursor: true }).setDepth(201);
    closeBtn.on('pointerdown', function() { self.closeReplay(); });
    this.replayElements.push(closeBtn);

    // Start auto-advance
    this.startReplayAutoAdvance();
    this.updateReplayFrame();
  }

  updateReplayFrame() {
    if (!this.replayActive || !this.replayData) return;

    var AA = window.TokenWars.AI_ARENA;
    var cfg = this.replayMapConfig;
    var g = this.replayAgentGraphics;
    g.clear();

    // Get current turn data
    var turns = this.replayData.turns || [];
    var turn = turns[this.replayTurn];
    if (!turn) return;

    // Clear info texts
    if (this.replayInfoTexts) {
      this.replayInfoTexts.forEach(function(t) { if (t && t.destroy) t.destroy(); });
    }
    this.replayInfoTexts = [];
    var infoX = this.replayInfoConfig.x;
    var infoY = this.replayInfoConfig.y;

    this.replayTurnText.setText('回合: ' + (this.replayTurn + 1) + ' / ' + Math.max(turns.length, AA.MATCH.TURN_COUNT));

    // Draw agents
    var agents = turn.agents || [];
    for (var i = 0; i < agents.length; i++) {
      var a = agents[i];
      var ax = cfg.x + (a.x || 0) * cfg.cellSize + cfg.cellSize / 2;
      var ay = cfg.y + (a.y || 0) * cfg.cellSize + cfg.cellSize / 2;
      var isAlly = a.team === 'ally';
      var color = isAlly ? 0x00ff88 : 0xff4488;

      // Body circle
      g.fillStyle(color, 0.7);
      g.fillCircle(ax, ay, cfg.cellSize * 0.3);
      g.lineStyle(1, color, 1);
      g.strokeCircle(ax, ay, cfg.cellSize * 0.3);

      // HP bar
      var hpRatio = 1.0; // default
      if (a.hp !== undefined && a.maxHp !== undefined) {
        hpRatio = Math.max(0, a.hp / a.maxHp);
      }
      var hpBarW = cfg.cellSize * 0.6;
      var hpBarY = ay - cfg.cellSize * 0.4;
      g.fillStyle(0x333333, 0.8);
      g.fillRect(ax - hpBarW / 2, hpBarY, hpBarW, 3);
      var hpColor = hpRatio > 0.5 ? 0x00ff44 : hpRatio > 0.25 ? 0xffaa00 : 0xff3333;
      g.fillStyle(hpColor, 1);
      g.fillRect(ax - hpBarW / 2, hpBarY, hpBarW * hpRatio, 3);

      // Name tag
      var nameTag = this.add.text(ax, ay - cfg.cellSize * 0.5, (a.name || '').substring(0, 6), {
        fontFamily: '"Courier New", monospace',
        fontSize: '9px',
        color: isAlly ? '#00ff88' : '#ff8888'
      }).setOrigin(0.5).setDepth(206);
      this.replayElements.push(nameTag);
      this.replayInfoTexts.push(nameTag);

      // Info panel entry
      var entryY = infoY + i * 45;
      var teamIcon = isAlly ? '🟢' : '🔴';
      var infoEntry = this.add.text(infoX, entryY, teamIcon + ' ' + (a.name || 'Agent').substring(0, 10) + '\nHP:' + (a.hp || 0) + '/' + (a.maxHp || 100) + '  战力:' + (a.power || 0), {
        fontFamily: '"Courier New", monospace',
        fontSize: '10px',
        color: isAlly ? '#00ff88' : '#ff8888'
      }).setDepth(206);
      this.replayElements.push(infoEntry);
      this.replayInfoTexts.push(infoEntry);

      // Action bubble
      if (a.action) {
        var bubble = this.add.text(ax, ay - cfg.cellSize * 0.65, a.action.substring(0, 12), {
          fontFamily: '"Courier New", "SimHei", monospace',
          fontSize: '8px',
          color: '#ffffff',
          backgroundColor: '#000000aa',
          padding: { x: 3, y: 1 }
        }).setOrigin(0.5, 1).setDepth(206);
        this.replayElements.push(bubble);
        this.replayInfoTexts.push(bubble);
      }
    }

    // Tokens on map
    var tokens = turn.tokens || [];
    for (var ti = 0; ti < tokens.length; ti++) {
      var t = tokens[ti];
      var tx = cfg.x + (t.x || 0) * cfg.cellSize + cfg.cellSize / 2;
      var ty = cfg.y + (t.y || 0) * cfg.cellSize + cfg.cellSize / 2;
      g.fillStyle(0xffcc00, 0.9);
      g.fillCircle(tx, ty, cfg.cellSize * 0.12);
    }
  }

  startReplayAutoAdvance() {
    var self = this;
    var AA = window.TokenWars.AI_ARENA;

    if (this.replayTimer) {
      this.replayTimer.destroy();
    }

    this.replayTimer = this.time.addEvent({
      delay: 200,
      repeat: -1,
      callback: function() {
        if (!self.replayPaused && self.replayActive) {
          var turns = self.replayData.turns || [];
          if (self.replayTurn < turns.length - 1) {
            self.replayTurn++;
            self.updateReplayFrame();
          } else if (self.replayTurn >= turns.length - 1) {
            // Replay ended - stop auto advance
            if (self.replayTimer) {
              self.replayTimer.destroy();
              self.replayTimer = null;
            }
            self.replayPaused = true; // pause at end
            if (self.replayPlayBtn) {
              self.replayPlayBtn.setText('■');
            }
          }
        }
      }
    });
  }

  toggleReplay() {
    this.replayPaused = !this.replayPaused;
    if (this.replayPlayBtn) {
      this.replayPlayBtn.setText(this.replayPaused ? '▶' : '■');
    }
  }

  replayPrevStep() {
    if (this.replayTurn > 0) {
      this.replayTurn--;
      this.updateReplayFrame();
    }
  }

  replayNextStep() {
    var turns = this.replayData ? this.replayData.turns || [] : [];
    if (this.replayTurn < turns.length - 1) {
      this.replayTurn++;
      this.updateReplayFrame();
    }
  }

  closeReplay() {
    this.replayActive = false;
    this.replayPaused = false;

    if (this.replayTimer) {
      this.replayTimer.destroy();
      this.replayTimer = null;
    }

    this.replayElements.forEach(function(e) { if (e && e.destroy) e.destroy(); });
    this.replayElements = [];
    if (this.replayInfoTexts) {
      this.replayInfoTexts.forEach(function(t) { if (t && t.destroy) t.destroy(); });
    }
    this.replayInfoTexts = [];
    this.replayContainer.setVisible(false);
  }

  /* ======================== NETWORK ======================== */
  _setupNetwork(E, AA) {
    var self = this;

    // Agent list
    window.NetworkManager.on(E.AI_ARENA_AGENT_LIST, function(data) {
      if (data && data.agents) {
        self.agents = data.agents;
        self.renderAgentList();
        // If selected agent exists in new list, refresh detail
        if (self.selectedAgentId) {
          var found = data.agents.find(function(a) { return a.id === self.selectedAgentId; });
          if (found) {
            self.selectedAgent = found;
            self.renderAgentDetail();
          } else {
            self.selectedAgent = null;
            self.selectedAgentId = null;
            self.renderAgentDetail();
          }
        }
      }
      if (data && data.tokens !== undefined) {
        self.tokens = data.tokens;
        self.tokenText.setText('Token: ' + self.tokens);
      }
    });

    // Match queued
    window.NetworkManager.on(E.AI_ARENA_MATCH_QUEUE, function(data) {
      if (data && data.queued !== undefined) {
        self.setQueueStatus(data.queued);
      }
    });

    // Match start
    window.NetworkManager.on(E.AI_ARENA_MATCH_START, function(data) {
      self.setQueueStatus(false);
      self._showNotification('对战开始!');
      if (data && data.replay) {
        self.showReplay(data.replay);
      }
    });

    // Match end
    window.NetworkManager.on(E.AI_ARENA_MATCH_END, function(data) {
      self.setQueueStatus(false);
      if (data) {
        var result = data.result || 'draw';
        var resultMsgs = { win: '胜利! +' + (data.ratingChange || 0), loss: '失败... ' + (data.ratingChange || 0), draw: '平局' };
        var msg = resultMsgs[result] || '对战结束';
        self._showNotification(msg);

        // Update agent data
        if (self.selectedAgentId) {
          window.NetworkManager.emit(E.AI_ARENA_AGENT_LIST);
        }

        // Update leaderboard
        window.NetworkManager.emit(E.AI_ARENA_LEADERBOARD);

        // Close replay after a moment
        self.time.delayedCall(3000, function() {
          if (self.replayActive) {
            self.closeReplay();
          }
        });
      }
    });

    // Leaderboard
    window.NetworkManager.on(E.AI_ARENA_LEADERBOARD, function(data) {
      if (data && data.leaderboard) {
        self.leaderboard = data.leaderboard;
        if (self.currentTab === 'leaderboard') {
          self.renderLeaderboard();
        }
      }
    });

    // Season info
    window.NetworkManager.on(E.AI_ARENA_SEASON_INFO, function(data) {
      if (data) {
        self.seasonInfo = data;
        self.dailyMatches = data.dailyMatches || 0;
        if (self.matchText) {
          self.matchText.setText('今日对战: ' + self.dailyMatches + '/' + AA.SEASON.MATCHES_PER_DAY);
        }
        if (self.currentTab === 'season') {
          self.renderSeason();
        }
      }
    });

    // Tournament info
    window.NetworkManager.on(E.AI_ARENA_TOURNAMENT_INFO, function(data) {
      if (data) {
        self.tournamentInfo = data;
        if (self.currentTab === 'tournament') {
          self.renderTournament();
        }
      }
    });

    // Tournament update
    window.NetworkManager.on(E.AI_ARENA_TOURNAMENT_UPDATE, function(data) {
      if (data) {
        var msg = '锦标赛更新: ' + (data.message || '');
        self._showNotification(msg);
        window.NetworkManager.emit(E.AI_ARENA_TOURNAMENT_INFO);
      }
    });

    // Broadcast
    window.NetworkManager.on(E.AI_ARENA_BROADCAST, function(data) {
      if (data && data.message) {
        self._showNotification(data.message);
      }
    });

    // Daily reward
    window.NetworkManager.on(E.AI_ARENA_DAILY_REWARD, function(data) {
      if (data) {
        self._showNotification('每日奖励: +' + (data.tokens || 0) + ' Token!');
      }
    });

    // Token update
    window.NetworkManager.on(E.TOKEN_UPDATE, function(data) {
      if (data && data.balance !== undefined) {
        self.tokens = data.balance;
        self.tokenText.setText('Token: ' + self.tokens);
      }
    });
  }

  /* ======================== AGENT INTERACTION ======================== */
  selectAgent(agentId) {
    var self = this;
    this.selectedAgentId = agentId;

    // Find agent
    var found = this.agents.find(function(a) { return a.id === agentId; });
    if (found) {
      this.selectedAgent = found;
      this.renderAgentList();
      this.renderAgentDetail();
      // Load match history
      window.NetworkManager.emit(window.TokenWars.EVENTS.AI_ARENA_HISTORY, { agentId: agentId });
    }
  }

  _promptCreateAgent(E) {
    var self = this;
    this._showInputDialog('创建新代理', '请输入代理名称', '', function(name) {
      if (name && name.trim()) {
        window.NetworkManager.emit(E.AI_ARENA_DEPLOY, { action: 'create', name: name.trim() });
        self.time.delayedCall(500, function() {
          window.NetworkManager.emit(E.AI_ARENA_AGENT_LIST);
        });
      }
    });
  }

  _promptRename(agent, E) {
    var self = this;
    this._showInputDialog('重命名代理', '请输入新名称', agent.name || '', function(newName) {
      if (newName && newName.trim() && newName.trim() !== agent.name) {
        window.NetworkManager.emit(E.AI_ARENA_NAME, { agentId: agent.id, name: newName.trim() });
        agent.name = newName.trim();
        self.renderAgentList();
        self.renderAgentDetail();
      }
    });
  }

  _promptAssignToken(E, agent, category) {
    var self = this;
    this._showInputDialog('分配Token', '请输入' + category + '类别技能名称', '', function(tokenName) {
      if (tokenName && tokenName.trim()) {
        window.NetworkManager.emit(E.AI_ARENA_DEPLOY, {
          agentId: agent.id,
          action: 'assign_token',
          category: category,
          tokenName: tokenName.trim()
        });
        self.time.delayedCall(500, function() {
          window.NetworkManager.emit(E.AI_ARENA_AGENT_LIST);
        });
      }
    });
  }

  /**
   * Phaser-native modal input dialog.
   * Replaces browser prompt() with an in-game overlay.
   * @param {string} title - Dialog title
   * @param {string} label - Input label text
   * @param {string} defaultValue - Pre-filled value
   * @param {function} onConfirm - Callback with the entered text
   */
  _showInputDialog(title, label, defaultValue, onConfirm) {
    var self = this;
    var W = this.scale.width;
    var H = this.scale.height;

    // Blocker overlay
    var overlay = this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.7)
      .setDepth(200)
      .setInteractive();

    // Dialog box
    var dlgW = 400;
    var dlgH = 180;
    var dlgX = W / 2 - dlgW / 2;
    var dlgY = H / 2 - dlgH / 2;

    var dlgBg = this.add.graphics();
    dlgBg.setDepth(201);
    dlgBg.fillStyle(0x0a1a12, 0.95);
    dlgBg.fillRoundedRect(dlgX, dlgY, dlgW, dlgH, 10);
    dlgBg.lineStyle(2, 0x00ff88, 0.8);
    dlgBg.strokeRoundedRect(dlgX, dlgY, dlgW, dlgH, 10);

    // Title
    var titleTxt = this.add.text(W / 2, dlgY + 20, title, {
      fontFamily: '"Courier New", "SimHei", monospace',
      fontSize: '16px',
      color: '#00ff88',
      fontStyle: 'bold'
    }).setOrigin(0.5, 0).setDepth(202);

    // Label
    this.add.text(dlgX + 20, dlgY + 50, label, {
      fontFamily: '"Courier New", "SimHei", monospace',
      fontSize: '12px',
      color: '#00ff88aa'
    }).setDepth(202);

    // Input background
    var inputBg = this.add.graphics();
    inputBg.setDepth(202);
    inputBg.fillStyle(0x000000, 0.6);
    inputBg.fillRoundedRect(dlgX + 20, dlgY + 72, dlgW - 40, 32, 4);
    inputBg.lineStyle(1, 0x00ff88, 0.5);
    inputBg.strokeRoundedRect(dlgX + 20, dlgY + 72, dlgW - 40, 32, 4);

    // Input text (simulated — using a Phaser Text with keyboard events)
    var inputText = '';
    var inputDisplay = this.add.text(dlgX + 28, dlgY + 78, defaultValue || '', {
      fontFamily: '"Courier New", monospace',
      fontSize: '14px',
      color: '#ffffff'
    }).setDepth(203);

    if (defaultValue) {
      inputText = defaultValue;
    }

    // Cursor blink
    var cursorVisible = true;
    var cursorTimer = this.time.addEvent({
      delay: 500,
      repeat: -1,
      callback: function() {
        cursorVisible = !cursorVisible;
        self._updateInputDisplay(inputDisplay, inputText, cursorVisible);
      }
    });
    self._updateInputDisplay(inputDisplay, inputText, true);

    // Create an invisible DOM textarea for real keyboard input
    var textarea = document.createElement('textarea');
    textarea.style.position = 'absolute';
    textarea.style.left = '-9999px';
    textarea.style.opacity = '0';
    textarea.value = defaultValue || '';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    textarea.addEventListener('input', function() {
      inputText = textarea.value;
      self._updateInputDisplay(inputDisplay, inputText, true);
    });

    textarea.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        cleanup();
        if (onConfirm) onConfirm(inputText);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cleanup();
      }
    });

    function cleanup() {
      cursorTimer.destroy();
      overlay.destroy();
      dlgBg.destroy();
      titleTxt.destroy();
      inputBg.destroy();
      inputDisplay.destroy();
      // Destroy confirm/cancel buttons
      if (confirmBtn) confirmBtn.destroy();
      if (confirmTxt) confirmTxt.destroy();
      if (cancelBtn) cancelBtn.destroy();
      if (cancelTxt) cancelTxt.destroy();
      // Destroy label texts
      self.children.list.filter(function(c) {
        return c.depth === 202 && c !== titleTxt && c !== inputBg && c !== inputDisplay;
      }).forEach(function(c) { c.destroy(); });
      // Remove DOM textarea
      if (textarea.parentNode) document.body.removeChild(textarea);
    }

    // Confirm button
    var confirmBtn = this.add.graphics();
    confirmBtn.setDepth(202);
    confirmBtn.fillStyle(0x0a3a25, 0.9);
    confirmBtn.fillRoundedRect(dlgX + dlgW / 2 + 10, dlgY + dlgH - 45, 80, 28, 4);
    confirmBtn.lineStyle(1, 0x00ff88, 0.7);
    confirmBtn.strokeRoundedRect(dlgX + dlgW / 2 + 10, dlgY + dlgH - 45, 80, 28, 4);

    var confirmTxt = this.add.text(dlgX + dlgW / 2 + 50, dlgY + dlgH - 31, '确认', {
      fontFamily: '"Courier New", "SimHei", monospace',
      fontSize: '13px',
      color: '#00ff88'
    }).setOrigin(0.5).setDepth(203);

    var confirmHit = this.add.rectangle(dlgX + dlgW / 2 + 50, dlgY + dlgH - 31, 80, 28, 0x000000, 0)
      .setInteractive({ useHandCursor: true })
      .setDepth(204);
    confirmHit.on('pointerdown', function() {
      cleanup();
      if (onConfirm) onConfirm(inputText);
    });

    // Cancel button
    var cancelBtn = this.add.graphics();
    cancelBtn.setDepth(202);
    cancelBtn.fillStyle(0x2a0a0a, 0.9);
    cancelBtn.fillRoundedRect(dlgX + dlgW / 2 - 90, dlgY + dlgH - 45, 80, 28, 4);
    cancelBtn.lineStyle(1, 0xff4444, 0.7);
    cancelBtn.strokeRoundedRect(dlgX + dlgW / 2 - 90, dlgY + dlgH - 45, 80, 28, 4);

    var cancelTxt = this.add.text(dlgX + dlgW / 2 - 50, dlgY + dlgH - 31, '取消', {
      fontFamily: '"Courier New", "SimHei", monospace',
      fontSize: '13px',
      color: '#ff6666'
    }).setOrigin(0.5).setDepth(203);

    var cancelHit = this.add.rectangle(dlgX + dlgW / 2 - 50, dlgY + dlgH - 31, 80, 28, 0x000000, 0)
      .setInteractive({ useHandCursor: true })
      .setDepth(204);
    cancelHit.on('pointerdown', function() {
      cleanup();
    });

    // Click overlay to cancel
    overlay.on('pointerdown', function() {
      cleanup();
    });
  }

  _updateInputDisplay(textObj, value, cursorVisible) {
    var display = value || '';
    if (cursorVisible) display += '_';
    textObj.setText(display);
  }

  _showNotification(message) {
    var self = this;
    var W = this.scale.width;

    var notif = this.add.text(W / 2, 80, message, {
      fontFamily: '"Courier New", "SimHei", monospace',
      fontSize: '16px',
      color: '#ffcc00',
      backgroundColor: '#000000cc',
      padding: { x: 15, y: 8 }
    }).setOrigin(0.5).setDepth(300);

    this.tweens.add({
      targets: notif,
      y: 50,
      alpha: 0,
      duration: 2500,
      ease: 'Power2',
      delay: 500,
      onComplete: function() {
        notif.destroy();
      }
    });
  }

  /* ======================== CLEANUP ======================== */
  _cleanup() {
    var E = window.TokenWars.EVENTS;

    if (this.replayTimer) {
      this.replayTimer.destroy();
      this.replayTimer = null;
    }

    // Recall deployed agents
    if (this.selectedAgentId) {
      window.NetworkManager.emit(E.AI_ARENA_RECALL, { agentId: this.selectedAgentId });
    }

    this.setQueueStatus(false);

    // Disconnect leave
    window.NetworkManager.emit(E.LEAVE_ROOM, {});
  }
}
