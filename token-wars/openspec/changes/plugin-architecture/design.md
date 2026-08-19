# Design: Plugin Architecture (借鉴 DeepSeek Harness 插件理念)

> 参考：[deepseek-harness architecture.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)（"everything is a plugin"，基于 Cordis）。本设计**借鉴其理念、不引入其框架**——零新依赖，CommonJS，~300 行内核。

## 1. dsh 理念 → Token Wars 映射

dsh 的核心是：没有特权核心，一切能力（模型适配器、工具注册表、agent 循环本身）都是挂载到共享上下文的插件；注册是可逆效应，卸载即回滚；扩展点以事件暴露；运行时由 Profile（有序层叠的 Bundle）在启动时组合而成，任何一行配置可被上层 patch 替换。

| dsh 概念 | dsh 中的角色 | Token Wars 对应物 |
|---|---|---|
| Cordis Context | 共享上下文，插件贡献服务（`ctx.llm`/`ctx.tools`） | `GameContext`：`ctx.combat`/`ctx.economy`/`ctx.players`… |
| Plugin（一切皆插件） | 模型适配器、工具表、agent 循环都是插件 | persistence/identity/combat/pve/pvp/worldboss/aiarena/mining… 全部是插件 |
| 可逆效应（unwind on unload） | 注册即效应，插件卸载自动回滚 | `ctx.on/ctx.socket/ctx.every/ctx.service` 均返回 disposer，入效应栈，unload 逆序回滚 |
| 服务接缝（定义/提供者/消费者） | 换一个 provider 改变整个产品 | CombatSystem 是接缝：可替换实现（节日规则、测试假战斗），PvE/PvP/WorldBoss/AIArena 是消费者 |
| 事件即扩展点（会话/agent/能力三类） | `agent/*` 瀑布、`session/event` 持久事实 | 游戏事件（广播）/ 瀑布事件（`next()` 链）/ socket 事件（挂 eventGuard） |
| Profile + Bundle 分层组合 | base bundle → profile patch → home patch → CLI overlay | `full` 基座 → profile `extends/disable/overrides` → env 覆盖 |
| `--dump-config` | 打印实际启动的插件树 | `npm start -- --dump-config` 输出组合树（排障/测试断言） |
| "Model-visible means logged" 不变量 | 模型可见输入必须可从日志重建 | 类比不变量：**"网络可见即可在 EVENTS 中找到"**——所有客户端可见行为必须经由 `ctx.socket`/`ctx.emit` 注册，禁止 manager 私藏 socket 监听 |

**刻意不采用的**：Cordis 本体（TS、装饰器、运行时 DI——对当前规模过重）、dsh 的沙箱/审批域（与游戏无关）、多进程插件隔离（留给 Phase 4）。

## 2. 目标架构

```
server/
├── index.js                 # ~30 行：ctx → profile → mount → listen → shutdown
├── core/                    # 极薄内核，零游戏逻辑（无特权，可被整体替换）
│   ├── Context.js           # GameContext：服务注册表 + 事件总线 + 效应栈
│   ├── Loader.js            # Profile 载入、依赖拓扑排序、mount/unload
│   ├── Scheduler.js         # 声明式节奏调度（ctx.every 的实现）
│   └── profiles/
│       ├── full.js          # 全量（= 现状行为，M1 的默认）
│       ├── embedded.js      # extends full, disable: [worldboss, aiarena]（桌面内嵌）
│       └── duel.js          # 仅 identity/world-player/combat/pvp（冒烟测试）
└── plugins/                 # 一切游戏系统皆插件
    ├── persistence/         # → ctx.store       (包装 data/Store.js)
    ├── identity/            # → ctx.sessions    (包装 routes/auth.js + JWT)
    ├── world-player/        # → ctx.players     (在线注册表、移动校验、INPUT_MOVE)
    ├── combat/              # → ctx.combat      (CombatSystem 即服务接缝)
    ├── pve/                 # 消费 ctx.combat
    ├── pvp/
    ├── worldboss/
    ├── aiarena/
    ├── mining/
    └── economy-shop/        # → ctx.economy     (shop 路由 + 商城)
```

