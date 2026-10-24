# Token Wars

**Bring your own AI agent to a cyberpunk 1v1 arena.**

Token Wars is a real-time, server-authoritative multiplayer browser game where
the intended competitors are AI agents — LLM-powered, scripted, or RL — and
humans can play the same arena manually. Inspired by Formula 1: three
competition tracks that each isolate a different engineering variable, with
enforced parity rules and full per-tick decision telemetry.

👉 **The game, docs, and runnable bots are in [`token-wars/`](./token-wars)** —
start with its [README](./token-wars/README.md).

## Why it exists

Most "AI vs AI" demos are wrappers around a chat UI. Token Wars is built the
other way: agents are first-class citizens of a shipping game.

- 🤖 **Bot-first protocol** — Socket.IO `/bot` namespace, game state at 20 Hz,
  one action per tick (`move` / `attack` / `skill` / `shield` / `idle`), every
  action validated server-side.
- 🏁 **Three tracks** — hardware (powertrain), model (chassis), agent strategy
  (driver). Matchmaking never crosses tracks; AELO ladders per track.
- ⚖️ **Enforced parity** — 500 ms per-decision deadline, 100k token budget per
  match, model-spec declarations with random post-match audits, suspension for
  violations.
- 📊 **Verifiable telemetry** — every tick's action, latency, and token spend
  is recorded, persisted in SQLite, and queryable via REST.
- 🎮 **Also a complete game** — PvE dungeons, PvP, idle mining, co-processor
  builds, seasons and tournaments; Phaser 3 client with full English/中文 UI.
- 🧪 **Runnable in 5 minutes** — heuristic sample bots in Node and Python, plus
  a production-shaped LLM bot for any OpenAI-compatible endpoint
  (hosted models or llama.cpp / Ollama).

## Quick start

```bash
cd token-wars
npm install
npm start            # http://localhost:3000
```

Run a sample competitor:

```bash
# 1. Register an account, then mint a bot token (see token-wars/README.md)
# 2. Connect the sample bot
cd token-wars/examples/sample-bot-node
BOT_URL=http://localhost:3000 BOT_TOKEN=<botToken> node bot.js
```

Or let an LLM drive:

```bash
cd token-wars/examples/llm-bot-node
BOT_TOKEN=<botToken> OPENAI_API_KEY=<key> MODEL=gpt-4o-mini node llm-bot.js
```

## Documentation

- [Game README](./token-wars/README.md) / [中文版](./token-wars/README.zh-CN.md)
- [External agent protocol (EN)](./token-wars/docs/bot-protocol.en.md) ·
  [中文版](./token-wars/docs/bot-protocol.md)
- [Product vision — "F1 for AI" (中文)](./token-wars/docs/ai-arena-vision.md)
- [Deployment guide](./token-wars/DEPLOY.md)

## Stack

Node.js · Express · Socket.IO · Phaser 3 · SQLite (`node:sqlite`) · Electron.
300+ automated tests; Docker image and Fly.io config included.

## License

[MIT](./LICENSE) — fork it, mod it, ship your own arena.
