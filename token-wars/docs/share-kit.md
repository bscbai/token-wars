# Token Wars — Global Launch Kit

Ready-to-use materials for sharing Token Wars with AI enthusiasts worldwide.
Repo: https://github.com/bscbai/token-wars · Live demo: _<fill after deploy>_

---

## 1. Core message (3 lengths)

**One-liner**
> Bring your own AI agent to a cyberpunk 1v1 arena — connect any program over a
> 20 Hz Socket.IO protocol, with token budgets, latency limits, spec audits, and
> full per-tick telemetry. "Formula 1 for AI."

**3 sentences**
> Token Wars is a real-time multiplayer browser game where LLM-powered agents
> fight 1v1 on a grid, and humans can play the same arena. Competitors enter one
> of three tracks — hardware, model, or agent strategy — while the server
> enforces parity (500 ms/decision, 100k token budget, random model-spec audits)
> and records every decision's latency and tokens. Two runnable sample bots
> (Node + Python) get you competing in 5 minutes; swap the heuristic `decide()`
> for an LLM call and you're racing.

**Differentiators (why it is not "another AI demo")**
1. Bot-first protocol, not a wrapper around a human UI — agents are first-class
   citizens of a shipping game (PvE/PvP/mining/economy included).
2. Built-in competition infrastructure: three tracks, AELO matchmaking/ladder,
   seasons and tournaments.
3. Enforced parity + public telemetry: audit trails persist in SQLite and are
   queryable via REST — claims about your model are verifiable, not vibes.
4. Server-authoritative: no client can cheat movement/cooldowns/damage/costs.

## 2. Repo metadata (set manually on GitHub)

- **Description**: Bring your own AI agent to a cyberpunk PvP arena — 20 Hz bot
  protocol, parity rules, full decision telemetry. Humans and agents, one game.
- **Topics**: `ai` `llm` `multiplayer` `game` `phaser` `nodejs` `socket-io`
  `ai-agents` `competitive-programming` `cyberpunk` `bot-framework`
- Website: live demo URL after deploy.

## 3. Ready-to-post

### Show HN

**Title**: Show HN: Token Wars – bring your own LLM agent to a 1v1 game arena

**Body**:
Hi HN — I built a browser game where the intended "players" are AI agents, not
humans (though humans can play too).

Your agent connects to a Socket.IO `/bot` namespace with a bot token, receives
game state at 20 Hz, and returns one action per tick: move / attack / skill /
shield / idle. Every action is validated server-side — range, cooldowns,
walkability — with the same execution primitives as the built-in agents.

A few things I cared about:

- **Parity, not vibes.** Each match has a 500 ms per-decision deadline and a
  100k token budget. Competitors declare model specs; after ~20% of matches the
  server audits measured P99 latency and tokens/decision against the declaration,
  and serial violations get the agent suspended.
- **Verifiable telemetry.** Every tick's action, latency, and token spend is
  recorded, persisted in SQLite, and queryable via REST with ownership checks.
- **Three competition tracks** (inspired by F1): hardware (powertrain), model
  (chassis), agent strategy (driver) — matchmaking never crosses tracks.
- **Two sample bots** (Node + Python) with a ~50-line heuristic; swap `decide()`
  for an OpenAI/Anthropic/local-model call and it's competing end-to-end.

It's Node.js + Express + Socket.IO server (authoritative, 293 tests), Phaser 3
client with full EN/ZH UI, SQLite persistence, and a Dockerfile/Fly config.

Repo + protocol docs + sample bots: https://github.com/bscbai/token-wars
Live demo: _<url>_

Happy to hear what breaks, what's unfair, and what an official league season
should look like.

### r/LocalLLaMA / r/MachineLearning

**Title**: I made a game where your LLM is the competitor — 1v1 arena with a
20 Hz bot API, token budgets, latency limits, and audited telemetry

**Body** (trim Show HN body, lead with the local-model angle):
You can run a 7B model locally and enter it on equal footing — what matters is
behavior under a 500 ms/tick deadline and 100k tokens/match, not parameter count.
Python quickstart:
`pip install python-socketio` → register → mint a bot token → `python bot.py`.
Protocol reference and full action/parity tables in the repo. Three tracks
(hardware/model/agent) isolate what you're actually comparing. Would love
battle reports from different local models — trace query endpoint lets you post
exactly what your model did each tick.
https://github.com/bscbai/token-wars

### X / Twitter (post + reply)

1/ Built a game where the players are AI agents.

Token Wars: LLM agents 1v1 on a grid, 20 decisions/sec, server-enforced parity
(500ms deadline, 100k token budget/match), and every tick's latency+tokens
recorded and queryable.

5-minute start with a Python or Node sample bot. Swap the heuristic for an LLM
call and you're ranked.

2/ The interesting part: it's "F1 for AI" — three tracks that each isolate one
variable (hardware / model / agent strategy), so a clever prompt can beat a
bigger model, and a well-hosted model can win on latency. Spec declarations +
random audits keep claims honest.

3/ Humans can play the same arena manually (Phaser client, EN/中文).
Code (Node + Socket.IO + Phaser, MIT-style, 293 tests):
https://github.com/bscbai/token-wars

## 4. Where to post (priority order)

1. **Hacker News** "Show HN" (weekday 08:00–10:00 US PT, Sunday also strong)
2. **r/LocalLLaMA** (self-post allowed; emphasize local models + parity)
3. **r/MachineLearning** (flair: Project)
4. **X** (tag @localllm, @LangChainAI, @AnthropicAI, @OpenAIDev, #LLMagents)
5. Relevant Discords: LangChain, EleutherAI, r/LocalLLaMA Discord,
   AI Engineer community — post in #showcase channels, read rules first.
6. **Product Hunt** — schedule after the live demo is stable for 48 h; needs a
   2560×1440 hero + 5 screenshots (see docs/publishing-guide.md asset list).

## 5. Post-launch proof loop (what to capture for v2 posts)

- Leaderboard screenshot after first external matches.
- One interesting trace: prompt/decision that won against a bigger model
  (privacy: only post your own agent's trace).
- Match stats P50/P99 + token spend across model families.
- "Bring your model" weekly event: fixed track, posted rules, public results.

## 6. Before posting checklist

- [ ] Live demo deployed and reachable (HTTPS), JWT_SECRET set
- [x] Instant matches solved: `DEMO_HOUSEBOT=1` keeps the TW-Gatekeeper agent
      queued so visitors' bots never wait for a second player
- [ ] GitHub About + topics set (§2)
- [ ] One real match recorded against the sample bot on the demo server
- [x] Repo-root landing README + 3 issue templates (bug / protocol / league)
- [ ] README demo URL filled in both README.md and README.zh-CN.md
