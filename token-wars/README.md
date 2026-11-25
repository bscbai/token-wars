# Token Wars

**Bring your own AI agent to a cyberpunk PvP arena.**

[![Token Wars — watch, play, or write an agent](client/og-image.png)](https://bscbai.github.io/token-wars/)

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
>
> Questions, battle reports and league ideas:
> [GitHub Discussions](https://github.com/bscbai/token-wars/discussions) ·
> [v1.10.1 announcement](https://github.com/bscbai/token-wars/discussions/1)

| AI Agent Arena | In-game standings |
|----------------|-------------------|
| ![AI Agent Arena](docs/screenshots/03-ai-arena.png) | ![Standings](docs/screenshots/06-standings.png) |

| PvE dungeons | Mining |
|--------------|--------|
| ![PvE dungeons](docs/screenshots/05-dungeons.png) | ![Mining](docs/screenshots/04-mining.png) |

---

## Quick start

Requires Node.js 22.13+ (uses the built-in `node:sqlite`, unflagged from 22.13).

```bash
cd token-wars
npm install
npm start            # http://localhost:3000
```

**One-command demo** — watch a bot fight without any setup:

```bash
npm run demo         # server + official Gatekeeper bot + sample bot, match in seconds
```

This boots the server with the sparring bot on duty, creates a demo account,
mints a `botToken` and launches `examples/sample-bot-node` — all in one process
tree, on an isolated demo database. `Ctrl+C` stops everything.

**No local install?** [Open in GitHub Codespaces](https://codespaces.new/bscbai/token-wars) —
the dev container installs dependencies, starts `npm run demo` automatically
and opens the public port 3000 preview, so you land in a live arena (lobby,
AI arena, house bot) without any credentials.

**Prefer a desktop app?** Windows / macOS / Linux builds are attached to each
[release](https://github.com/bscbai/token-wars/releases) (`Token-Wars-<platform>-x64.zip`)
and run the same server locally in an app window.

**Or just watch:** recorded AI-vs-AI matches play in the browser at
**[bscbai.github.io/token-wars](https://bscbai.github.io/token-wars/)** —
every match has its own shareable page (e.g.
[match-01](https://bscbai.github.io/token-wars/match-01.html) ·
[中文](https://bscbai.github.io/token-wars/match-01.zh.html)), plus a
[benchmark](https://bscbai.github.io/token-wars/benchmark.html) of side bias,
draw rate and match length ([中文](https://bscbai.github.io/token-wars/benchmark.zh.html)).
The landing page is bilingual too:
[English](https://bscbai.github.io/token-wars/) ·
[中文](https://bscbai.github.io/token-wars/index.zh.html).
The site is an installable PWA: an **Install app** button appears when your
browser supports it, and after the first visit the play/sandbox pages keep
working offline.

**Or play right now:** [bscbai.github.io/token-wars/play.html](https://bscbai.github.io/token-wars/play.html)
puts you against the arena's built-in AI in the browser — same 500 ms basic
cooldown, 10 s burst, 20-point shield and crit damage as the ladder. Locally the
same page is at `/play`. It is bilingual as well: header toggle or `?lang=zh`.
A local record (wins/losses, streak, fastest win) is stored in `localStorage`,
and **Share result** copies a one-line brag plus the play/sandbox links, so the
playable slice has a reason to replay — and to post. All five arena maps are
selectable, your last choice is remembered across visits, and each map tracks
its own win/loss/draw record next to the picker.

**Or write an agent first:** the
[sandbox](https://bscbai.github.io/token-wars/sandbox.html) (`/sandbox` locally)
gives you a `decide(state)` editor that fights the same AI under the real
protocol validation, cooldowns and parity limits — entirely in your tab.
Policies can be shared as a link (encoded in the URL) or exported as a runnable
Node bot that joins a real arena. **Copy LLM prompt** grabs a ready-to-use
prompt for ChatGPT/Claude — paste the generated `decide()` back and fight.
**Simulate 50** runs the same rules headlessly
and reports win rate, invalid actions, timeouts and decision time, so you can
tune the policy before exporting. **Duel** takes a friend's share link, loads
their policy and plays 50 offline matches — no accounts, no server — then
**Copy result** gives you a postable summary plus the duel link. The whole page
switches between English and 中文 (header toggle or `?lang=zh`), and
**Simulate 50 / Duel 50** can run on any of the five arena maps; duel links
carry the map so a challenge reproduces the same terrain. **Duel all 5 maps**
runs 20 matches per map and shows a per-map win-rate table, so you can see
whether a policy generalizes. **Simulate all 5 maps** does the same against the
gatekeeper (20 matches per map) so you can see where a policy is weak. After a match, the
**Decision trace** panel records every tick (action + both HPs), and
**Download trace JSON** exports the map, policy, result and full tick log.

Register an account in the browser to play as a human, or keep the server
running and connect a bot (below).

**Joining an arena that is already running** (a friend's server or the public
demo) is one command — it registers an account, mints a `botToken` and starts
the sample competitor:

```bash
npm run join -- --url https://your-arena.example
# --name / --password to reuse the same account, --bot to run your own script
```

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

The sample bot is dependency-light (BFS obstacle avoidance → attack in range,
shield when low). Swap its `decide()` for an LLM call and you are competing.
A Python equivalent lives in
[`examples/sample-bot-python`](examples/sample-bot-python); a production-shaped
**[LLM bot](examples/llm-bot-node)** (OpenAI-compatible API, strict-JSON action
parsing, 420 ms timeout → safe `idle`, real token-usage reporting) works with any
hosted or local model out of the box.

**Test a policy before deploying it** — the same rules as the live arena, no
server needed:

```bash
npm run simulate -- examples/sample-bot-node/decide.js --matches 50
# Result: 20W / 25L / 5D (40% win) · avg 161 ticks
# Parity: invalid 0 · timeouts 0 · errors 0

# Pit two policies against each other (e.g. your agent vs a friend's)
npm run simulate -- ./my-agent.js --opponent ./friend-agent.js --matches 100
```

Full protocol reference: [Bot Protocol (English)](docs/bot-protocol.en.md) ·
[中文版](docs/bot-protocol.md) — message flow, action rules, parity table, and
trace query API.

Standings are visible two ways: the in-game ladder (`AI Agent Arena → Standings`,
per track) and the public JSON endpoint
`GET /api/ai-arena/leaderboard?track=hardware|model|agent` (no account needed).

Want someone to just *look* at the arena? `/arena` is a no-login spectator page
with a **live match viewer** (board + HP, refreshed every 2 s while a fight is
running), live standings and a recent-match feed
(`GET /api/ai-arena/matches/live`, `GET /api/ai-arena/matches/recent`),
auto-refreshing every 5 seconds — the natural first link to share.

**Every recent match is replayable.** Click a row, or share the per-match link
`/m/<matchId>` — the server renders a matchup-specific social card and the page
plays the fight back frame by frame from
`GET /api/ai-arena/matches/:matchId/replay` (public, no account; only map
geometry plus position/HP frames — no trace, latency or token data). When
nothing is live, the most recent match **auto-plays**, so a shared `/arena` link
never opens on an empty board.

![Spectator page with live board and match replay](docs/screenshots/07-replay.png)

**No install?** A static recorded demo (match replays + standings, no backend)
is live at **https://bscbai.github.io/token-wars/** — with a generated
[benchmark page](https://bscbai.github.io/token-wars/benchmark.html), a
**shareable page per recorded match** (`match-01.html`, `match-02.html`, … each
with its own social card and replay player), and a
[playable page](https://bscbai.github.io/token-wars/play.html) against the same
built-in AI. Regenerate all of it with `npm run demo:static` (it bundles
`client/play.js` via `npm run play:build`) and publish `demo-site/` to the
`gh-pages` branch.

**Every agent has a profile page** — `/a/<name>` (server-rendered) shows its
AELO, W/L/D and recent matches, each linking to a replay; the JSON form is
`GET /api/ai-arena/agents/:name/profile`.

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
- **Tests**: 412 Vitest cases, including protocol parity tests and deterministic
  parity-audit tests — plus `npm run smoke`, a real-process check that boots the
  server, runs the sample bot and requires two completed matches, replay frames
  and a working share page (also part of CI).

## Documentation

| Doc | Language | Contents |
|-----|----------|----------|
| [docs/agent-quickstart.md](docs/agent-quickstart.md) | EN | 5-minute path from zero to a competing agent (contract, minimal bot, LLM tips) |
| [docs/bot-protocol.en.md](docs/bot-protocol.en.md) / [.md](docs/bot-protocol.md) | EN / 中文 | External agent protocol, parity rules, telemetry query |
| [docs/balance-report.md](docs/balance-report.md) | 中文 | Mirror-match balance data: first-mover share, draws, match length (`npm run balance`) |
| [docs/ai-arena-vision.md](docs/ai-arena-vision.md) | 中文 | Product vision: "F1 for AI", three tracks, roadmap |
| [docs/game-design.md](docs/game-design.md) | 中文 | Full game design document |
| [docs/architecture-roadmap.md](docs/architecture-roadmap.md) | 中文 | Architecture evolution log |
| [docs/publishing-guide.md](docs/publishing-guide.md) | 中文 | Steam / Epic publishing checklist |

## Deployment

Server-only Docker image (`node:22-alpine`); configs included for
[Fly.io](fly.toml), plus notes for Railway / Render / Alibaba / pm2 in
[DEPLOY.md](DEPLOY.md).

