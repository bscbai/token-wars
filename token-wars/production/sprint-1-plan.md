# Token Wars — Sprint 1 计划（存档可靠性与运行时加固）

> **版本**: v1.0
> **状态**: 已确认，实施中
> **负责人**: 程基岩（engineering-lead）
> **阶段归属**: Phase 1 工程地基（承接 `docs/architecture-roadmap.md` v1.0）
> **创建日期**: 2026-08-03

---

## 审计副作用备注（必读）

本 Sprint 计划源自对现网持久化层的只读审计。审计过程产生了一次**非破坏性副作用**，在此明确记录：

- **WAL checkpoint 事件**：审计以只读方式打开 `server/data/tokenwars.db` 进行校验。由于原进程从未 `close()` 数据库，`-wal` 日志累积至 **4.1 MB**（主库仅 24 KB）。审计连接关闭时 SQLite 自动触发了一次 WAL checkpoint，将 WAL 内容合并回主库。
- **数据完整性结论**：checkpoint 前后均执行校验，结果一致：
  - `PRAGMA integrity_check` → **ok**
  - `SELECT COUNT(*) FROM players` → **4 条记录**（`test1` / `player1` / `1234` / `smoketest`）
  - **数据无损**，无记录丢失或损坏。
- **实施期额外保护**：S1 实施前已将生产库复制到 `.backup-s1/tokenwars.db.pre-s1`（24 KB，integrity ok，4 条记录），并二次校验通过。所有 S1 测试均使用临时 `DB_PATH`，**未写入生产库**。

> 该事件本身即 S1 存在的证据：WAL 从不 checkpoint 说明关停路径从未正确关闭数据库。

---

## Sprint 目标

让 Token Wars 的服务端在**非正常退出下不丢玩家资产**，并把"重启即丢数据"的结构性风险从架构中移除。Sprint 1 不做新玩法，只做地基。

**退出标准**：任意时刻 `kill -9`，玩家已完成的交易（购买 / 领取 / 收集 / 掉落 / 结算）100% 不丢失。

---

## 背景：审计发现的核心问题

| # | 问题 | 证据 | 影响 |
|---|---|---|---|
| P0-1 | **全项目无任何玩法代码调用 `savePlayer`** | 全仓 grep：`savePlayer` 仅出现在 `Store.js` 自身与 `auth.js` 登录路径 | 商店购买/每日领取/挖矿/掉落/PvP 战绩全靠 60s 定时全量写，崩溃最多丢 60s 资产 |
| P0-2 | **`SIGINT/SIGTERM` 只 `save()` 不 `close()`** | `server/index.js` 关停处理器 | 数据库从不正常关闭，WAL 从不 checkpoint（实测 WAL 4.1 MB vs 主库 24 KB） |
| P0-3 | **`Store.js` 模块顶层直接实例化单例** | `const store = new Store(config.DB_PATH)` 写在模块尾部 | `import` 即打开生产库；测试/工具脚本误触生产数据 |
| P1-1 | autosave 为全量写且无事务 | `save()` 遍历全部玩家逐条 upsert | 玩家规模增长后每 60s 一次全表写放大；无事务边界 |

---

## Story 列表（S1–S9）

| ID | Story | 优先级 | 状态 |
|---|---|---|---|
| S1 | 存档写穿与优雅关停 | P0 | **已完成** |
| S2 | 存档写入的崩溃一致性回归测试 | P0 | 待办 |
| S3 | 会话与账号安全加固 | P0 | 待办 |
| S4 | 服务端输入校验中间件 | P1 | 待办 |
| S5 | 定时器与内存泄漏治理 | P1 | 待办 |
| S6 | 结构化日志与可观测性补齐 | P1 | 待办 |
| S7 | CI 流水线与质量门禁 | P1 | 待办 |
| S8 | 玩家数据 schema 版本化与迁移 | P2 | 待办 |
| S9 | 备份、恢复与运维手册 | P2 | 待办 |

---

### S1 · 存档写穿与优雅关停 【P0 · 已完成】

**问题**：玩家花钱买的东西可能在 60 秒内凭空消失；数据库从不正常关闭。

**范围**

