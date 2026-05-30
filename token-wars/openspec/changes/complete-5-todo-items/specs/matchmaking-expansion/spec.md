# Spec: Matchmaking Rating Expansion

## ADDED Requirements

### Requirement: Queue Entry Time Tracking
The system SHALL track the time each player enters the matchmaking queue.

#### Scenario: Player joins queue
- GIVEN a player sends `pvp:queue` for mode '1v1'
- WHEN the queue entry is created
- THEN `joinTime` is set to the current timestamp

### Requirement: Expanded Matching After Timeout
When the earliest queued player has waited more than 120 seconds, the system SHALL expand the acceptable rating range from ±200 to ±500.

#### Scenario: Normal match within 2 minutes
- GIVEN 6 players queued for 3v3 with ratings all within ±100
- WHEN matchmaking runs (within 2 minutes)
- THEN the match is formed normally by sorted rating

#### Scenario: Expanded match after 2 minute wait
- GIVEN 6 players queued for 3v3
- AND the earliest player has waited > 120 seconds
- AND some players have ratings up to ±400 from the first player
- WHEN matchmaking runs
- THEN players within ±500 rating of the first player are matched

#### Scenario: Still insufficient after expansion
- GIVEN only 3 players queued for 3v3 (need 6)
- AND the earliest player has waited > 120 seconds
- WHEN matchmaking runs with expanded range
- THEN no match is formed (not enough players even with expansion)
- AND players continue waiting
