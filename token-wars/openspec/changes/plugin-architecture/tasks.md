# Tasks: Plugin Architecture

> 每个阶段独立可合入、可回退；全程 `npm test`（Vitest）必须绿。M1–M5 对应 design.md 第 7 节。

## M0 — 行为锁定的回归测试 ✅（2026-08-19，81/81 用例通过）

- [x] 1.1 `test/boot-regression.test.js` ①组：镜像 index.js 装配 + 替身 manager，断言 6 个 manager 的 registerSocket/unregisterSocket wiring、离线挂机先于注册、AUTH_SUCCESS 回发，及会话顶替时序（socket.io v4 服务端 disconnect(true) 同步触发 → 旧注册被注销、新连接随后重新注册并成为持有者）
- [x] 1.2 ②组：真实 GameEngine 类直测 tick 分发——mining 每 20 tick（100 tick 内 5 次）、worldBoss/aiArena 每 100 tick、buff 清理/shield 流失每 10 tick 且仅存活玩家，含 10/19/20 tick 精确边界
- [x] 1.3 ③组：镜像 INPUT_SKILL 处理器（真实 guard.on 接线）——副本优先/竞技场兜底/副本失效穿透到竞技场/大厅静默忽略/死亡忽略/schema 校验失败回发 error，共 6 场景
- [x] 1.4 `npm test` 全绿：8 文件 81 用例（原 68 + 新 13），零产品代码改动

## M1 — 内核落地 + 原样包装（行为零变化）✅（2026-08-19，120/120 用例通过）

- [x] 2.1 实现 `server/core/Context.js`：service/get/on/emit/waterfall/socket/every + 效应栈 + INV2（unload 后处理器不再触发）
- [x] 2.2 实现 `server/core/Loader.js`：profile 载入、extends/disable/overrides、依赖拓扑排序（缺依赖 fail fast）、mount/unload、`--dump-config`
- [x] 2.3 实现 `server/core/Scheduler.js`：`every('500ms'|ticks, fn)` 统一节奏调度
- [x] 2.4 新增 `test/context.test.js`、`test/loader.test.js`（效应回滚、重名服务报错、拓扑排序、disable/overrides）
- [x] 2.5 创建 10 个插件包装（persistence/identity/world-player/combat/pve/pvp/worldboss/aiarena/mining/economy-shop），M1 阶段 setup 内仅实例化 + `ctx.service`，事件订阅仍留在 index.js
- [x] 2.6 `server/core/profiles/full.js`（全量组合）；index.js 改为经 Loader 启动
- [x] 2.7 M0 全部回归测试绿（120/120）；`node server/index.js --dump-config` 打印组合树；启动烟雾测试通过（服务正常起停）

## M2 — 玩家接入事件化 ✅（2026-08-19，124/124 用例通过）

- [x] 3.1 world-player 发出 `player:join`/`player:leave`（携带 player + socket）；宿主 index.js 仅广播 `auth:authenticated`（握手/AUTH_LOGIN 两路同源）与 `socket:disconnect`，内部事件不进 shared/constants（design 决策 5）
- [x] 3.2 6 个游戏插件（mining/combat/pve/pvp/worldboss/aiarena）订阅事件调用自身 registerSocket/unregisterSocket；index.js 的 registerPlayer 函数与 ×6 手工调用、三 Map 注册表全部删除（迁入 world-player，暴露 ctx.players 服务）
- [x] 3.3 会话顶替（SESSION_REPLACED kick）路径经同一事件流，同步时序与 M0 ③ 锁定一致；M0 回归全绿
- [x] 3.4 新增 `test/m2-player-events.test.js`：真实内核组合（Context+Loader+full profile 10 插件）+ 镜像薄宿主——join/leave 事件契约、6 manager 注册/注销、离线挂机先于注册、会话顶替、INV2（unload world-player 后不再注册）共 4 用例；启动烟雾（/health 经 ctx.players）通过

## M3 — tick 声明化 ✅（2026-08-19，124/124 用例通过）

- [x] 4.1 mining/worldboss/aiarena 改 `ctx.every(TICK_RATE / TICK_RATE*5)` 声明节奏；combat 插件 `ctx.every(10 ticks)` 负责 buff 清理 + shield 流失（仅存活玩家）
- [x] 4.2 PvE/PvP 实例级 setInterval(50ms) 移除，改由 pve/pvp 插件 `ctx.every(1 tick)` 全局扫描驱动（1 tick=50ms=20Hz，cadence 等价；state 非 active 自然跳过）
- [x] 4.3 index.js 删 GameEngine 引用，改 `ctx.scheduler.start(TICK_MS)` / `ctx.scheduler.stop()`；GameEngine.js 保留但生产路径不再使用
- [x] 4.4 M0 ② 测试断言迁移到 Scheduler（buildScheduler + scheduler.every 注册 + scheduler.tick 推进），4 个用例全绿；启动烟雾 /health `scheduler:true` 通过

## M4 — Socket 路由接缝化

- [ ] 5.1 `eventGuard.on()` 返回解绑函数（`socket.off`）；`ctx.socket` 基于其实现可逆注册
- [ ] 5.2 各 manager 的 socket 监听迁移为插件内 `ctx.socket`；index.js 中央注册删除（AUTH_LOGIN 兼容路径保留在 identity）
- [ ] 5.3 INPUT_SKILL/INPUT_MOVE 迁入 world-player；战斗上下文解析改为 `combat:resolve-context` 瀑布（pve/pvp/worldboss 各挂认领监听器）
- [ ] 5.4 新增 `test/seam.test.js`：INV1（网络可见处理器全部经 ctx.socket 注册）+ 瀑布认领互斥 + unload 回滚 socket 监听
- [ ] 5.5 M0 路由回归测试绿

## M5 — Profile 组合落地

- [ ] 6.1 `profiles/embedded.js`（extends full + disable worldboss/aiarena + mining.offlineCapHours 覆盖）
- [ ] 6.2 `profiles/duel.js`（PvP-only）；`test/profiles.test.js` 断言组合树与裁剪生效
- [ ] 6.3 electron 内嵌模式（START_EMBEDDED_SERVER=1）改用 embedded profile；`--profile` CLI 参数
- [ ] 6.4 文档：`docs/architecture-roadmap.md` 增补"插件化工程轨道"一节，标注 M1–M5 完成状态
- [ ] 6.5 冒烟：duel profile 启动 → 匹配 → 一场战斗结束；full profile 完整回归
