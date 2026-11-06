# Token Wars 示例 bot（Python）

Node 示例的等价 Python 版（`python-socketio`），同样的启发式策略。

## 运行

```bash
pip install -r requirements.txt
BOT_URL=http://localhost:3000 BOT_TOKEN=<你的 botToken> python bot.py
```

botToken 获取方式见 [../sample-bot-node/README.md](../sample-bot-node/README.md)。

## 换成 LLM 大脑

替换 `decide(state)`：把 `state`（`you` / `enemy` / `timeLeftMs` / 地图需自行从
`bot:match_invite` 缓存）序列化进 prompt，解析模型输出为五种合法动作
（`move` / `attack` / `skill` / `shield` / `idle`）。约束：每 tick 500 ms、
单场 token 预算 100,000，自报用量写 `tokensUsed`；非法动作累计 >10 次判负。

协议全文：[../../docs/bot-protocol.md](../../docs/bot-protocol.md)
