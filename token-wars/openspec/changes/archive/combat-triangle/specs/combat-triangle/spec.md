# Spec: Combat Triangle

## ADDED Requirements

### Requirement: Melee Penetrates Shield at Reduced Damage (Q counters E)
A melee skill hitting a player with an active shield SHALL bypass the shield value and deal 50% of the computed damage directly to HP, without depleting the shield.

#### Scenario: Basic attack vs shielded player
- GIVEN a target player with `shieldActive = true` and `shield = 20`
- WHEN the attacker lands a melee skill (Q) on the target
- THEN the target loses HP equal to `floor(baseDamage * 1.5 if crit, then * 0.5)` (minimum 1)
- AND the target's `shield` value is unchanged
- AND the `COMBAT_HIT` payload includes `penetrated: true`

### Requirement: Shield Fully Absorbs AOE (E counters R)
An AOE skill hitting a player with an active shield SHALL deal no HP damage; the shield absorbs up to its remaining value.

#### Scenario: Token burst vs shielded player
- GIVEN a target player with `shieldActive = true` and `shield = 20`
- WHEN the attacker's AOE skill (R) would deal 30 damage to the target
- THEN the target loses 0 HP
- AND the target's shield drops to 0 and `shieldActive` becomes false with a `COMBAT_SHIELD { active: false }` broadcast
- AND the `COMBAT_HIT` payload includes `absorbed: 20`

#### Scenario: Shield survives partial absorption
- GIVEN a target with `shield = 50`
- WHEN the AOE would deal 30 damage
- THEN the target loses 0 HP and the shield drops to 20, remaining active

### Requirement: AOE Interrupts and Knocks Back Unshielded Players (R counters Q)
An AOE skill hitting a player without an active shield SHALL knock the target back 1 tile away from the attacker and put the target's basic attack on full cooldown.

#### Scenario: Knockback into open ground
- GIVEN an unshielded target at (10, 10) and attacker at (9, 10) on an open map
- WHEN the attacker's AOE hits the target
- THEN the target moves to (11, 10) and `COMBAT_KNOCKBACK` is broadcast
- AND the target's skill slot 0 `lastUsed` is set to now (full cooldown)

#### Scenario: Knockback blocked by wall
- GIVEN an unshielded target adjacent to a wall tile in the knockback direction
- WHEN the AOE hits the target
- THEN the target does not move and still takes damage and the interrupt

### Requirement: Combo Sequence Detection
Successfully executed skills SHALL be recorded as a key sequence on the player; when the sequence tail exactly matches a combo recipe within the 2-second window, the combo SHALL trigger once and the sequence SHALL reset.

#### Scenario: Charged burst (Q→Q→R)
- GIVEN the player used Q then Q within 2 seconds
- WHEN the player successfully uses R within 2 seconds of the second Q
- THEN the AOE damage of that R is multiplied by 1.3
- AND the player receives `COMBAT_COMBO { comboId: 'charged_burst' }`

#### Scenario: Counter combo (E→Q→Q)
- GIVEN the player used E then Q within the window
- WHEN the player uses a second Q within the window
- THEN that Q consumes no ammo of any kind and applies no basic-ammo damage penalty

#### Scenario: Dodge counter (W→Q)
- GIVEN the player used W
- WHEN the player uses Q within 1 second of the dodge
- THEN that Q's crit chance is increased by 0.5 (base 0.1 → 0.6)

#### Scenario: Blast shield (R→E→Q)
- GIVEN the player used R then E within the window
- WHEN the player uses Q within the window to complete the sequence
- THEN the active shield's remaining absorb value is doubled and `COMBAT_SHIELD` is re-broadcast

#### Scenario: Perfect defense (E→W→E)
- GIVEN the player used E then W within the window
- WHEN the player uses a second E within the window
- THEN that E's duration is doubled

#### Scenario: Expired window does not trigger
- GIVEN the player used Q and more than 2 seconds pass
- WHEN the player uses Q then R
- THEN no combo triggers (the first Q is evicted from the sequence)

### Requirement: Basic Ammo Pool
Every player SHALL have a persisted basic-ammo pool (max 50) that is consumed before unstable tokens and applies a 0.5x damage multiplier whenever it contributes to a skill's cost.

#### Scenario: Basic ammo consumed first
- GIVEN a player with `basicAmmo = 50` and `unstableTokens = 20`
- WHEN the player uses a skill costing 1 token
- THEN `basicAmmo` becomes 49 and `unstableTokens` stays 20
- AND the skill's damage is multiplied by 0.5

#### Scenario: Mixed payment applies the penalty
- GIVEN a player with `basicAmmo = 1` and `unstableTokens = 10`
- WHEN the player uses a skill costing 3 tokens
- THEN `basicAmmo` becomes 0, `unstableTokens` decreases by 2, and damage is multiplied by 0.5

#### Scenario: Pure unstable payment keeps full damage
- GIVEN a player with `basicAmmo = 0` and sufficient `unstableTokens`
- WHEN the player uses a skill
- THEN no damage multiplier is applied

#### Scenario: Insufficient total ammo
- GIVEN a player with `basicAmmo = 0` and `unstableTokens` below the skill cost
- WHEN the player uses the skill
- THEN the skill is rejected with reason `insufficient_tokens` and nothing is consumed

#### Scenario: Old saves get a full pool
- GIVEN a saved player record without a `basicAmmo` field
- WHEN it is loaded via `Player.fromSave`
- THEN `basicAmmo` defaults to 50

### Requirement: Basic Ammo Out-of-Combat Regeneration
Basic ammo SHALL regenerate 1 round per 30 seconds while the player has not used a skill for 30 seconds, up to the cap of 50.

#### Scenario: Regen after 30s out of combat
- GIVEN a player with `basicAmmo = 10` whose last skill use was 30 seconds ago
- WHEN the combat tick runs
- THEN `basicAmmo` becomes 11 and the next round requires another 30 seconds

#### Scenario: Combat resets the regen timer
- GIVEN a player 29 seconds into the regen timer
- WHEN the player uses any skill
- THEN the regen timer restarts from that skill use

#### Scenario: No regen at cap
- GIVEN a player with `basicAmmo = 50`
- WHEN 30 seconds pass out of combat
- THEN `basicAmmo` remains 50

### Requirement: Shield Duration and Drain Cadence
An active shield SHALL expire after its duration (4 seconds base) and SHALL drain exactly 1 ammo per second, paid from basic ammo first.

#### Scenario: Shield expires after duration
- GIVEN a player raised a shield with base duration 4000ms
- WHEN 4000ms elapse without the Perfect Defense combo
- THEN the shield deactivates with a `COMBAT_SHIELD { active: false }` broadcast

#### Scenario: Drain cadence is 1 per second
- GIVEN a player with an active shield
- WHEN 10 combat ticks (500ms) elapse
- THEN exactly 0 or 1 ammo is drained, and exactly 1 per full second over time

#### Scenario: Shield collapses when ammo runs out
- GIVEN an active shield and a player with no basic ammo and no unstable tokens
- WHEN the next drain is due
- THEN the shield deactivates immediately

### Requirement: Combat Tick Cadence Restored
The combat plugin SHALL run player maintenance (buff cleanup, shield expiry/drain, ammo regen, combo-effect expiry) via `ctx.every(10)` for all alive players.

#### Scenario: Buffs expire in production cadence
- GIVEN an alive player with an expired buff and the combat plugin mounted
- WHEN 10 ticks elapse
- THEN the buff is removed without any GameEngine involvement
