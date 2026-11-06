# 客户端 i18n（首批：基建 + 登录/大厅）— 任务

- [x] T1 `client/src/i18n.js`：单例（t/setLang/getLang/onLangChange/detectLang）+ en/zh 字典（login/lobby 键）
- [x] T2 `index.html`：lang/title 由登录页按语言同步（静态默认英文）
- [x] T3 `LoginScene.js`：全部文案接 t()；applyLang() 统一刷新 canvas+DOM；语言切换按钮；订阅在 shutdown 释放
- [x] T4 `LobbyScene.js`：全部文案接 t()，canvas text 订阅语言变更
- [x] T5 `test/i18n.test.js`：key 完备性（en/zh 对齐）、变量替换、缺失回退、setLang 持久化与订阅（11 项）
- [x] T6 浏览器实机验证（切换即时生效/登录流程/刷新持久化，0 console error）+ 全量 npm test 289/289 + 提交推送
