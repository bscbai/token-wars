# Spec: PvP Shrink Zone

## ADDED Requirements

### Requirement: Shrink Zone Activation
After 90 seconds of PvP arena combat, the system SHALL begin shrinking the playable area via hazard tiles encroaching from edges.

#### Scenario: Initial shrink activation
- GIVEN a PvP arena round active for 90 seconds
- WHEN the shrink timer fires
- THEN edge tiles become TILE.HAZARD
- AND a `pvp:shrink_update` event is broadcast with hazard tile positions

#### Scenario: Linear shrink over 30 seconds
- GIVEN shrink has started at 90s mark
- WHEN 105 seconds have elapsed (midpoint of 30s shrink window)
- THEN approximately 50% of the map area is hazard tiles
- AND the hazard boundary is a circle around map center

#### Scenario: Full shrink at 120s
- GIVEN shrink has been progressing for 30 seconds
- WHEN 120 seconds have elapsed
- THEN all tiles except possibly the center are hazard tiles
- AND the Data Core spawns at center (existing behavior)

### Requirement: Hazard Tile Damage
Players standing on hazard tiles SHALL receive damage over time.

#### Scenario: Player on hazard tile
- GIVEN a player standing on a TILE.HAZARD tile
- WHEN each arena tick fires (50ms)
- THEN the player receives 5 HP damage

#### Scenario: Player leaves hazard
- GIVEN a player on a hazard tile
- WHEN the player moves to a non-hazard tile
- THEN damage stops immediately

### Requirement: Data Core Victory Condition
The system SHALL allow teams to attack and destroy the Data Core as an alternative victory condition.

#### Scenario: Attacking the Data Core
- GIVEN a Data Core with 500 HP at map center
- WHEN a player attacks adjacent to the core
- THEN damage is applied to the core's HP

#### Scenario: Core destruction wins match
- GIVEN team A attacking the core
- WHEN core HP reaches 0
- THEN team A wins the match immediately