## 3. 插件契约

```js
// server/plugins/pve/index.js
const PvEManager = require('../../game/PvEManager');
const { EVENTS } = require('../../../shared/constants');

module.exports = {
  name: 'pve',
  dependsOn: ['persistence', 'identity', 'world-player', 'combat'],
  provides: ['pve'],                    // 声明后消费者可通过 ctx.get('pve') 取用

  setup(ctx, cfg) {
    const mgr = new PvEManager(ctx.io, ctx.store, ctx.combat);
    ctx.service('pve', mgr);            // 服务注册（消费者：未来的公会战/观战）

    // —— 以下全部是可逆效应，unload 时自动回滚 ——
    ctx.on('player:join',  ({ player, socket }) => mgr.registerSocket(player.id, socket));
    ctx.on('player:leave', ({ playerId })        => mgr.unregisterSocket(playerId));
    ctx.every('500ms', (now) => mgr.tick(now));   // 替代 GameEngine 硬编码分支
    ctx.socket(EVENTS.PVE_ENTER, pveEnterSchema,
      (payload, { player }) => mgr.enterDungeon(player, payload.dungeonId), 'query');

    return () => mgr.dispose?.();       // 可选：插件自定义清理
  },
};
```

Loader 职责（对照 dsh app-boot 的层叠组合）：

1. 读 profile → 解析 `extends` 链得到有序插件列表（`disable` 移除，`overrides` 深合并到插件 cfg）；
2. 检查 `dependsOn`，拓扑排序，缺失依赖即启动失败（fail fast，对应 dsh "There is no privileged core to patch" 的反面：依赖必须显式声明）；
3. 依序 `setup(ctx, cfg)`；任一失败则逆序 unload 已挂载者再退出；
4. `--dump-config` 打印最终组合树（插件名 + 版本 + cfg），供测试断言与排障。

## 4. GameContext API（~200 行，零依赖）

```js
// 服务接缝（dsh: Service Definition / Provider / Consumer）
ctx.service(name, impl)        // 提供者；重名注册 = 启动错误（接缝唯一）
ctx.get(name)                  // 消费者；未注册 = 依赖缺失错误
// 便捷访问：setup 执行后 ctx.combat === ctx.get('combat')

// 广播事件（dsh: session events / agent events 的"事实"语义）
ctx.on(event, fn) -> disposer  // player:join / player:leave / player:move / season:reset ...
ctx.emit(event, payload)

// 瀑布事件（dsh: waterfall，监听器必须调 next()）
ctx.waterfall('combat:resolve-context', (data, next) => {
  const dungeonId = mgr.playerDungeons.get(data.player.id);
  if (!dungeonId) return next();          // 不归我管，放行
  data.entities = ...; data.resolved = true;  // 归我管，填充后停止
});

// Socket 路由（可逆；替代 index.js 中央注册）
ctx.socket(EVENTS.X, schema, handler, category) -> disposer
//   挂到 eventGuard.on()，需先给 eventGuard 加 teardown（返回 socket.off）

// 节奏声明（可逆；替代 GameEngine.tick 硬编码）
ctx.every('500ms' | 20 /* ticks */, fn) -> disposer

// 生命周期
ctx.effects.push(disposer)     // 所有 disposer 自动入栈
loader.unload(name)            // 逆序回滚该插件的全部效应（未来热载/多实例的基础）
```

**两个运行时不变量**（对照 dsh "Model-visible means logged"）：

- INV1 网络可见即可在 EVENTS 找到：客户端可见行为只能经 `ctx.socket` 注册的处理器产生；manager 不得私接 `socket.on`。
- INV2 注册即可逆：任何 `ctx.on/ctx.socket/ctx.every/ctx.service` 注册的处理器，在 unload 后不再被触发（单测断言）。

## 5. 关键接缝示例：INPUT_SKILL 重构

