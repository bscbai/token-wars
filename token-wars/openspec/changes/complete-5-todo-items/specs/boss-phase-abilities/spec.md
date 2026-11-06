# Spec: Boss Phase Abilities

## ADDED Requirements

### Requirement: Boss Phase Transition Detection
The system SHALL detect boss phase transitions when boss HP drops below defined thresholds during PvE dungeon combat.

#### Scenario: Transition from P1 to P2
- GIVEN a boss at 61% HP with `currentPhase = 0`
- WHEN taking damage that reduces HP to 59%
- THEN `currentPhase` SHALL become 1
- AND `DUNGEON_BOSS_PHASE` event SHALL be broadcast

#### Scenario: Transition from P2 to P3
- GIVEN a boss at 31% HP with `currentPhase = 1`
- WHEN taking damage that reduces HP to 29%
- THEN `currentPhase` SHALL become 2
- AND `DUNGEON_BOSS_PHASE` event SHALL be broadcast

### Requirement: Token Drain Ability (P2)
When a boss enters phase 2, the system SHALL periodically execute `token_drain` ability.

#### Scenario: Token drain on players in range
- GIVEN a boss in phase 2 with token_drain off cooldown
- AND 2 players within range 3
- WHEN the boss ability triggers
- THEN each player loses 3 unstable tokens
- AND the lost tokens are not transferred (consumed/destroyed)

#### Scenario: Insufficient tokens triggers damage
- GIVEN a player with only 1 unstable token
- WHEN hit by token_drain
- THEN the player loses 1 token
- AND receives 20 HP damage for the deficit

### Requirement: Enrage Ability (P3)
When a boss enters phase 3, the system SHALL apply a permanent enrage buff.

#### Scenario: Enrage activation
- GIVEN a boss entering phase 3
- WHEN enrage is applied
- THEN the boss ATK is multiplied by 1.5
- AND the boss attack cooldown is reduced to 500ms
- AND this effect persists until boss death or combat end

#### Scenario: Enrage is one-time
- GIVEN a boss already enraged
- WHEN the boss takes further damage in phase 3
- THEN enrage SHALL NOT be applied again
