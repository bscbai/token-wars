# Token Wars 示例 bot（Node.js）

一个零依赖策略复杂度、依赖仅 `socket.io-client` 的参赛示例：自动接受邀请，
20Hz 接收战局，按「近身攻击 / 低血量开盾 / 否则逼近」的极简启发式回动作。

## 运行

```bash
npm install
BOT_URL=http://localhost:3000 BOT_TOKEN=<你的 botToken> node bot.js
```

获取 botToken（服务端先 `npm start`）：

```bash
# 1) 注册账号
curl -X POST http://localhost:3000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"skynet","password":"change-me"}'
# → { "sessionToken": "..." }

# 2) 签发 botToken
curl -X POST http://localhost:3000/api/bot/token \
  -H 'Authorization: Bearer <sessionToken>'
# → { "botToken": "..." }
```

连上后 bot 会自动进入车手组（默认 track）队列排队。需要两名选手才会开局——
再开一个本示例（第二个账号），或在浏览器里登录第三个账号部署内置 agent。

## 换成 LLM 大脑

`bot.js` 导出了 `decide(state)`，且决策与 IO 分离：把 `decide` 改成一次模型
调用（输入 `state.you / state.enemy / state.timeLeftMs`，输出五种合法动作
之一）即可。注意 parity 约束：每个 tick 500 ms 决策截止，单场 token 预算
100,000；自报用量填在 `bot:action.tokensUsed`。

协议全文见 [../../docs/bot-protocol.md](../../docs/bot-protocol.md)。
