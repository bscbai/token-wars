const crypto = require('crypto');
const { AI_ARENA } = require('../../shared/constants');

class AIAgent {
  constructor(ownerId, name) {
    this.id = crypto.randomUUID ? crypto.randomUUID() : 'agent_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    this.ownerId = ownerId;
    this.name = name || 'Unnamed Agent';
    this.tokens = [];
    this.stars = 1;
    this.exp = 0;
    this.specialBehavior = null;
    this.aeloRating = AI_ARENA.INITIAL_RATING;
    this.wins = 0;
    this.losses = 0;
    this.draws = 0;
    this.streak = 0;
    this.deployed = false;
    this.matchHistory = [];
    this.createdAt = Date.now();
  }

  addToken(token) {
    const tokenEntry = {
      id: token.id || 'token_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      category: token.category,
      rarity: token.rarity || 'common',
      value: token.value || 10,
      name: token.name || token.category + '_token',
    };
    this.tokens.push(tokenEntry);
    return tokenEntry;
  }

  removeToken(tokenId) {
    const idx = this.tokens.findIndex((t) => t.id === tokenId);
    if (idx === -1) return null;
    const removed = this.tokens.splice(idx, 1)[0];
    return removed;
  }

  getWeight(category) {
    const tokensInCategory = this.tokens.filter((t) => t.category === category);
    if (tokensInCategory.length === 0) return 0;

    let totalWeight = 0;
    for (const token of tokensInCategory) {
      const mult = AI_ARENA.RARITY_MULTIPLIERS[token.rarity] || 1.0;
      totalWeight += token.value * mult;
    }
    return Math.round(totalWeight * 100) / 100;
  }

  getWeights() {
    const attack = this.getWeight('attack');
    const defense = this.getWeight('defense');
    const mobility = this.getWeight('mobility');
    const economy = this.getWeight('economy');
    const total = attack + defense + mobility + economy;

    return {
      attack: Math.round(attack * 100) / 100,
      defense: Math.round(defense * 100) / 100,
      mobility: Math.round(mobility * 100) / 100,
      economy: Math.round(economy * 100) / 100,
      total: Math.round(total * 100) / 100,
      percentages: {
        attack: total > 0 ? Math.round((attack / total) * 10000) / 100 : 0,
        defense: total > 0 ? Math.round((defense / total) * 10000) / 100 : 0,
        mobility: total > 0 ? Math.round((mobility / total) * 10000) / 100 : 0,
        economy: total > 0 ? Math.round((economy / total) * 10000) / 100 : 0,
      },
    };
  }

  addExp(amount) {
    this.exp += amount;

    // Star progression: each threshold is the CUMULATIVE exp needed from the previous star
    // Star 1 → 2: needs 50 EXP total (STAR_2_EXP)
    // Star 2 → 3: needs 150 EXP additional from star 2 (STAR_3_EXP)
    // Total from star 1 to star 3: 50 + 150 = 200 EXP
    if (this.stars < 2 && this.exp >= AI_ARENA.TRAINING.STAR_2_EXP) {
      this.stars = 2;
      this.exp -= AI_ARENA.TRAINING.STAR_2_EXP;
    }

    if (this.stars < 3 && this.exp >= AI_ARENA.TRAINING.STAR_3_EXP) {
      this.stars = 3;
      this.exp -= AI_ARENA.TRAINING.STAR_3_EXP;
    }

    // Cap exp at max star level
    if (this.stars >= AI_ARENA.TRAINING.MAX_STARS) {
      this.exp = Math.min(this.exp, AI_ARENA.TRAINING.STAR_3_EXP);
    }

    return { stars: this.stars, exp: this.exp };
  }

  setSpecialBehavior(behaviorId) {
    if (this.stars < 3) {
      return { success: false, reason: 'stars_required', required: 3, current: this.stars };
    }

    const validBehaviors = Object.keys(AI_ARENA.SPECIAL_BEHAVIORS);
    if (!validBehaviors.includes(behaviorId)) {
      return {
        success: false,
        reason: 'invalid_behavior',
        validBehaviors,
      };
    }

    this.specialBehavior = behaviorId;
    return {
      success: true,
      behavior: behaviorId,
      info: AI_ARENA.SPECIAL_BEHAVIORS[behaviorId],
    };
  }

