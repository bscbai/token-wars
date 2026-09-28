# Tasks: Coprocessor System（数据层）

> 全程 `npm test` 必须绿；协议只改 `shared/constants.js`；数值以 GDD §3 为准。

## T1 — 常量与图鉴 ✅

- [x] 1.1 `shared/constants.js`：`COPROCESSORS` 替换为 16 条目（攻击/防御/机动/经济各 4），每条 `stars: [★,★★,★★★]`；旧 4 条目键名保留、值形态改 `stars`
- [x] 1.2 新增 `COPROCESSOR_CATEGORIES`、`COPROCESSOR_STARS`（MAX 3、UPGRADE_COSTS [3,8]）、`COPROCESSOR_IDS`、`COPROCESSOR_FRAGMENT_SOURCES`（solo 0.15 / team 0.30 / pvp 0.10 + 两个未接线声明）、`COPROCESSOR_SHOP`（DUPLICATE_FRAGMENTS 3）；`EVENTS` 加 `COPROCESSOR_FRAGMENT`
- [x] 1.3 确认 `shared/protocol.js` 零改动（re-export shim）

## T2 — Player 模型 ✅

- [x] 2.1 构造：`coprocessors = []`、`fragments = {}`、`activeCoprocessor = null`
- [x] 2.2 方法：`addCoprocessor`（授予/重复折碎片/未知 id）、`addFragment`、`canUpgradeCoprocessor`、`upgradeCoprocessor`、`setActiveCoprocessor`
- [x] 2.3 `serialize()`/`toSave()` 输出三字段；`fromSave()` 补默认值（旧存档 → 空图鉴）

## T3 — 碎片掉落助手与接线 ✅

- [x] 3.1 `server/game/CoprocessorDrops.js`：`rollCoprocessorId`（16 均匀随机）、`rollFragmentGrant(player, source, { store, socket })`（rate 判定 → addFragment → markDirty → 发 `COPROCESSOR_FRAGMENT`）
- [x] 3.2 `PvEManager.completeDungeon`：参与玩家各 roll 一次（≥2 人 TEAM_BOSS 0.30 / 单人 SOLO_BOSS 0.15），在既有 persist 事务点前
- [x] 3.3 `PvPManager.endMatch`：连胜宝箱分支内以 PVP_STREAK（0.10）roll
- [x] 3.4 `server/routes/shop.js`：`coprocessor: true` 礼包 → 随机未拥有 id 授予，全拥有折碎片；`received.coprocessor` 升级为 `{ id, status }`，删除 TODO

## T4 — 测试与验收 ✅（2026-09-29，189/189 用例通过）

- [x] 4.1 `test/coprocessor.test.js`（30 用例）：图鉴完整性（16 条/分类/id 唯一/三星结构/闪电链 GDD 表逐格一致）、Player 五方法正反用例、fromSave 兼容、掉落率边界与事件 payload、PvE/PvP 接线、商店礼包落地
- [x] 4.2 全量 `npm test` 绿（189/189，14 文件）
- [x] 4.3 启动烟雾：`/health` 200（scheduler:true）+ 注册流 serialize 含 `coprocessors`/`fragments`/`activeCoprocessor`
