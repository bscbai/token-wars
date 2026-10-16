/**
 * i18n 键覆盖率守卫（openspec archive/client-i18n 后续批次保障）
 *
 * 扫描 client/src 下所有 t('...') / t("...") 字面量调用，断言：
 *   ① 每个静态键都存在于 en/zh 字典（防拼写错误导致界面显示 raw key）
 *   ② 动态键（模板字符串）必须在本文件的动态扩展表中可枚举，且展开后全覆盖
 *
 * 新场景接入 i18n 后本测试自动守护，无需手工维护键列表。
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { messages } from '../client/src/i18n.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_SRC = path.join(__dirname, '..', 'client', 'src');

function walkJs(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJs(p));
    else if (entry.name.endsWith('.js')) out.push(p);
  }
  return out;
}

/**
 * 动态键扩展表：源码中 t(`prefix.${var}.suffix`) 的可枚举展开。
 * 键 = 正则；值 = 该调用点所有可能的具体键。
 */
const DYNAMIC_EXPANSIONS = [
  { pattern: /arena\.beh\.\$\{[^}]+\}\.name/g, keys: ['berserker', 'perfect_defense', 'greedy_algorithm', 'dodge_master'].map((id) => `arena.beh.${id}.name`) },
  { pattern: /arena\.beh\.\$\{[^}]+\}\.desc/g, keys: ['berserker', 'perfect_defense', 'greedy_algorithm', 'dodge_master'].map((id) => `arena.beh.${id}.desc`) },
  { pattern: /arena\.week\$\{[^}]+\}/g, keys: [1, 2, 3, 4].map((w) => `arena.week${w}`) },
  { pattern: /arena\.buff\.\$\{[^}]+\}\.name/g, keys: ['quantum_awaken', 'shadow_protocol', 'entropy_crisis'].map((id) => `arena.buff.${id}.name`) },
  { pattern: /arena\.buff\.\$\{[^}]+\}\.desc/g, keys: ['quantum_awaken', 'shadow_protocol', 'entropy_crisis'].map((id) => `arena.buff.${id}.desc`) },
];

describe('客户端 t() 键覆盖', () => {
  const files = walkJs(CLIENT_SRC);
  const staticKeys = new Set();
  const dynamicLiterals = [];

  it('扫描到客户端源码文件', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(CLIENT_SRC, file);

    // 静态：t('key') / t("key")
    for (const m of src.matchAll(/\bt\(\s*['"]([a-zA-Z0-9_.]+)['"]/g)) {
      staticKeys.add(m[1]);
    }
    // 动态：t(`...${...}...`)
    for (const m of src.matchAll(/\bt\(\s*`([^`]+)`/g)) {
      dynamicLiterals.push({ rel, expr: m[1] });
    }
    // 间接引用：非 i18n 模块中所有 arena./login./lobby. 前缀的字符串字面量
    //（如 replayActionKey 的 action→key 映射、resultKey 等）
    if (path.basename(file) !== 'i18n.js') {
      for (const m of src.matchAll(/['"]((?:arena|login|lobby)\.[a-zA-Z0-9_.]+)['"]/g)) {
        staticKeys.add(m[1]);
      }
    }
  }

  it('所有静态键均存在于 en 与 zh 字典', () => {
    const missingEn = [...staticKeys].filter((k) => !(k in messages.en));
    const missingZh = [...staticKeys].filter((k) => !(k in messages.zh));
    expect(missingEn, `缺失 en 键: ${missingEn.join(', ')}`).toEqual([]);
    expect(missingZh, `缺失 zh 键: ${missingZh.join(', ')}`).toEqual([]);
  });

  it('所有动态 t() 调用均在扩展表登记，且展开键全覆盖', () => {
    for (const { rel, expr } of dynamicLiterals) {
      const hit = DYNAMIC_EXPANSIONS.find((d) => d.pattern.test(expr));
      // reset regex lastIndex（全局正则复用）
      DYNAMIC_EXPANSIONS.forEach((d) => { d.pattern.lastIndex = 0; });
      expect(hit, `${rel}: 未登记的动态键 t(\`${expr}\`)，请在 DYNAMIC_EXPANSIONS 补全枚举`).toBeTruthy();
      for (const key of hit.keys) {
        expect(key in messages.en, `${rel}: 缺 en ${key}`).toBe(true);
        expect(key in messages.zh, `${rel}: 缺 zh ${key}`).toBe(true);
      }
    }
  });
});
