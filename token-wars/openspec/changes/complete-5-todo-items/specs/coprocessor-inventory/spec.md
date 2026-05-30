# Spec: Coprocessor Token Inventory

## ADDED Requirements

### Requirement: Receive Coprocessor on Purchase
When a shop pack with `coprocessor: true` is purchased, the system SHALL add a coprocessor token to the player's inventory.

#### Scenario: First coprocessor purchase
- GIVEN a player with no coprocessor tokens
- WHEN purchasing a Premium pack (`coprocessor: true`)
- THEN a random coprocessor (from `COPROCESSORS`) is added to `coprocessorTokens`
- AND the purchase response includes `received.coprocessor` with the coprocessor id

#### Scenario: Duplicate avoidance
- GIVEN a player who already owns `lightning_surge`
- WHEN purchasing another coprocessor pack
- THEN the system SHALL NOT add `lightning_surge` again
- AND the system SHALL pick a different coprocessor if available (max 3 retries)

#### Scenario: All coprocessors owned
- GIVEN a player who owns all 4 coprocessor types
- WHEN purchasing another coprocessor pack
- THEN the system SHALL award a random coprocessor anyway (no blocking)
- AND log a warning about duplicate

### Requirement: Persist Coprocessor Data
The system SHALL persist coprocessor tokens data across server restarts.

#### Scenario: Coprocessors survive restart
- GIVEN a player saving with `coprocessorTokens: ['lightning_surge']`
- WHEN the server restarts and loads player data
- THEN `player.coprocessorTokens` contains `['lightning_surge']`
