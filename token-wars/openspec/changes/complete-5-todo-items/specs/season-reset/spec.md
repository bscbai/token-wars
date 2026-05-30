# Spec: Season Reset

## ADDED Requirements

### Requirement: Season Rollover Detection
The system SHALL track the current season and detect when a new season begins (every 4 weeks).

#### Scenario: New season detected on tick
- GIVEN the current time exceeds `seasonStartTime + 4 weeks`
- WHEN GameEngine tick checks season status
- THEN the season number increments
- AND all online players have season reset applied

#### Scenario: Season data persists
- GIVEN a server with season 3 active
- WHEN the server restarts
- THEN season data (number, start time) is loaded from `season.json`

### Requirement: Level Soft Reset
On season reset, player levels SHALL be reduced to 70% of current value (minimum 1).

#### Scenario: Level 20 player reset
- GIVEN a level 20 player
- WHEN season reset applies
- THEN level becomes 14 (floor of 20 * 0.7)
- AND XP resets to 0

#### Scenario: Level 1 player reset
- GIVEN a level 1 player
- WHEN season reset applies
- THEN level remains 1 (max(1, floor(1*0.7)))

### Requirement: Rating Soft Reset
On season reset, PvP ratings SHALL be averaged with baseline (1000).

#### Scenario: High rating player reset
- GIVEN a player with pvpRating 1400
- WHEN season reset applies
- THEN rating becomes 1200 (floor of (1400+1000)/2)

#### Scenario: Low rating player reset
- GIVEN a player with pvpRating 600
- WHEN season reset applies
- THEN rating becomes 800 (floor of (600+1000)/2)

### Requirement: Equipment Preservation
On season reset, equipped tokens and inventory SHALL be preserved.

#### Scenario: Equipment survives reset
- GIVEN a player with equipped legendary token and 50 stable tokens
- WHEN season reset applies
- THEN equipped token remains unchanged
- AND stable token count remains 50
