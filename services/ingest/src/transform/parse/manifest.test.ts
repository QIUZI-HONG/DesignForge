/**
 * 清单 JSON 解析测试（规格 §2.3 plugin / §2.4 design-system / §2.5 template）。
 *
 * 夹具含真实样本（plugin.json / marketplace.json / template.json / i18n tokens）与手工构造的
 * design-system 清单；断言「分类 + 字段 + 条目计数」这一外部行为。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseManifest } from './manifest.ts';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'parse');
const read = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');

describe('parseManifest', () => {
  it('plugin.json（真实样本）：分类 plugin，取 name/description/version', () => {
    const result = parseManifest(read('plugin.json'), { path: '.claude-plugin/plugin.json' });
    expect(result.ok).toBe(true);
    expect(result.kind).toBe('plugin');
    expect(result.name).toBe('community-import-smoke-test');
    expect(result.version).toBe('0.1.0');
    expect(result.description).toContain('portable community plugin');
  });

  it('marketplace.json（真实样本）：分类 marketplace 并统计条目数', () => {
    const result = parseManifest(read('marketplace.json'), {
      path: '.claude-plugin/marketplace.json',
    });
    expect(result.ok).toBe(true);
    expect(result.kind).toBe('marketplace');
    expect(result.name).toBe('anthropic-agent-skills');
    expect(result.entries).toContainEqual({ field: 'plugins', count: 5 });
  });

  it('template.json（真实样本）：分类 template（模板身份字段），palette 计入证据', () => {
    const result = parseManifest(read('template.json'), { path: 'templates/coral/template.json' });
    expect(result.ok).toBe(true);
    expect(result.kind).toBe('template');
    expect(result.name).toBe('Coral');
    expect(result.slug).toBe('zhangzara-coral');
    expect(result.entries.some((entry) => entry.field === 'palette' && entry.count > 0)).toBe(true);
  });

  it('design-system 清单：token 入口 + 组件清单字段', () => {
    const result = parseManifest(read('design-system-manifest.json'), {
      path: 'manifest.json',
    });
    expect(result.ok).toBe(true);
    expect(result.kind).toBe('design-system');
    expect(result.name).toBe('Acme UI');
    expect(result.entries).toContainEqual({ field: 'components', count: 2 });
  });

  it('template.json 无条目无身份字段 → kind=unknown 且报 missing-entries（不硬凑分类）', () => {
    const result = parseManifest('{"foo": "bar"}\n', { path: 'x/template.json' });
    expect(result.ok).toBe(true);
    expect(result.kind).toBe('unknown');
    expect(result.issues.map((issue) => issue.code)).toContain('missing-entries');
  });

  it('JSON 不可解析 → ok=false + json-parse 诊断（不抛异常、不假装成功）', () => {
    const result = parseManifest('{ "name": "x", }\n', { path: 'plugin.json' });
    expect(result.ok).toBe(false);
    expect(result.kind).toBe('unknown');
    expect(result.issues.map((issue) => issue.code)).toContain('json-parse');
  });

  it('i18n tokens.json 不进清单分类：词表文件交由 tokens 解析器丢弃', () => {
    const result = parseManifest(read('i18n-tokens.json'), {
      path: 'src/i18n/lang/en/tokens.json',
    });
    expect(result.ok).toBe(true);
    expect(result.kind).toBe('unknown');
    expect(result.issues.map((issue) => issue.code)).toContain('not-a-manifest');
  });

  it('package.json 含插件声明字段 → 分类 plugin；普通库 → unknown', () => {
    const declared = parseManifest(
      JSON.stringify({ name: 'df-plugin-x', version: '1.0.0', contributes: { commands: [] } }),
      { path: 'package.json' },
    );
    expect(declared.kind).toBe('plugin');
    expect(declared.entries).toContainEqual({ field: 'commands', count: 0 });
    const plain = parseManifest(JSON.stringify({ name: 'left-pad', version: '1.0.0' }), {
      path: 'package.json',
    });
    expect(plain.kind).toBe('unknown');
  });
});
