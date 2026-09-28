# Spec: Coprocessor System

## ADDED Requirements

### Requirement: Coprocessor Codex of Sixteen Definitions
The shared constants SHALL define exactly 16 coprocessors — 4 each in the attack, defense, mobility, and economy categories — each with a unique id and per-star (★/★★/★★★) stat blocks containing at least `cooldown` and `tokenCost`.

#### Scenario: Codex completeness
- GIVEN the `COPROCESSORS` constant
- WHEN its entries are inspected
- THEN there are exactly 16 entries with 4 per category and no duplicate ids
- AND every entry has a `stars` array of length 3 where each star block defines `cooldown` and `tokenCost`

#### Scenario: Legacy entries preserved by key
- GIVEN the legacy constants `LIGHTNING_SURGE`, `SHIELD_OVERLOAD`, `STEALTH_FIELD`, `TOKEN_MAGNET`
- WHEN their values are read
- THEN their ids remain `lightning_surge`, `shield_overload`, `stealth_field`, `token_magnet` and their values follow the new `stars` shape

### Requirement: Coprocessor Collection and Star Upgrades
A player SHALL own coprocessors at a star level of 1–3. Upgrading SHALL consume 3 same-type fragments for ★→★★ and 8 for ★★→★★★, and SHALL be rejected when fragments are insufficient or the coprocessor is already at ★★★.

#### Scenario: Successful ★→★★ upgrade
- GIVEN a player owning `lightning_surge` at ★ with 3 `lightning_surge` fragments
- WHEN `upgradeCoprocessor('lightning_surge')` is called
- THEN the coprocessor's star becomes 2, the fragment balance drops to 0, and the result is `{ ok: true, star: 2 }`

#### Scenario: Insufficient fragments rejected
- GIVEN a player owning `lightning_surge` at ★ with 2 fragments
- WHEN `upgradeCoprocessor('lightning_surge')` is called
- THEN the result is `{ ok: false, reason: 'insufficient_fragments' }` and nothing is consumed

#### Scenario: Max star rejected
- GIVEN a player owning a coprocessor at ★★★
- WHEN `upgradeCoprocessor` is called for it
- THEN the result is `{ ok: false, reason: 'max_star' }`

#### Scenario: Unknown or unowned coprocessor rejected
- GIVEN a player who does not own `burn_mark`
- WHEN `canUpgradeCoprocessor('burn_mark')` is called
- THEN the result reports `ok: false` with reason `not_owned`

### Requirement: Coprocessor Grant and Duplicate Conversion
Granting a coprocessor a player does not own SHALL add it at ★. Granting one already owned SHALL convert to a fixed fragment compensation instead of stacking duplicates.

#### Scenario: First grant
- GIVEN a player owning no coprocessors
- WHEN `addCoprocessor('lightning_surge')` is called
- THEN the player owns `lightning_surge` at star 1 with status `granted`

#### Scenario: Duplicate grant converts to fragments
- GIVEN a player owning `lightning_surge` with 0 `lightning_surge` fragments
- WHEN `addCoprocessor('lightning_surge')` is called again
- THEN no duplicate entry is added, the fragment balance becomes 3 (`COPROCESSOR_SHOP.DUPLICATE_FRAGMENTS`), and the status is `duplicate`

### Requirement: Active Coprocessor Loading
A player SHALL have at most one active coprocessor. Loading SHALL accept only owned ids or null (unload), and SHALL persist across sessions.

#### Scenario: Load owned coprocessor
- GIVEN a player owning `shield_overload`
- WHEN `setActiveCoprocessor('shield_overload')` is called
- THEN `activeCoprocessor` becomes `shield_overload` and the result is `{ ok: true }`

#### Scenario: Load unowned coprocessor rejected
- GIVEN a player not owning `burn_mark`
- WHEN `setActiveCoprocessor('burn_mark')` is called
- THEN the result is `{ ok: false }` and `activeCoprocessor` is unchanged

#### Scenario: Unload
- GIVEN a player with `activeCoprocessor = 'shield_overload'`
- WHEN `setActiveCoprocessor(null)` is called
- THEN `activeCoprocessor` becomes null

### Requirement: Fragment Drops from Sources
Fragments SHALL drop from configured sources at server-rolled rates: solo dungeon clear 15%, team dungeon clear (2+ players) 30%, and the PvP 3-win-streak chest 10%. Each successful drop grants exactly 1 fragment of a uniformly random coprocessor and SHALL notify the player's socket with `COPROCESSOR_FRAGMENT`.

#### Scenario: Solo dungeon clear drops a fragment
- GIVEN a player clearing a 1-player dungeon with the roll below the 15% rate
- WHEN `completeDungeon` settles rewards
- THEN the player gains 1 fragment of a random coprocessor id and receives `COPROCESSOR_FRAGMENT { coprocessorId, count: 1, total, source: 'SOLO_BOSS' }`

#### Scenario: Team dungeon clear uses the higher rate
- GIVEN 2+ players clearing a dungeon together with the roll below 30% but at or above 15%
- WHEN `completeDungeon` settles rewards
- THEN each participating player gains 1 fragment (team rate applies)

#### Scenario: PvP streak chest drops a fragment
- GIVEN a player on a 3-win streak receiving the streak chest with the roll below 10%
- WHEN `endMatch` settles the match
- THEN the player gains 1 random fragment in addition to the streak unstable tokens

#### Scenario: Failed roll grants nothing
- GIVEN any source with the roll at or above the configured rate
- WHEN the drop is rolled
- THEN no fragment is granted and no event is emitted

### Requirement: Shop Packs Grant Coprocessors
Purchasing a pack whose contents include a coprocessor SHALL grant one random coprocessor the player does not yet own; when the player owns all 16, the grant SHALL convert to the duplicate fragment compensation.

#### Scenario: Premium pack grants an unowned coprocessor
- GIVEN a player who owns fewer than 16 coprocessors and can afford the premium pack
- WHEN the pack is purchased
- THEN `coprocessors` gains one unowned entry at ★ and the response's `received.coprocessor` reports `{ id, status: 'granted' }`

#### Scenario: Full codex converts to fragments
- GIVEN a player owning all 16 coprocessors
- WHEN a coprocessor pack is purchased
- THEN no new entry is added and the duplicate fragment compensation is granted instead

### Requirement: Coprocessor Persistence and Old-Save Compatibility
Coprocessor collection state (`coprocessors`, `fragments`, `activeCoprocessor`) SHALL survive save/load cycles, and old saves without these fields SHALL load as an empty collection.

#### Scenario: Round-trip persistence
- GIVEN a player owning an upgraded coprocessor with fragments and an active load
- WHEN the player is saved via `toSave` and restored via `fromSave`
- THEN all three fields are restored identically

#### Scenario: Old save defaults to empty
- GIVEN a saved player record predating the coprocessor system (no coprocessor fields)
- WHEN it is loaded via `Player.fromSave`
- THEN `coprocessors` is `[]`, `fragments` is `{}`, and `activeCoprocessor` is null
