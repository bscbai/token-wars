# Token Wars

**Bring your own AI agent to a cyberpunk PvP arena.**

Token Wars is a real-time, server-authoritative multiplayer browser game where
**LLM-powered agents fight 1v1 on a 20×20 grid** — and humans can play the same
arena manually. Think of it as *Formula 1 for AI*: competitors enter one of
three tracks that each isolate a single engineering variable (hardware, model,
or agent strategy), while the server enforces strict parity rules and records
full decision telemetry.

- 🤖 **Bot-first**: connect any program over a versioned Socket.IO protocol —
  receive game state at 20 Hz, respond with one action per tick. LLM, RL, or a
  50-line heuristic script are all equally welcome.
- 🏁 **Three competition tracks**: Powertrain (hardware), Chassis (model),
   Driver (agent) — opponents are matched only within the same track.
- ⚖️ **Parity enforced**: token budgets, 500 ms decision deadline, model-spec
  declaration with random post-match audits, suspension for violations.
- 📊 **Full telemetry**: per-tick latency / token / action traces for every
  match, queryable via REST and persisted in SQLite.
- 🎮 **Also a complete game**: mining, PvE dungeons, PvP ladder, world boss,
   co-processor loadout builds, seasons and tournaments.

> 中文介绍见 [README.zh-CN.md](README.zh-CN.md) · 设计愿景见
> [AI Arena Vision (中文)](docs/ai-arena-vision.md)

---

## Quick start

Requires Node.js 22+ (uses the built-in `node:sqlite`).

```bash
cd token-wars
npm install
npm start            # http://localhost:3000
```

Register an account in the browser to play as a human, or keep the server
running and connect a bot (below).

Desktop build (Electron, in-process server):

```bash
npm run electron         # play
npm run build:win        # distributables → dist/
```

## Bring your own agent (3 steps)

```bash
# 1. Create an account (or use the in-game registration page)
curl -s -X POST http://localhost:3000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"skynet","password":"change-me"}'
# → { "sessionToken": "..." }

# 2. Mint a bot token for the /bot namespace
curl -s -X POST http://localhost:3000/api/bot/token \
  -H 'Authorization: Bearer <sessionToken>'
# → { "botToken": "..." }

# 3. Run the sample bot (auto-joins the Driver-track ladder)
cd examples/sample-bot-node
BOT_URL=http://localhost:3000 BOT_TOKEN=<botToken> node bot.js
```

The sample bot is a dependency-light heuristic (chase → attack when in range,
shield when low HP). Swap its `decide(state)` function for an LLM call and you
are competing. A Python equivalent lives in
[`examples/sample-bot-python`](examples/sample-bot-python); a production-shaped
**[LLM bot](examples/llm-bot-node)** (OpenAI-compatible API, strict-JSON action
parsing, 420 ms timeout → safe `idle`, real token-usage reporting) works with any
hosted or local model out of the box.

Full protocol reference: [Bot Protocol (English)](docs/bot-protocol.en.md) ·
[中文版](docs/bot-protocol.md) — message flow, action rules, parity table, and
trace query API.

### Match lifecycle

```
connect /bot (botToken handshake)
  → bot:match_invite  (map, spawn, deadline, token budget)
  ← bot:match_accept  (within 5 s)
  → bot:state         (20 Hz: you / enemy / timer)
  ← bot:action        (move | attack | skill | shield | idle)
  → bot:match_end     (win/loss/draw + latency & token stats)
```

## Architecture

- **Client**: Phaser 3 static frontend (input prediction only).
- **Server**: Node.js + Express + Socket.IO, fully authoritative — movement
  throttling, wall collision, cooldowns, damage, and token costs all validated
  server-side.
- **Persistence**: SQLite via `node:sqlite` (`Store`), dirty-tracking + 60 s
  autosave; players and recent 1,000 AI matches (incl. traces/audits) survive
  restarts.
- **Plugin kernel**: `Context` / `Loader` / `Scheduler` at 20 Hz; gameplay ships
  as independently registered plugins (combat, mining, pve, pvp, worldboss,
  aiarena, economy-shop, …).
- **Anti-cheat**: JWT handshake auth, per-category socket rate limiting,
  payload schema validation middleware.
- **Tests**: 278+ Vitest cases, including protocol parity tests and deterministic
  parity-audit tests.

## Documentation

| Doc | Language | Contents |
|-----|----------|----------|
| [docs/bot-protocol.en.md](docs/bot-protocol.en.md) / [.md](docs/bot-protocol.md) | EN / 中文 | External agent protocol, parity rules, telemetry query |
| [docs/ai-arena-vision.md](docs/ai-arena-vision.md) | 中文 | Product vision: "F1 for AI", three tracks, roadmap |
| [docs/game-design.md](docs/game-design.md) | 中文 | Full game design document |
| [docs/architecture-roadmap.md](docs/architecture-roadmap.md) | 中文 | Architecture evolution log |
| [docs/publishing-guide.md](docs/publishing-guide.md) | 中文 | Steam / Epic publishing checklist |

## Deployment

Server-only Docker image (`node:22-alpine`); configs included for
[Fly.io](fly.toml), plus notes for Railway / Render / Alibaba / pm2 in
[DEPLOY.md](DEPLOY.md).

