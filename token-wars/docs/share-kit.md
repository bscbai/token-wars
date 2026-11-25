# Token Wars — Global Launch Kit

Ready-to-use materials for sharing Token Wars with AI enthusiasts worldwide.
Repo: https://github.com/bscbai/token-wars
Static demo (always up): https://bscbai.github.io/token-wars/
Realtime server: _<fill after `flyctl deploy` / any host>_

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
> and records every decision's latency and tokens. Three runnable samples
> (Node heuristic, Python heuristic, production-shaped LLM bot) plus a
> one-command demo (`npm run demo`) get you competing in minutes; swap the
> heuristic `decide()` for an LLM call and you're racing.

**Differentiators (why it is not "another AI demo")**
1. Bot-first protocol, not a wrapper around a human UI — agents are first-class
   citizens of a shipping game (PvE/PvP/mining/economy included).
2. Built-in competition infrastructure: three tracks, AELO matchmaking/ladder,
   seasons and tournaments.
3. Enforced parity + public telemetry: audit trails persist in SQLite and are
   queryable via REST — claims about your model are verifiable, not vibes.
4. Server-authoritative: no client can cheat movement/cooldowns/damage/costs.

### Fact sheet (for newsletters / press / curators)

- **Name**: Token Wars
- **Genre**: real-time 1v1 AI arena (browser + desktop)
- **Platform**: any modern browser; Windows/macOS/Linux zips on Releases
- **Price**: free; MIT-licensed source
- **Languages**: English and 中文
- **Modes**: human vs built-in AI · AI-agent vs AI-agent ladder · browser bot sandbox
- **Runs**: static demo on GitHub Pages (no server) · full game locally or in Codespaces
- **Tech**: Node.js + Express + Socket.IO (server-authoritative), Phaser 3, SQLite
- **Links**: play / sandbox / replays / benchmark / GitHub (see §3)

## 2. Repo metadata (set manually on GitHub)

- **Description**: Bring your own AI agent to a cyberpunk PvP arena — 20 Hz bot
  protocol, parity rules, full decision telemetry. Humans and agents, one game.
- **Topics** (15): `ai` `llm` `multiplayer` `game` `phaser` `nodejs` `socket-io`
  `ai-agents` `competitive-programming` `cyberpunk` `bot-framework`
  `ai-arena` `browser-game` `indie-game` `pwa`
- **Website**: https://bscbai.github.io/token-wars/ (set on the repo — the
  playable static demo, not a placeholder)
- **Discussions**: enabled; the launch note is pinned at
  https://github.com/bscbai/token-wars/discussions/1 — battle reports and
  league ideas belong there.

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
  A public AELO leaderboard (`GET /api/ai-arena/leaderboard`) and a no-login
  spectator page (`/arena`) need no account.
- **Three competition tracks** (inspired by F1): hardware (powertrain), model
  (chassis), agent strategy (driver) — matchmaking never crosses tracks.
- **Three runnable samples** (Node heuristic + Python heuristic + a
  production-shaped LLM bot); `npm run demo` boots server, sparring bot and a
  competitor in one command. Swap `decide()` for an OpenAI/Anthropic/local-model
  call and it's competing end-to-end.

You can also fight the same built-in brain yourself, right now in the browser
(no install, identical cooldowns/damage): https://bscbai.github.io/token-wars/play.html

It's Node.js + Express + Socket.IO server (authoritative, 412 tests), Phaser 3
client with full EN/ZH UI, SQLite persistence, and a Dockerfile/Fly config.

Repo + protocol docs + sample bots: https://github.com/bscbai/token-wars
Live demo: _<url>_ · Watch-only arena (no signup): _<url>/arena_

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
Watch-only arena, no signup: _<url>/arena_
Code (Node + Socket.IO + Phaser, MIT, 412 tests):
https://github.com/bscbai/token-wars

### Single-match share (per-match static page)

Every recorded match on the static demo has its own URL with a preview card,
so a specific fight can be posted without a live server:

> AI agents fighting at 20 Hz: 198 ticks on Compute Plaza — Vector beats Quanta.
> Watch the replay (no signup): https://bscbai.github.io/token-wars/match-12.html
> 中文回放页: https://bscbai.github.io/token-wars/match-12.zh.html
> Bring your own agent: https://github.com/bscbai/token-wars

(Numbers change whenever the demo is regenerated — re-check the page's card
before posting.)

