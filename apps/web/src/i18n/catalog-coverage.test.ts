/**
 * i18n 目录覆盖守卫（票 10 · spec P1-6 收尾网）。
 *
 * 口径：源码里所有**静态字面量** `t('key')` 必须在 zh-CN 目录有词条——缺了就按
 * 「原样回键」直出裸键（巡检实测：inspector.effect.drop_shadow 曾因此直出）。
 * 动态键（`t(\`prefix.${value}\`)`）无法静态枚举，由各功能域用例钉住实际取值
 * （效果类型见 `i18n/index.test.ts` 票 10 段；诊断/面板等各有取值枚举）。
 * 本测试是**回归网**（先红后绿的修复由票 10 用例承担），防新增裸键引用。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import zhCN from '../../messages/zh-CN.json';

/** 收集目录下全部 .ts/.tsx 源文件路径。 */
function walkSources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walkSources(full));
    } else if (/\.(tsx?|mjs)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

describe('i18n 目录覆盖守卫（票 10）', () => {
  it('源码全部静态 t() 字面量在 zh-CN 目录有词条（缺词条 = 裸键直出）', () => {
    const catalog = zhCN as unknown as Record<string, string>;
    const srcRoot = join(import.meta.dirname, '..');
    const missing = new Map<string, string[]>();
    for (const file of walkSources(srcRoot)) {
      if (file.includes(`${import.meta.dirname.split('/').pop()}`)) continue; // i18n 自身测试不扫
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'\s*[,)]/g)) {
        const key = match[1];
        if (key !== undefined && catalog[key] === undefined) {
          const list = missing.get(key) ?? [];
          list.push(file.replace(`${srcRoot}/`, ''));
          missing.set(key, list);
        }
      }
    }
    expect([...missing.entries()]).toEqual([]);
  });
});
