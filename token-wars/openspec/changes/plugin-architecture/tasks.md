# Tasks: Plugin Architecture

> 每个阶段独立可合入、可回退；全程 `npm test`（Vitest）必须绿。M1–M5 对应 design.md 第 7 节。

## M0 — 行为锁定的回归测试

- [ ] 1.1 新增 `test/boot-regression.test.js`：启动 full 组合，断言 6 个 manager 均收到 `registerSocket`（mock io）——锁定现状 ×6 手工注册行为
- [ ] 1.2 断言 `GameEngine.tick` 按 cadence 分发到 mining(1s)/worldBoss(5s)/aiArena(5s)——锁定现状 tick 行为
- [ ] 1.3 断言 INPUT_SKILL 在"副本内/竞技场内/两者皆无"三种情况下分别路由到对应 combatSystem 调用/忽略——锁定现状路由行为
- [ ] 1.4 `npm test` 全绿

## M1 — 内核落地 + 原样包装（行为零变化）

- [ ] 2.1 实现 `server/core/Context.js`：service/get/on/emit/waterfall/socket/every + 效应栈 + INV2（unload 后处理器不再触发）
- [ ] 2.2 实现 `server/core/Loader.js`：profile 载入、extends/disable/overrides、依赖拓扑排序（缺依赖 fail fast）、mount/unload、`--dump-config`
- [ ] 2.3 实现 `server/core/Scheduler.js`：`every('500ms'|ticks, fn)` 统一节奏调度
- [ ] 2.4 新增 `test/context.test.js`、`test/loader.test.js`（效应回滚、重名服务报错、拓扑排序、disable/overrides）
- [ ] 2.5 创建 9 个插件包装（persistence/identity/world-player/combat/pve/pvp/worldboss/aiarena/mining + economy-shop），M1 阶段 setup 内仅实例化 + `ctx.service`，事件订阅仍留在 index.js
- [ ] 2.6 `server/core/profiles/full.js`（全量组合）；index.js 改为经 Loader 启动
- [ ] 2.7 M0 全部回归测试绿；`node server/index.js --dump-config` 打印组合树

## M2 — 玩家接入事件化

- [ ] 3.1 identity/world-player 发出 `player:join`/`player:leave`（携带 player + socket）
- [ ] 3.2 6 个游戏插件订阅事件调用自身 registerSocket/unregisterSocket；删除 index.js 中 ×6 手工调用
- [ ] 3.3 会话顶替（SESSION_REPLACED kick）路径经同一事件流；M0 测试绿

## M3 — tick 声明化

- [ ] 4.1 mining/worldboss/aiarena 改 `ctx.every` 声明节奏；玩家 buff 清理（cleanupBuffs/shieldDrain）归入 combat 插件自身的 `ctx.every(10 ticks)`
- [ ] 4.2 PvE/PvP 自有循环并入 Scheduler（保持原 cadence）
- [ ] 4.3 删除 `GameEngine.tick` 的硬编码分支；GameEngine 移除或退化为 Scheduler 薄壳
- [ ] 4.4 M0 tick 回归测试绿（断言迁移到 Scheduler 行为等价）

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