  recordMatch(result, ratingChange) {
    const matchRecord = {
      matchId: 'match_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      result,
      ratingChange,
      timestamp: Date.now(),
    };

    this.matchHistory.push(matchRecord);

    // Limit history to prevent unbounded memory growth
    if (this.matchHistory.length > 50) {
      this.matchHistory = this.matchHistory.slice(-50);
    }

    this.aeloRating += ratingChange;

    if (result === 'win') {
      this.wins += 1;
      if (this.streak >= 0) this.streak += 1;
      else this.streak = 1;
    } else if (result === 'loss') {
      this.losses += 1;
      if (this.streak <= 0) this.streak -= 1;
      else this.streak = -1;
    } else if (result === 'draw') {
      this.draws += 1;
      this.streak = 0;
    }

    return matchRecord;
  }

  getWinRate() {
    const total = this.wins + this.losses + this.draws;
    if (total === 0) return 0;
    return Math.round((this.wins / total) * 10000) / 100;
  }

  getMatchCount() {
    return this.wins + this.losses + this.draws;
  }

  toJSON() {
    const weights = this.getWeights();
    return {
      id: this.id,
      ownerId: this.ownerId,
      name: this.name,
      tokens: this.tokens,
      stars: this.stars,
      exp: this.exp,
      specialBehavior: this.specialBehavior,
      aeloRating: this.aeloRating,
      wins: this.wins,
      losses: this.losses,
      draws: this.draws,
      streak: this.streak,
      deployed: this.deployed,
      winRate: this.getWinRate(),
      totalMatches: this.getMatchCount(),
      weights,
      hp: this._hp,
      x: this._x,
      y: this._y,
    };
  }

  // ─── Match simulation state helpers ─────────────────────────────────

  initMatchState(team, index) {
    this._hp = 100;
    this._maxHp = 100;
    this._alive = true;
    this._team = team;
    this._index = index;
    this._x = 0;
    this._y = 0;
    this._tokensCollected = 0;
    this._damageDealt = 0;
    this._damageTaken = 0;
    this._actions = [];
    this._blockCounter = 0;
    this._hasBlockedThisTurn = false;
  }

  isAlive() {
    return this._hp > 0 && this._alive;
  }

  takeDamage(amount, attackerId) {
    if (!this.isAlive()) return { died: false, damage: 0 };

    let finalDamage = amount;

    // Dodge master check
    if (this.specialBehavior === 'dodge_master') {
      if (Math.random() < 0.15) {
        return { dodged: true, damage: 0 };
      }
    }

    // Perfect defense block check
    if (this.specialBehavior === 'perfect_defense' && !this._hasBlockedThisTurn) {
      if (this._blockCounter >= 5) {
        this._hasBlockedThisTurn = true;
        this._blockCounter = 0;
        return { blocked: true, damage: 0 };
      }
      this._blockCounter++;
    }

    this._hp = Math.max(0, this._hp - finalDamage);
    this._damageTaken += finalDamage;

    if (this._hp <= 0) {
      this._alive = false;
    }

    return {
      died: !this._alive,
      damage: finalDamage,
      remainingHp: this._hp,
    };
  }

  dealDamage(rawAmount) {
    let amount = rawAmount;

    // Berserker: double attack when HP < 30%
    if (this.specialBehavior === 'berserker' && this._hp < this._maxHp * 0.3) {
      amount *= 2;
    }

    this._damageDealt += amount;
    return Math.round(amount * 100) / 100;
  }

  collectTokens(amount) {
    let collected = amount;

    // Greedy algorithm: 1.5x token pickups
    if (this.specialBehavior === 'greedy_algorithm') {
      collected = Math.floor(amount * 1.5);
    }

    this._tokensCollected += collected;
    return collected;
  }
}

module.exports = AIAgent;
