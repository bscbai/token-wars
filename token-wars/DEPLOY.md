# Token Wars — Quick Deploy

## Option 1: Fly.io (recommended — free, global edge)

### One-time setup
```bash
# Install flyctl (from https://fly.io/docs/flyctl/install/)
powershell -Command "iwr https://fly.io/install.ps1 -UseBasicParsing | iex"

# Login and create app
fly auth login
fly launch --name token-wars --no-deploy --region hkg  # hkg = Hong Kong
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
3. Railway auto-detects the Dockerfile and deploys
4. Set env: `PORT=3000`
5. Get URL from dashboard

---

## Option 3: Render (free tier, cold starts)

1. Go to https://render.com
2. New Web Service → connect `bscbai/token-wars`
3. Build command: _leave blank (uses Dockerfile)_
4. Start command: _leave blank (uses Dockerfile CMD)_
5. Set env: `NODE_ENV=production`, `PORT=3000`

---

## Option 4: 阿里云轻量应用服务器

```bash
# On your Alibaba Cloud server
git clone https://github.com/bscbai/token-wars.git
cd token-wars
npm install
NODE_ENV=production node server/index.js &

# Or with pm2 for auto-restart
npm install -g pm2
pm2 start server/index.js --name token-wars
pm2 save
```

---

## Docker (any platform)

```bash
docker build -t token-wars .
docker run -d -p 3000:3000 --name token-wars-server token-wars
```
