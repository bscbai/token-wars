# Spec: Plugin Runtime

## ADDED Requirements

### Requirement: Plugin Contract
Every game system SHALL be packaged as a plugin exposing `name`, `dependsOn`, `provides`, and `setup(ctx, cfg)` returning an optional dispose function.

#### Scenario: Plugin mounted in dependency order
- GIVEN a profile listing `pve` with `dependsOn: ['combat', 'persistence']`
- WHEN the Loader mounts the profile
- THEN `combat` and `persistence` setup run before `pve` setup

#### Scenario: Missing dependency fails fast
- GIVEN a profile listing a plugin whose `dependsOn` includes an unmounted plugin name
- WHEN the Loader mounts the profile
- THEN startup aborts with an error naming the missing dependency
- AND already-mounted plugins are unloaded in reverse order

### Requirement: Reversible Effects (INV2)
All registrations (`ctx.on`, `ctx.socket`, `ctx.every`, `ctx.service`) SHALL return disposers and SHALL be unwound when the owning plugin unloads.

#### Scenario: Unloaded plugin stops receiving events
- GIVEN the `pve` plugin subscribed to `player:join` via `ctx.on`
- WHEN the plugin is unloaded
- THEN a subsequent `player:join` emit does NOT invoke the pve handler

#### Scenario: Unloaded socket handler stops firing
- GIVEN the `pve` plugin registered `ctx.socket(EVENTS.PVE_ENTER, ...)`
- WHEN the plugin is unloaded and a client sends `PVE_ENTER`
- THEN no pve handler runs and no error is thrown

### Requirement: Unique Service Seam
`ctx.service(name, impl)` SHALL reject duplicate registration of the same service name.

#### Scenario: Duplicate combat service rejected
- GIVEN `ctx.service('combat', implA)` already registered
- WHEN another plugin calls `ctx.service('combat', implB)`
- THEN startup fails with a duplicate-service error

### Requirement: Declarative Tick Scheduling
Plugins SHALL declare their cadence via `ctx.every(interval, fn)`; the Scheduler SHALL invoke them without hardcoded per-manager branches.

#### Scenario: Mining tick cadence preserved
- GIVEN the current behavior is `GameEngine` calling `mining.tick` every 1000ms at 20Hz ticks
- WHEN mining migrates to `ctx.every('1s', fn)`
- THEN mining.tick fires at the same effective cadence

### Requirement: Waterfall Event for Combat Context
Skill input routing SHALL resolve the combat context via the `combat:resolve-context` waterfall, where each combat-holding plugin claims (short-circuits) or delegates via `next()`.

#### Scenario: Dungeon player skill routed to dungeon entities
- GIVEN a player inside an active dungeon
- WHEN the player sends `INPUT_SKILL`
- THEN the pve waterfall listener resolves dungeon entities and combat executes with them

#### Scenario: Lobby player skill ignored
- GIVEN a player in neither dungeon nor arena
- WHEN the player sends `INPUT_SKILL`
- THEN all waterfall listeners delegate via `next()` and no combat executes

#### Scenario: New combat surface added without touching existing plugins
- GIVEN pve and pvp waterfall listeners exist
- WHEN a new plugin registers an additional `combat:resolve-context` listener
- THEN no existing plugin file is modified
