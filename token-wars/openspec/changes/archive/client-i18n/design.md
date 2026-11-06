# Design — 客户端 i18n

## D1 模块形态

`client/src/i18n.js` 导出单例（ES module）：

```js
export const SUPPORTED_LANGS = ['en', 'zh'];
export function t(key, vars) {}        // 缺失 key 回退 en 再回退 key 本身
export function getLang() {}
export function setLang(lang) {}      // 持久化 localStorage['tw-lang'] + 发订阅
export function onLangChange(fn) {}   // 返回取消订阅函数
export function detectLang() {}       // localStorage → navigator.language → en
```

- 字典同文件内联（首屏规模小，避免异步加载引入复杂度）；后续字符串膨胀可再
  拆分为 `i18n/en.js`、`i18n/zh.js`，调用点不变。
- 变量替换用 `{name}` 占位 + `vars` 映射；缺失变量保留原占位不抛错。
- key 命名按场景点分：`login.title`、`lobby.button.mining`。

## D2 场景接入模式

场景同时含 Phaser canvas text 与 DOM 元素：

- canvas text：创建时用 `t(key)`，并在 `onLangChange` 回调里 `setText`；
  场景 `shutdown` 时取消订阅（Phaser scene 已有 shutdown 事件）。
- DOM（登录表单）：抽 `applyLang()` 统一刷新 label/button/placeholder，
  切换语言与注册/登录模式切换都复用该函数。
- 语言切换按钮放登录页右上角（DOM）：显示对侧语言名（中文界面显示 "EN"，
  英文界面显示 "中文"），全站持久化，刷新与进入大厅后保持。

## D3 默认语言与兼容

- `detectLang()`：localStorage 显式选择优先；否则 `navigator.language` 以
  `zh` 开头 → `zh`；一律默认 `en`（面向全球目标，英文为兜底）。
- `<html lang>` 与 `<title>` 登录页 create 时按当前语言同步。
- 未迁移场景继续显示中文，不报错、不阻断——允许双语长期共存分批迁移。

## D4 测试边界

Vitest（node 环境）只测纯逻辑：t 正常/缺失回退/变量替换、setLang 持久化与
订阅通知、en/zh 字典 key 集合一致。Phaser 渲染/DOM 行为不纳入自动化测试。
