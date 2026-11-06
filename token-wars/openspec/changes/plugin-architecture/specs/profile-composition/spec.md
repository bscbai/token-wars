# Spec: Profile Composition

## ADDED Requirements

### Requirement: Profile Declaration
A profile SHALL be a pure-data module supporting `extends`, `disable`, and `overrides` over a base plugin list.

#### Scenario: Embedded profile trims heavy systems
- GIVEN `embedded.js` declares `extends: './full'` and `disable: ['worldboss', 'aiarena']`
- WHEN the server boots with `--profile embedded`
- THEN worldboss and aiarena plugins are not mounted
- AND all other plugins from `full` are mounted

#### Scenario: Overrides merge into plugin config
- GIVEN `embedded.js` declares `overrides: { mining: { offlineCapHours: 2 } }` and the mining plugin's base cfg has `offlineCapHours: 8`
- WHEN the profile is resolved
- THEN the mining plugin receives `offlineCapHours: 2` in setup

#### Scenario: Disable of a dependency fails fast
- GIVEN a profile disables `combat` while `pve` (which `dependsOn: ['combat']`) remains enabled
- WHEN the Loader resolves the profile
- THEN startup aborts with a missing-dependency error naming `pve` → `combat`

### Requirement: Layered Composition Order
Configuration SHALL apply in fixed order: base profile → derived profile (`extends` chain) → environment overlay → CLI arguments, with later layers winning.

#### Scenario: Environment overlay disables a plugin
- GIVEN the `full` profile mounts `worldboss`
- WHEN the server boots with `TOKEN_WARS_DISABLE=worldboss`
- THEN worldboss is not mounted

### Requirement: Composition Tree Dump
The server SHALL support `--dump-config` printing the final plugin tree (names, config) at boot without starting the game loop.

#### Scenario: Dump reflects trimming and overrides
- GIVEN the server is started with `--profile embedded --dump-config`
- THEN stdout lists all mounted plugins with their effective configs
- AND `worldboss`/`aiarena` do not appear
- AND mining shows `offlineCapHours: 2`

### Requirement: Full Profile Equals Current Behavior
The default `full` profile SHALL mount every current system with behavior identical to pre-migration startup.

#### Scenario: Full profile is the default
- WHEN the server starts without `--profile`
- THEN the `full` profile is used and all 11 plugin modules are mounted in dependency order

#### Scenario: Client protocol unchanged
- GIVEN a client speaking the current `shared/constants.js` EVENTS/REST
- WHEN the server boots via the `full` profile
- THEN all protocol events behave identically to pre-migration startup