现状（`index.js:225-257`）：中央 handler 依次伸手进 `pveManager.playerDungeons`、`pvpManager.playerArenas` 内部 Map，硬编码"副本 or 竞技场 or 忽略"。

目标：world-player 插件持有 INPUT_MOVE/INPUT_SKILL 的 socket 注册，发出 `combat:resolve-context` 瀑布；pve、pvp、worldboss 各挂一个监听器认领（认领即填充 `entities` 并短路，不认领则 `next()` 放行）。新增战斗场景（如公会战场）= 新插件挂监听器，**零改动现有插件**——这正是 dsh "mount a plugin beside the others" 的扩展方式。

## 6. Profile 分层组合

```js
// server/core/profiles/embedded.js — 桌面内嵌轻量组合
module.exports = {
  extends: './full',
  disable: ['worldboss', 'aiarena'],        // 单机世界不需要
  overrides: {
    mining: { offlineCapHours: 2 },          // 离线挂机上限收紧
    pvp:    { matchmaking: false },
  },
};
```

层叠顺序（对照 dsh：bundle → profile patch → home patch → `--patch` overlay）：

```
full.js 基座 → profile extends/disable/overrides → 环境变量覆盖(TOKEN_WARS_DISABLE=worldboss) → CLI(--profile/--dump-config)
```

选择 `.js` 而非 `.yml`：零新依赖，且 overrides 可用表达式。profile 声明保持纯数据（可被上层 patch 的"配置行"），逻辑仍在插件内。

## 7. 迁移计划（绞杀者，每步可独立合入/回退）

与 `docs/architecture-roadmap.md`"增量演进、不重写"一致；不占用 Phase 1–5 的排期，作为并行工程轨道。

| 阶段 | 内容 | 验收 |
|------|------|------|
| M0 | 补测试：锁住 registerSocket×6 / tick 分支 / INPUT_SKILL 路由的现有行为 | 新增回归测试绿 |
| M1 | core/Context+Loader+Scheduler 落地；9 个插件**原样包装**现有 manager（index.js 变薄但仍是事实上的全量启动） | `npm test` 全绿；`--dump-config` 输出 full 树；行为零变化 |
| M2 | `player:join/leave` 事件化：index.js 的手工 register/unregister 删除，各插件自订阅 | M0 回归测试绿 |
| M3 | tick 声明化：GameEngine 分支删除，插件 `ctx.every`；PvE/PvP 自有循环并入 Scheduler | 回归测试绿；tick 顺序按依赖图稳定 |
| M4 | socket 接缝化：eventGuard 加 teardown；`ctx.socket` 全量接管；INPUT_SKILL 改 `combat:resolve-context` 瀑布 | 回归测试绿；INV1 成立 |
| M5 | profiles 落地：full/embedded/duel；electron 内嵌改用 embedded profile | duel profile 冒烟通过；单测断言组合树 |

M1–M4 期间 `full` profile 即现状全量，玩家与客户端**无感知**（协议、EVENTS、REST 均不变）。

## 8. 决策记录

1. **不引入 Cordis/TS**：借鉴理念（可逆效应、接缝、瀑布、分层组合），内核自研 ~300 行 CommonJS。dsh 是 12k+ commits 的产品级 harness，直接依赖对单人维护的 game server 过重。
2. **绞杀者而非重写**：Manager 类在 M1–M5 全程原样存活，只加包装层；每步 `npm test` 兜底。
3. **服务重名即失败**：接缝唯一性 fail fast，避免两个插件同时 `ctx.service('combat')` 的静默覆盖。
4. **`combat:resolve-context` 用瀑布而非广播**：认领语义（第一个认领者短路）天然匹配互斥的战斗上下文；dsh 的 `agent/pre-step` 同款模式。
5. **内部事件不进 `shared/constants.js`**：`player:join` 等是服务端内部扩展点，与客户端协议（EVENTS/REST）解耦——协议仍是唯一对外契约。
6. **Profile 纯数据**：`extends/disable/overrides` 均为声明式字段，保证可被上层 patch（dsh patch 语义）且 `--dump-config` 可完整打印。