1. **`Store` 增加 `markDirty(player)` + 脏集合**
   - `this.dirty` 为 `Set<playerId>`；`markDirty()` 仅做 `Set.add`，可安全用于热路径。
   - autosave 改为 `flushDirty()`：**只写脏对象**，整批包在 `BEGIN` / `COMMIT` 事务中。
   - `COMMIT` 成功后才清脏标记；失败则 `ROLLBACK` 并保留脏集合等待下轮重试。
   - `save()` 保留为**全量刷写**（同样事务化），仅用于关停，保证最终一致。

2. **关键交易点改为立即写穿**
   - 新增 `Store.persist(player)`：内部调 `savePlayer()`，**写失败时降级为 `markDirty()`** 并记 error 日志——I/O 抖动不得静默吞掉已发放的道具。
   - 覆盖交易点：商店购买、每日领取、挖矿收集、挖矿升级、副本通关掉落、怪物掉落、玩家死亡掉落、PvP 结算、世界 Boss 结算、AI 竞技场日结、等级提升（随各 XP 发放点一并落盘）。
   - 低价值高频状态（被动挖矿累积、技能消耗 Token、护盾扣费）走 `markDirty()`，由事务化 autosave 批量落盘。

3. **优雅关停链**
   - `SIGINT` / `SIGTERM` → `server.close()` → `server.closeIdleConnections()` → `io.close()` → `gameEngine.stop()` → `store.close()`（内含 `save()` + `PRAGMA wal_checkpoint(TRUNCATE)` + `db.close()`）→ 退出。
   - 分层超时：在途请求 1.5s 宽限 → 仍未关完则 `closeAllConnections()` 强断 → **5s 硬上限**强制退出（强退前仍尽力 `store.close()`）。
   - 重入保护：重复信号只执行一次。

4. **消除 import 副作用**
   - 去掉模块顶层 `new Store()`，改 `getStore()` 惰性单例 + `closeStore()`。
   - `routes/auth.js`、`routes/player.js`、`routes/shop.js` 全部改为依赖注入工厂（`makeAuth` / `makePlayerRouter` / `makeShopRouter`），由 `server/index.js` 显式装配。
   - 结果：`require` 任何服务端模块都不再打开或创建数据库文件。

**验收标准**

| # | 标准 | 结果 |
|---|---|---|
| ① | 购买后 `kill -9`，重启后道具仍在 | PASS |
| ② | `SIGINT` 后 `.db-wal` ≈ 0 B 或不存在 | PASS（53,592 B → 不存在） |
| ③ | import 任何模块不再创建 `server/data/*.db` | PASS |
| ④ | `npx vitest run` 全绿 | PASS（35/35） |

**测试证据**
- 自动化：`test/store-persistence.test.js`、`test/routes-persistence.test.js`、`test/combat.test.js`（新增写穿断言）
- 烟雾测试：`scripts/s1-smoke.js`（14/14 通过，全程使用临时 `DB_PATH`）

**已知平台限制**
- Windows 上 `process.kill(pid, 'SIGINT'|'SIGTERM')` 由 OS 无条件终止目标进程，**处理器不会执行**（已实测验证）。故 ② 采用进程内 `process.emit('SIGINT')` 触发真实处理器。控制台真实 Ctrl+C 与 Linux/容器 `SIGTERM` 不受此限制。

---

### S2 · 存档写入的崩溃一致性回归测试 【P0】

**问题**：S1 的写穿保证目前靠一次性烟雾脚本验证，没有进 CI，回归会静默退化。

**范围**
- 把 `scripts/s1-smoke.js` 的 ①③④ 改造为可在 CI 无头运行的集成测试。
- 补充故障注入用例：磁盘写失败 → `persist()` 降级为脏标记 → 下轮 autosave 补写成功。
- 补充并发用例：同一玩家在同一 tick 内多次交易，落盘结果与内存态一致。
- 为 `flushDirty()` 的 `ROLLBACK` 分支补测试（当前仅有 `persist()` 失败分支覆盖）。

**验收**：CI 中可稳定复现"崩溃—重启—校验"，无 flaky；覆盖率报告纳入 `server/data/Store.js`。

---

### S3 · 会话与账号安全加固 【P0】

**问题**：`JWT_SECRET` 在非生产环境回落到硬编码默认值；无 token 吊销；注册/登录无限流。

