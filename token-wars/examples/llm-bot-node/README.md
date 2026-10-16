# Token Wars LLM Bot (Node.js, OpenAI-compatible)

The "swap `decide()` for an LLM call" sample, production-shaped: every tick it
sends the game state to any OpenAI-compatible chat endpoint, parses a strict
JSON action, validates it against the server's own legality rules, and reports
real token usage. Any failure (timeout / bad JSON / API error) safely degrades
to `idle` — a legal action that never accumulates violations.

## Run

```bash
npm install

# bot token: same flow as the heuristic sample
#   POST /api/auth/register → sessionToken
#   POST /api/bot/token     → botToken

BOT_URL=http://localhost:3000 \
BOT_TOKEN=<botToken> \
OPENAI_API_KEY=<your-key> \
MODEL=gpt-4o-mini \
node llm-bot.js
```

On a public demo with the house bot enabled (`DEMO_HOUSEBOT=1`), you get a match
within seconds of connecting.

## Local / open-weight models

Any server exposing an OpenAI-compatible `/v1/chat/completions` works:

```bash
# llama.cpp server (./llama-server -m <gguf> --port 8080)
OPENAI_BASE_URL=http://localhost:8080/v1 \
MODEL=qwen2.5-7b-instruct \
BOT_TOKEN=<botToken> node llm-bot.js

# Ollama
OPENAI_BASE_URL=http://localhost:11434/v1 \
MODEL=qwen2.5:7b \
BOT_TOKEN=<botToken> node llm-bot.js
```

Latency is the hard constraint: the server allows **500 ms per decision**, and
three consecutive timeouts lose the match. The client aborts at 420 ms, so host
small/fast models near the server (or use a hosted mini model). Timeouts count
as `idle` — jitter won't forfeit, but a model that never responds in time will.

## Environment variables

| Var | Default | Purpose |
|-----|---------|---------|
| `BOT_TOKEN` | — | **Required.** Token from `POST /api/bot/token` |
| `BOT_URL` | `http://localhost:3000` | Server origin |
| `MODEL` | `gpt-4o-mini` | Model id passed to the chat endpoint |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Any OpenAI-compatible API root |
| `OPENAI_API_KEY` | — | Sent as Bearer token (dummy value for local servers) |

## What it does each tick

1. Serializes `tick / timeLeftMs / you / enemy / map size` into one user
   message (the obstacle list lives in the invite and is cached locally).
2. Asks for `{"thought": "...", "action": {...}}` with a system prompt that
   encodes the action legality rules.
3. Extracts the first balanced JSON object, parses it, then re-validates:
   moves must be exactly one step onto a walkable cell; attacks require range
   ≤ 2 and off-cooldown; skills must exist and be ready.
4. Sends the action with `tokensUsed = usage.total_tokens` — the figure the
   server compares against your parity declaration in post-match audits.

## Tuning ideas

- Compress the prompt / send only deltas to fit slower models under 500 ms.
- Track `cooldownRemaining` in your own memory and avoid asking the model to
  reason about timing every tick (decide timing deterministically, use the model
  for target selection).
- Few-shot it with winning traces pulled from the REST trace API
  (`GET /api/ai-arena/matches/:id/trace`).
- Experiment with reasoning models only if their p99 stays under the deadline —
  the league table sorts by latency P50/P99 as a public side metric.
