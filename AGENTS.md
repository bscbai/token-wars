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
│   ├── game/             # CombatSystem, PvEManager, PvPManager, MiningManager,
│   │                     #   WorldBossManager, AIArenaManager, CoprocessorDrops
│   ├── core/             # Plugin kernel: Context, Loader, Scheduler (tick cadence)
│   ├── plugins/          # 10 plugins: persistence, identity, combat, world-player,
│   │                     #   mining, pve, pvp, worldboss, aiarena, economy-shop
│   ├── middleware/       # socketAuth (JWT handshake), eventGuard (rate limit + schema)
│   ├── models/           # Player, Monster, Arena, Dungeon (DUNGEON_TEMPLATES)
│   ├── data/             # Store.js (SQLite persistence), maps/ (map JSON), *.db (runtime)
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
- **Persistence**: SQLite (`server/data/tokenwars.db`, node:sqlite) via `Store`; dirty-tracking + auto-save every 60s (`Store.startAutoSave(60000)`); graceful shutdown flushes on SIGINT/SIGTERM.
- **Tick loop**: plugin kernel — `Scheduler` drives `ctx.every(n)` declarations at 20Hz (`TICK_MS`). Mining each 20 ticks, World Boss & AI Arena each 100 ticks, combat player-maintenance each 10 ticks; PvE/PvP loops scan each tick. (`server/game/GameEngine.js` was retired in M3.)

## Protocol gotcha

`shared/constants.js` is the **canonical** source for `EVENTS` and `REST` (defined there and exported). `shared/protocol.js` is a backward-compat shim that re-exports them. **Edit events in `constants.js`, not `protocol.js`.**

## Auth flow

1. REST `POST /api/auth/register|login` → JWT (`sessionToken`, signed with `JWT_SECRET`, default expiry 7d)
2. Socket.IO handshake auth: `socketAuth` middleware validates the JWT via `verifySession()` and attaches `socket.data.player` (legacy `auth:login` event path still supported by the identity plugin)
3. `JWT_SECRET` is **required in production** (boot throws otherwise); dev falls back to an insecure built-in secret.

## Key files

- `server/index.js:18` — `PORT = process.env.PORT || 3000`
- `shared/constants.js` — game balance + protocol: damage formula, XP table, skills, shop packs, mining rates, PvP, `EVENTS`/`REST`
- `server/core/Scheduler.js` — 20Hz tick cadence driver (replaced GameEngine in M3)
- `server/game/CombatSystem.js` — damage calc, skill validation, cooldowns, combos
- `server/game/AIArenaManager.js` — AI agent arena (deploy/train/tournaments/seasons/leaderboards; `ai_arena:*` events)
- `server/models/Dungeon.js` — `DUNGEON_TEMPLATES` (dungeon wave configs live here, **not** in data files)
- `server/data/Store.js` — SQLite player persistence + auto-save
- `server/middleware/socketAuth.js` — JWT handshake authentication

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

- `server/data/players.json` (legacy) and `server/data/*.json` / `*.db*` are runtime-generated and gitignored (do not commit).
- `server/data/maps/` (e.g. `solo_dungeon.json`) is committed.
- `token-wars/.gitignore` also ignores `node_modules/`, `dist/`, `.env`, `.claude/`, `.workbuddy/`, `out/token-wars游戏设计/`.
- Credentials stored as bcrypt hashes (`bcryptjs`) inside the SQLite player rows.

## Deployment

- **Docker**: `node:22-alpine`, `npm ci --omit=dev`, copies only `server/ shared/ client/` (no electron). `CMD node server/index.js`, `ENV PORT=3000`.
- **Fly.io**: `fly.toml` — app `token-wars`, region `nrt` (Tokyo), 512mb. `fly deploy`.
- Server-only: the Electron build is desktop-only and not part of the deployed image. See `DEPLOY.md` for Railway/Render/Alibaba/pm2.

## OpenSpec workflow

Non-trivial changes are spec-driven via OpenSpec. Proposals live in `openspec/changes/<name>/` (`proposal.md`, `design.md`, `tasks.md`, `specs/`, `.openspec.yaml`); completed ones move to `openspec/changes/archive/`. `openspec/` is committed; the `.claude/` skills/commands that drive it are gitignored (local tooling).