**范围**
- 启动时校验密钥强度；开发默认值仅在 `NODE_ENV=development` 允许并打醒目告警。
- 引入 token 版本号（`tokenVersion` 入库），改密码/封禁即全端失效。
- `bcrypt` 轮数纳入配置；登录失败退避 + 按 IP/账号限流。
- 审计 `verifySession` 的所有调用点，确认封禁玩家无法通过任何路径操作。

**验收**：弱密钥无法在生产启动；封禁后既有 token 立即失效；暴力破解被限流拦截。

---

### S4 · 服务端输入校验中间件 【P1】

**问题**：Socket.IO 事件负载缺少统一 schema 校验，玩法管理器直接信任客户端字段。

**范围**
- 为 `shared/protocol.js` 中每个事件定义负载 schema，接入统一校验中间件。
- 非法负载记日志 + 计数，不崩连接。
- 复核服务端权威边界：移动、技能、组队、购买路径不得存在客户端可控的数值旁路。

**验收**：模糊测试脚本发送畸形负载不致崩溃、不产生非法状态。

---

### S5 · 定时器与内存泄漏治理 【P1】

**问题**：`PvEManager` / `PvPManager` 各自 `setInterval` 20Hz，清理路径分散；`entities`、`playerSockets`、`rateLimitMap` 等 Map 存在残留风险。

**范围**
- 副本/竞技场生命周期统一收敛，确保异常路径也走 `cleanup`。
- 死亡重生的 `setTimeout` 在实例销毁时取消。
- 增加运行时泄漏探针（活跃副本/竞技场/socket 计数进 `/health`）。
- 长跑测试：模拟 200 场副本 + 200 场 PvP，比对前后堆内存与 Map 尺寸。

**验收**：长跑后各 Map 归零，RSS 无单调增长。

---

### S6 · 结构化日志与可观测性补齐 【P1】

**问题**：`PvPManager`、`GameEngine`、`WorldBossManager` 仍在用 `console.log`，与 Pino 并存。

**范围**
- 清理残余 `console.*`，统一走 `logger`，补 `playerId` / `arenaId` / `dungeonId` 关联字段。
- `/health` 扩展：脏集合大小、上次 autosave 耗时与写入条数、DB 文件与 WAL 大小。
- 关键交易点埋点（购买/结算/掉落），为后续经济平衡提供数据。

**验收**：一次完整对局可在日志中按 ID 串起全链路；`/health` 能反映持久化健康度。

---

### S7 · CI 流水线与质量门禁 【P1】

**问题**：`.github/workflows` 尚未落地，测试全靠本地手动执行。

**范围**
- GitHub Actions：install → `vitest run` → S2 集成测试 → 打包烟雾测试。
- 引入 lint 与格式化，纳入门禁。
- 缓存依赖，控制单次流水线时长。

**验收**：PR 未通过门禁不可合入；主干每次提交都有绿色构建。

---

### S8 · 玩家数据 schema 版本化与迁移 【P2】

**问题**：`players.data` 是裸 JSON，`Player.fromSave` 用 `Object.assign` 直接铺开，字段增删无版本控制（`coprocessorFragments` 已在代码中出现但不在 `toSave()` 白名单内）。

**范围**
- 存档结构加 `schemaVersion`，建立迁移函数链。
- 校正 `toSave()` / `fromSave()` 的字段白名单，补齐遗漏字段。
- 迁移前自动备份，迁移失败可回滚。

**验收**：旧版本存档可无损升级；字段遗漏有测试兜底。

---

### S9 · 备份、恢复与运维手册 【P2】

**问题**：生产库无自动备份，无演练过的恢复流程。

**范围**
- 定时 `VACUUM INTO` 快照 + 保留策略。
- 编写恢复演练手册（含本次审计的 WAL 事件作为案例）。
- 部署环境的信号语义与优雅关停窗口写入运维文档（含 Windows 信号限制说明）。

**验收**：完成一次"删库—从备份恢复"演练并记录耗时。

---

## 实施顺序

```
S1（已完成）→ S2 → S3 → S4/S5（可并行）→ S6 → S7 → S8 → S9
```

S1 是所有后续工作的地基：没有可靠写入，其余加固都建立在会丢数据的存储之上。

---

> **文档版本**: v1.0
> **变更日志**:
> - v1.0: 初版，基于持久化专项审计确认 S1–S9；S1 完成并通过四条验收。