### Instant play (browser, no install)

> You can fight the Token Wars arena AI in your browser right now — same 500 ms
> attack cooldown, 10 s burst, 20-point shield and crit rolls as the ladder,
> because it runs the exact built-in brain:
> https://bscbai.github.io/token-wars/play.html
> Then bring your own agent: https://github.com/bscbai/token-wars
>
> The page is bilingual (header toggle or `?lang=zh`), so the same link works
> for English- and Chinese-speaking friends. First visit shows a short how-to and
> pauses the match until you're ready. It keeps a local record (wins/losses,
> streak, fastest win) in the browser, all five arena maps are selectable, and
> each map shows its own win/loss record, and a **daily challenge** rotates the
> map plus one rule twist (60 s blitz, 60 HP glass, shielded foe, +25% AI
> attack, 60 HP handicap) with a local best time for today. **Share result**
> copies a ready-to-post line — including `Daily #N` when you played it — with
> both the play and sandbox links, and **Share image** exports a 1200×630 PNG
> of the final board, time and record (native share sheet on mobile).
>
> It is also an installable PWA: an **Install app** button appears when the
> browser supports it, and the play/sandbox pages keep working offline after the
> first visit.

If you'd rather write code than press keys:
https://bscbai.github.io/token-wars/sandbox.html — a `decide(state)` editor
that fights the same AI with the real protocol validation and parity limits,
entirely in the browser. Share a policy as a link (the code is encoded in the
URL), **simulate 50 matches** to get a win rate, **duel a friend** by pasting
their share link (50 offline matches, both sides' invalid/timeout counts), or
export it as a runnable Node bot for a real arena. After a duel, **Copy result**
gives a ready-to-post line ("you 34W / them 12W / 4D …") plus the duel link, and
**Share duel card** exports both win rates as a 1200×630 PNG.
The page is bilingual — header toggle or `?lang=zh` — and Chinese browsers
default to 中文. **Simulate 50 / Duel 50** can run on any of the five arena
maps, and duel links encode the map so a challenge replays the same terrain.
**Duel all 5 maps** runs 20 matches per map and shows a per-map win-rate table,
which makes generalization gaps obvious.
After a match, **Decision trace** lists every tick's action and HP, and
**Download trace JSON** exports map + policy + result + ticks for offline analysis.
**Copy LLM prompt** copies the full spec (state shape, legal actions, timeout
rules, strategy hints) for ChatGPT/Claude, and the sandbox accepts the fenced
code block it returns. **Simulate 50** also prints the Balanced preset's win rate
on the same map as a baseline, and **Simulate all 5 maps** runs the same
comparison against the gatekeeper per map (20 matches each), so "80% wins" has
context. **Share image** exports the latest run as a 1200×630 PNG — big win
rate, record, invalid/timeout counts and per-map bars — so benchmark results
can be posted without screenshots. **Daily challenge** scores your policy on
today's map and rule twist (60 s blitz, 60 HP glass, shielded foe, +25% AI,
60 HP handicap) under the same harness, and `sandbox.html?daily=1` runs it as
soon as the page opens — a recurring coding target for bot authors.

### Short posts (copy-paste)

**X / single post**
> Built Token Wars: a browser arena where you fight the AI yourself, or write a
> decide(state) bot and watch it fight. Same server rules for both. Free, no
> install, installable as a PWA, works offline after first load:
> https://bscbai.github.io/token-wars/play.html

**X / bot angle**
> Give your LLM a body: Token Wars is a 1v1 grid arena with a decide(state) API.
> The sandbox copies a ready prompt for ChatGPT/Claude, simulates 50 matches,
> scores your policy on all 5 maps, exports a runnable Node bot — and renders
> the result as a shareable benchmark card. There is even a daily twist for
> your bot (same map + rule change as the human challenge):
> https://bscbai.github.io/token-wars/sandbox.html?daily=1

**X / daily challenge angle**
> Token Wars has a daily challenge: same map + same rule twist for everyone
> (60 s blitz, 60 HP glass, shielded foe…), one local best time, and a
> one-tap **Share image** card with the final board. Beat #329 and post yours:
> https://bscbai.github.io/token-wars/play.html

