# 客户端国际化（中英双语）— Proposal

## Why

目标是将 Token Wars 分享给全球 AI 爱好者，但客户端约 794 处中文字符串散落在
11 个场景/UI 文件中，海外玩家打开即流失。需要一个低侵入、可分批迁移的 i18n
基建，并优先翻译玩家进入游戏的最高曝光路径。

## What changes

- 新增 `client/src/i18n.js`：极简字典式 i18n（`t(key, vars)` / `setLang` /
  语言变更订阅 / localStorage 持久化 / 浏览器语言探测，默认非中文环境走英文）。
- 首批翻译（本变更范围）：`index.html`（lang/title）、`LoginScene`（含语言
  切换按钮，切换即时生效）、`LobbyScene`（功能入口大厅）。
- 其余场景（Mining/PvE/PvP/Shop/Inventory/Dungeon/AIArena/Combat/HUD）保留
  中文，后续批次按相同模式迁移，本次不改动。
- 测试：i18n 纯模块的 key 完备性（en/zh 对齐）与变量替换、持久化 round-trip。

## Impact

- 新增：`client/src/i18n.js`、`test/i18n.test.js`
- 修改：`client/index.html`、`client/src/scenes/LoginScene.js`、
  `client/src/scenes/LobbyScene.js`
- 服务端协议、存档、游戏逻辑零改动。
