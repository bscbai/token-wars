# AGENTS.md — Token Wars (token-wars)

Cyberpunk multiplayer game. Repo root holds a single app under `token-wars/` — run all commands from there.

Quickstart: `cd token-wars && npm install && npm start` → http://localhost:3000

## Commands

| Command | What it does |
|---------|---------------|
| `npm start` | Run game server (`node server/index.js`, port 3000) |
| `npm run dev` | Same with `node --watch` (auto-restart on file change) |
| `npm run electron` | Desktop app: starts server in-process + opens Electron window to `localhost:3000` |
| `npm run electron:dev` | Electron with `NODE_ENV=development` + DevTools |
| `npm run build` | Package desktop app for current platform → `dist/` (electron-packager) |
| `npm run build:win` / `:mac` / `:linux` / `:all` | Cross-platform builds → `dist/` |

No test/lint/typecheck scripts. No build step for the web client (Phaser served as static files).

## Two runtimes

- **Web**: `npm start` runs Express+Socket.IO; client is static `client/` served by Express.
- **Desktop (Electron)**: `electron/main.js` `require()`s `server/index.js` in-process (server binds 3000), then loads `http://localhost:3000` in a BrowserWindow. Desktop port is hardcoded (`GAME_PORT = 3000`), **not** read from `PORT` env.

## Project structure

```
token-wars/
├── server/
│   ├── index.js          # Express + Socket.IO entry (PORT env or 3000)
│   ├── game/             # GameEngine, CombatSystem, PvEManager, PvPManager,
│   │                     #   MiningManager, WorldBossManager, AIArenaManager
│   ├── models/           # Player, Monster, Arena, Dungeon (DUNGEON_TEMPLATES)
│   ├── data/             # Store.js (persistence), maps/ (map JSON), players.json (runtime)
│   └── routes/           # auth, player, shop (REST)
├── client/               # Phaser.js static frontend (src/: scenes, entities, systems, ui)
├── shared/               # constants.js (canonical), protocol.js (re-export shim)
├── electron/main.js      # Desktop entry
├── scripts/              # build-electron, capture-screenshots, export-steam-assets
├── openspec/             # Spec-driven change proposals (committed)
├── docs/                 # game-design.md, publishing-guide.md
├── Dockerfile, fly.toml  # Server-only deployment
└── DEPLOY.md             # Deploy targets (Fly.io, Railway, Render, Alibaba, Docker)
```

## Architecture

- **Server-authoritative**: all combat, cooldowns, token consumption, movement validation computed server-side; client does input prediction only.
- **Real-time**: Socket.IO. Event names in `EVENTS`, REST endpoints in `REST`.
- **Persistence**: in-memory + JSON auto-save every 60s (`Store.startAutoSave(60000)`); graceful shutdown flushes on SIGINT/SIGTERM.
- **Tick loop**: `GameEngine` runs at 20Hz (`TICK_MS`). Mining ticks each 1s, World Boss & AI Arena each 5s; PvE/PvP run their own loops.

## Protocol gotcha

`shared/constants.js` is the **canonical** source for `EVENTS` and `REST` (defined there and exported). `shared/protocol.js` is a backward-compat shim that re-exports them. **Edit events in `constants.js`, not `protocol.js`.**

## Auth flow

1. REST `POST /api/auth/register|login` → `{ sessionToken, player }`
2. Socket.IO `auth:login` with `{ token }` → server calls `verifySession()`
3. Sessions are in-memory (`server/routes/auth.js`, `sessions` Map) — **not persisted**, all sessions lost on restart.

## Key files

- `server/index.js:18` — `PORT = process.env.PORT || 3000`
- `shared/constants.js` — game balance + protocol: damage formula, XP table, skills, shop packs, mining rates, PvP, `EVENTS`/`REST`
- `server/game/CombatSystem.js` — damage calc, skill validation, cooldowns
- `server/game/GameEngine.js` — 20Hz tick loop
- `server/game/AIArenaManager.js` — AI agent arena (deploy/train/tournaments/seasons/leaderboards; `ai_arena:*` events)
- `server/models/Dungeon.js` — `DUNGEON_TEMPLATES` (dungeon wave configs live here, **not** in data files)
- `server/data/Store.js` — player persistence + auto-save
- `server/routes/auth.js:10` — in-memory `sessions` Map

## Game mechanics (verified numbers)

- Map 30×30 tiles, tile=32px. Movement validated to `[0, 29]` with wall collision.
- Player spawns at `(0, 0)` on login and respawn (`Player.js`).
- Movement: 1 tile per input, server-throttled to 80ms (~12 moves/sec) via `MOVE_MIN_INTERVAL_MS` — separate from the 20Hz tick.
- Death drops 30–50% of stable (equipment) tokens; unstable (ammo) tokens never drop.
- Shield drains 1 unstable token/sec while active.
- Offline mining recalculated on reconnect, capped at 8h (`MINING.OFFLINE_CAP_HOURS`).
- PvP rating starts 1000, ±25 per match; win-streak daily reward cap 3.
- Skill targeting: server resolves target entities from the player's active dungeon (`pveManager.playerDungeons`) or arena (`pvpManager.playerArenas`) — clients never pass entities.

## Server-side limits (anti-cheat)

- Socket.IO rate limit: 200 events / 60s per socket (`RATE_LIMIT_MAX`), enforced in `index.js` middleware; over-limit triggers `auth:fail` or silent drops.
- Movement throttle + wall collision enforced server-side regardless of client input.

## Data & gitignore

- `server/data/players.json` and `server/data/*.json` are runtime-generated and gitignored (do not commit).
- `server/data/maps/` (e.g. `solo_dungeon.json`) is committed.
- `token-wars/.gitignore` also ignores `node_modules/`, `dist/`, `.claude/`, `.workbuddy/`, `out/token-wars游戏设计/`.
- Credentials stored as bcrypt hashes (`bcryptjs`) in players.json.

## Deployment

- **Docker**: `node:22-alpine`, `npm ci --omit=dev`, copies only `server/ shared/ client/` (no electron). `CMD node server/index.js`, `ENV PORT=3000`.
- **Fly.io**: `fly.toml` — app `token-wars`, region `nrt` (Tokyo), 512mb. `fly deploy`.
- Server-only: the Electron build is desktop-only and not part of the deployed image. See `DEPLOY.md` for Railway/Render/Alibaba/pm2.

## OpenSpec workflow

Non-trivial changes are spec-driven via OpenSpec. Proposals live in `openspec/changes/<name>/` (`proposal.md`, `design.md`, `tasks.md`, `specs/`, `.openspec.yaml`); completed ones move to `openspec/changes/archive/`. `openspec/` is committed; the `.claude/` skills/commands that drive it are gitignored (local tooling).
