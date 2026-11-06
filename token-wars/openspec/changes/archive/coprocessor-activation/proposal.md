# 协处理器技能激活 + 技能盘槽架构（M6）

## 问题

M5 交付了协处理器的**数据层**（16 图鉴、碎片经济、★→★★→★★★ 升级、`activeCoprocessor` 装载、碎片来源）。但装载之后协处理器**没有任何战斗效果**——`activeCoprocessor` 只是一个字段，玩家无法"使用"它。

GDD §3 定义协处理器是"稀有 Token，提供独特技能"，§3.3 给每个协处理器标了 `冷却` 与 `Token 消耗`，即它们是**主动技能**。当前缺口：协处理器技能放哪个槽位、如何触发、如何做服务端权威校验与效果执行。

## 方案

1. **槽架构**：已装载的 `activeCoprocessor` 占据一个**独立的协处理器槽**（区别于 Q/W/E/R 四个基础技能槽，也区别于 4×4 token 网格）。触发走新 Socket 事件 `input:coprocessor`。
2. **效果执行框架**：新建 `server/game/CoprocessorSystem.js`，统一完成"解析装载 → 冷却校验 → Token 消耗 → 按 id 分发效果处理器 → 广播"。
3. **本变更范围（垂直切片）**：完整落地**攻击型 4 个效果**（闪电链 / 穿透射击 / 分裂弹 / 灼烧印记），端到端覆盖冷却/消耗/目标选择/伤害/击杀/广播。
4. 防御型 / 机动型 / 经济型 12 个效果需要在护盾反射伤害入口重构、移动路径校验、地面掉落、挖矿/掉落 hook 等子系统就绪后落地，列入 `tasks.md` 后续增量（M6.1/M6.2/M6.3）。

## 影响

- 服务端新增 `CoprocessorSystem`；`shared/constants.js` 加 `EVENTS.INPUT_COPROCESSOR`、`EVENTS.COPROCESSOR_ACTIVATED`；`Player` 加瞬时 `coprocessorLastUsed` 冷却字段；`combat`/`world-player` 插件接线。
- 纯服务端权威，客户端仅需订阅 `coprocessor:activated` 与既有的 `combat:hit` 渲染。