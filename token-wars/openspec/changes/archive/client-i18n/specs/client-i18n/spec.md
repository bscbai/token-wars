# Spec — Client I18n

## ADDED Requirements

### Requirement: Bilingual dictionary access

The client SHALL provide an `i18n` module with `t(key, vars)` returning localized
strings for supported languages `en` and `zh`, with `{var}` interpolation.

#### Scenarios

- Existing key in current language → translated string.
- Missing key in current language → falls back to English, then to the key itself
  (never throws).
- Interpolation variable supplied → substituted; missing variable leaves the
  `{name}` placeholder intact.

### Requirement: Language selection and persistence

The client SHALL persist the chosen language in `localStorage['tw-lang']` and
notify subscribers on change; initial language SHALL be detected from
localStorage, then `navigator.language` (zh* → zh), defaulting to English.

#### Scenarios

- setLang('zh') → getLang() === 'zh', subscribers invoked, value persisted.
- First visit with `navigator.language = 'fr-FR'` and no stored value → English.
- First visit with `navigator.language = 'zh-CN'` and no stored value → Chinese.

### Requirement: Login and lobby localized

The login scene (canvas text, form labels, buttons, placeholders, status
messages) and lobby scene entry buttons SHALL render through `t()`, and the
login scene SHALL offer an in-page language toggle that applies immediately
without reload.

#### Scenarios

- Toggle EN ↔ 中文 on the login page updates every visible string at once.
- Toggling language then logging in shows the lobby in the chosen language;
  choice survives page reload.
- Login/register mode toggle continues to work after a language switch.

### Requirement: Incremental migration

Scenes not yet migrated SHALL remain functional with their Chinese strings; the
i18n module SHALL NOT require all scenes to be migrated (no global key-enforcement
at runtime).

#### Scenarios

- Opening Mining/Shop/etc. after this change behaves exactly as before.
