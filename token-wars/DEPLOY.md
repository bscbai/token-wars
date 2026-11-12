# Token Wars — Quick Deploy

> The app lives in `token-wars/` inside the repo (repo root is the landing README).
> Every command below must run **from `token-wars/`**.

## Option 1: Fly.io (recommended — free, global edge)

### One-time setup
```bash
# Install flyctl (from https://fly.io/docs/flyctl/install/)
powershell -Command "iwr https://fly.io/install.ps1 -UseBasicParsing | iex"

cd token-wars                      # fly.toml and Dockerfile live here
fly auth login
fly launch --name token-wars --no-deploy --region nrt  # nrt = Tokyo (change primary_region + --region together)
```

### Persistent volume (required — `fly.toml` already mounts it)
SQLite lives at `/app/server/data/tokenwars.db`. The config mounts the volume
`tokenwars_data` there, so **create it before the first deploy**; otherwise the
deploy fails and players/matches would reset on every restart.
```bash
fly volumes create tokenwars_data --size 1
```

### Required secrets & demo options
```bash
# JWT secret is mandatory in production (server refuses to boot without it)
fly secrets set JWT_SECRET="$(openssl rand -hex 32)"

# Recommended for a public demo: always-queued house bot so visitors' agents
# match instantly without waiting for a second human player
fly secrets set DEMO_HOUSEBOT=1

# Optional: shorten the 5-minute per-agent match cooldown (ms) so the public
# /arena feed stays active. Applies to every agent on the instance.
fly secrets set AI_MATCH_COOLDOWN_MS=60000
```

### Deploy
```bash
fly deploy
```

### Scale
```bash
fly scale count 1    # single instance
fly scale vm shared-cpu-1x --memory 512  # adjust as needed
```

---

## Option 2: Railway (easy — GitHub auto-deploy)

1. Go to https://railway.app
2. Connect your GitHub → select `bscbai/token-wars`
3. **Set the service Root Directory to `token-wars`** (the Dockerfile is not at
   the repo root)
4. Set env: `PORT=3000`, `NODE_ENV=production`, `JWT_SECRET=<random 32+ bytes>`,
   `DEMO_HOUSEBOT=1` (recommended for a public demo)
5. Get URL from dashboard

---

## Option 3: Render (free tier, cold starts)

1. Go to https://render.com
2. New Web Service → connect `bscbai/token-wars`
3. **Root Directory: `token-wars`**; Dockerfile path: `token-wars/Dockerfile`
4. Build command: _leave blank (uses Dockerfile)_
5. Start command: _leave blank (uses Dockerfile CMD)_
6. Set env: `NODE_ENV=production`, `PORT=3000`, `JWT_SECRET=<random 32+ bytes>`,
   `DEMO_HOUSEBOT=1`

---

## Option 4: 阿里云轻量应用服务器

```bash
# On your Alibaba Cloud server
git clone https://github.com/bscbai/token-wars.git
cd token-wars/token-wars          # app directory inside the repo
npm install
JWT_SECRET=<random 32+ bytes> NODE_ENV=production DEMO_HOUSEBOT=1 node server/index.js &

# Or with pm2 for auto-restart
npm install -g pm2
JWT_SECRET=<random 32+ bytes> NODE_ENV=production DEMO_HOUSEBOT=1 \
  pm2 start server/index.js --name token-wars
pm2 save
```

---

## Docker (any platform)

Build from the app directory — the Dockerfile's build context is `token-wars/`:

```bash
cd token-wars
docker build -t token-wars .
docker run -d -p 3000:3000 -e JWT_SECRET=<random 32+ bytes> \
  -e NODE_ENV=production -e DEMO_HOUSEBOT=1 \
  -v "$(pwd)/.data:/app/server/data" \
  --name token-wars-server token-wars
```

Mount a host directory (or a named volume) at `/app/server/data`, otherwise
SQLite resets on every container recreation.
