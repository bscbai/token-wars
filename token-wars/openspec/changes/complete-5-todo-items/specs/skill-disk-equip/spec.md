# Spec: Skill Disk Equipment Sync

## ADDED Requirements

### Requirement: Equip Token to Skill Disk
The system SHALL allow a player to equip a stable token from their inventory into an unlocked skill disk slot.

#### Scenario: Successful equip to empty slot
- GIVEN a player with a stable token in inventory and skill disk slot 0 empty
- WHEN the player sends `skill_disk:equip` with `{ tokenId, slotIndex: 0 }`
- THEN the token is removed from `stableTokens`
- AND the token is placed in `equippedTokens[0]`
- AND the server broadcasts `skill_disk:update` with updated `equippedTokens`

#### Scenario: Replace existing equipped token
- GIVEN a player with skill disk slot 0 already occupied by token A
- WHEN the player equips token B to slot 0
- THEN token B occupies slot 0
- AND token A returns to `stableTokens`

#### Scenario: Attempt to equip to locked slot
- GIVEN a level 1 player (gridSize: 2)
- WHEN attempting to equip to slot 4 (row 1, col 0 for 2x2 grid)
- THEN the request is rejected with error code `SLOT_LOCKED`

#### Scenario: Attempt to equip non-existent token
- GIVEN a player without token with id "fake-id" in inventory
- WHEN attempting to equip that token
- THEN the request is rejected with error code `TOKEN_NOT_FOUND`

### Requirement: ATK/DEF Auto-Recalculate
The system SHALL automatically recalculate player ATK and DEF via existing getter properties when equipped tokens change.

#### Scenario: ATK increases after equip
- GIVEN a player with base ATK 10 and no equipped tokens
- WHEN equipping a legendary (ATK+30) token
- THEN the player's ATK becomes 40