**Discord / forum blurb**
> Token Wars — cyberpunk 1v1 arena, human vs built-in AI in the browser, plus a
> bot sandbox with the real protocol. No signup: play _<play url>_, write a bot
> _<sandbox url>_, watch replays _<demo url>_. Daily challenge rotates the map
> and a rule twist, so everyone can compare the same run. Feedback welcome:
> https://github.com/bscbai/token-wars

Want the **live full game** instead of the static slice? Open the repo in
Codespaces: https://codespaces.new/bscbai/token-wars — the dev container installs
dependencies, starts `npm run demo` and exposes port 3000 publicly, so the
preview URL is a real arena with a house bot.

Locally the same evaluation is a CLI:
`npm run simulate -- examples/sample-bot-node/decide.js --matches 50`, and
`--opponent <file>` pits two policies against each other.

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
- [x] GitHub About + topics set (§2) — topics: ai, ai-agents, bot-framework,
      competitive-programming, cyberpunk, game, llm, multiplayer, nodejs,
      phaser, socket-io
- [ ] One real match recorded against the sample bot on the demo server
- [x] Repo-root landing README + 3 issue templates (bug / protocol / league)
- [x] v1.0.0 GitHub Release published with features + quickstart
      (https://github.com/bscbai/token-wars/releases/tag/v1.0.0)
- [x] v1.1.0 release: auto-requeue fix, per-track sparring bots, `npm run join`,
      one-command join panel on `/arena`
      (https://github.com/bscbai/token-wars/releases/tag/v1.1.0)
- [x] v1.1.1 release: public match replays + `/m/:matchId` share pages with
      server-rendered OG cards, balance report (`npm run balance`)
      (https://github.com/bscbai/token-wars/releases/tag/v1.1.1)
- [x] “Open in Codespaces” badge + `.devcontainer` — one click boots the demo
      server, keeps port 3000 public and opens the live arena preview
- [x] Static recorded demo on GitHub Pages (`npm run demo:static` →
      `demo-site/` → `gh-pages`): https://bscbai.github.io/token-wars/
      · Chinese landing page: https://bscbai.github.io/token-wars/index.zh.html
      · benchmark v0 page: https://bscbai.github.io/token-wars/benchmark.html
      (Chinese: https://bscbai.github.io/token-wars/benchmark.zh.html)
      · per-match share pages (`match-01.html` …) with their own OG cards,
      generated and self-checked by the same build
      · playable slice vs the built-in AI:
      https://bscbai.github.io/token-wars/play.html (`client/play.js` bundle,
      same brain/cooldowns/damage as the server; CI diffs the committed bundle)
      · browser agent sandbox: https://bscbai.github.io/token-wars/sandbox.html
      (`client/sandbox.js`; real protocol validation + parity limits, runs
      `decide(state)` locally, nothing uploaded; share links embed the policy,
      `Simulate 50` gives a win-rate report via `server/game/agentSimulator.js`,
      and the page exports a runnable Node bot via `shared/agentTemplate.js`)
- [x] v1.2.0 release: match replays, `/m/:matchId` and `/a/:name` share pages,
      language deep links, static Pages demo, balance report
      (https://github.com/bscbai/token-wars/releases/tag/v1.2.0)
- [x] Default branch (`main`) mirrors the current product structure
      (`token-wars/` + bilingual UI + bot protocol)
- [x] Desktop builds (Windows/macOS/Linux zips) attached to releases by the
      `Desktop release` workflow (tag push or manual dispatch; unsigned, no
      installer) — a no-Node download path for non-technical players
- [x] v1.30.0: five-map simulation vs the gatekeeper (per-map win rates),
      sandbox baseline, LLM prompt copy, first-visit how-to, PWA install +
      offline, X/Reddit/HN share buttons, CI checks OG/canonical/links on all
      46 pages (`npm run demo:check`)
- [ ] Realtime URL (Fly/Render/Codespaces) filled into §1/§3 and both READMEs
- [ ] One external match on the live server captured for the post-launch loop

### 5-minute pre-post check

1. Open `/`, `/play.html`, `/sandbox.html`, `/match-01.html` on a phone —
   no horizontal scroll, no console errors.
2. Paste each link into the target composer and confirm the preview card renders.
3. Run `npm run demo:static && npm run demo:check` (or check the latest CI run
   is green) before linking a just-deployed tag.
4. Re-read the release notes of the tag you are linking; they must mention play,
   sandbox and the desktop zips.
5. If the community requires it, post in the showcase thread first, then the
   standalone post.

