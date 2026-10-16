/**
 * guard-tokens 自测（禁裸值守卫的规则与白名单）。
 *
 * 为什么自测放在包里：守卫是门禁件，必须能「证明自己会红」——
 * 违规样例必须被抓到、合规样例必须放行、白名单必须只放行它声明的理由。
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  ALLOWLIST,
  allowlistFor,
  collectSourceFiles,
  RULES,
  scanRoots,
  scanText,
} from './guard-tokens-core.mjs';

describe('guard-tokens · 规则', () => {
  it('R1 抓颜色裸值（hex / rgb / hsl）', () => {
    const violations = scanText(
      'apps/web/src/a.tsx',
      `
      const a = '#0D99FF';
      const b = 'rgba(0, 0, 0, 0.5)';
      const c = 'hsl(210, 100%, 52%)';
    `,
    );
    expect(violations.map((item) => item.rule)).toEqual(['R1', 'R1', 'R1']);
    expect(violations[0]?.line).toBe(2);
  });

  it('R2 抓长度裸值，但放行零值', () => {
    const violations = scanText(
      'apps/web/src/a.css',
      `
      padding: 12px;
      margin: 0;
      border: 0px;
      font-size: 1.5rem;
    `,
    );
    expect(violations.map((item) => item.text)).toEqual(['12px', '1.5rem']);
  });

  it('R3 抓样式对象里的裸数字间距（间距族属性）', () => {
    const violations = scanText(
      'apps/web/src/a.tsx',
      `
      const style = { marginTop: 8, gap: 12, borderRadius: 6 };
      const ok = { width: 240, zIndex: 10 };
    `,
    );
    expect(violations.map((item) => item.rule)).toEqual(['R3', 'R3', 'R3']);
  });

  it('合规写法放行：var 令牌引用、百分比、零值', () => {
    const violations = scanText(
      'apps/web/src/a.tsx',
      `
      const style = {
        marginTop: 'var(--dfg-space-2)',
        gap: 'var(--dfg-icon-gap)',
        borderRadius: 'var(--dfg-radius-md)',
        width: '60%',
        padding: 0,
      };
    `,
    );
    expect(violations).toEqual([]);
  });

  it('令牌定义文件与测试文件按白名单跳过（附理由）', () => {
    expect(allowlistFor('packages/ui/src/tokens.ts')).toEqual({
      allowed: true,
      reason: ALLOWLIST[0]?.reason,
    });
    expect(allowlistFor('packages/ui/src/tokens.css').allowed).toBe(true);
    expect(allowlistFor('apps/web/src/app/page.test.tsx').allowed).toBe(true);
    expect(allowlistFor('apps/web/src/app/page.tsx').allowed).toBe(false);
    expect(scanText('packages/ui/src/tokens.ts', "const primary = '#0d99ff';")).toEqual([]);
  });

  it('行内豁免：标记带理由才生效，不带理由仍报违规', () => {
    const withReason = scanText(
      'apps/web/src/a.tsx',
      "const brand = '#0d99ff'; // guard-tokens:allow 品牌色常量（来自设计稿冻结值）",
    );
    expect(withReason).toEqual([]);
    const withoutReason = scanText(
      'apps/web/src/a.tsx',
      "const brand = '#0d99ff'; // guard-tokens:allow",
    );
    expect(withoutReason.length).toBe(1);
  });

  it('注释里的说明文本跳过：带令牌引用示例或样式对象记号的说明文字', () => {
    const violations = scanText(
      'apps/web/src/a.ts',
      [
        '// 口径：`border: var(--dfg-border-width-hairline) solid var(--dfg-color-border)` 这类示例走令牌',
        '// 说明：间距一律 var(--dfg-space-2)，不要写 padding: 12px',
      ].join('\n'),
    );
    expect(violations).toEqual([]);
  });

  it('字符串里的取值写法照抓，示例与自然语言文案跳过（守卫辨别力不因精度修复丢失）', () => {
    const violations = scanText(
      'apps/web/src/a.ts',
      [
        "const extracted = 'fontSize: 16';",
        "const raw = 'gap: 12';",
        "const hint = '请把 marginTop: 8 改成令牌';",
        '// 这里曾经写过 #0d99ff（规范泄漏记录，仍应被抓）',
        ' * 取色：rgb(13, 153, 255)',
      ].join('\n'),
    );
    expect(violations.map((item) => `${item.rule}@${String(item.line)}`)).toEqual([
      'R3@1',
      'R3@2',
      'R1@4',
      'R1@5',
    ]);
  });

  it('跨行块注释里的样式语法文本整体跳过（不再按行误报），块外的取值照抓', () => {
    const violations = scanText(
      'apps/web/src/a.ts',
      [
        '/*',
        ' * 样例：{ marginTop: 8, gap: 12 }',
        ' * 取色：rgb(13, 153, 255)',
        ' */',
        'const bad = {/* 取值写在块内注释里 */ marginTop: 9 };',
      ].join('\n'),
    );
    expect(violations.map((item) => `${item.rule}@${String(item.line)}`)).toEqual(['R3@5']);
  });

  it('规则表可列举（CLI 输出用）', () => {
    expect(RULES.map((rule) => rule.id)).toEqual(['R1', 'R2', 'R3']);
    for (const rule of RULES) {
      expect(rule.title.length).toBeGreaterThan(0);
      expect(rule.hint.length).toBeGreaterThan(0);
    }
  });
});

describe('guard-tokens · 目录扫描', () => {
  const fixtureRoot = join(process.cwd(), 'node_modules', '.cache', 'guard-tokens-fixture');

  afterAll(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it('扫目录：抓到违规、跳过白名单、忽略 node_modules', () => {
    rmSync(fixtureRoot, { recursive: true, force: true });
    mkdirSync(join(fixtureRoot, 'apps/web/src'), { recursive: true });
    mkdirSync(join(fixtureRoot, 'packages/ui/src'), { recursive: true });
    mkdirSync(join(fixtureRoot, 'apps/web/src/node_modules'), { recursive: true });
    writeFileSync(
      join(fixtureRoot, 'apps/web/src/bad.tsx'),
      'export const Bad = () => <div style={{ marginTop: 12 }} />;\n',
    );
    writeFileSync(join(fixtureRoot, 'apps/web/src/good.tsx'), 'export const good = 1;\n');
    writeFileSync(
      join(fixtureRoot, 'packages/ui/src/tokens.ts'),
      "export const primary = '#0d99ff';\n",
    );
    writeFileSync(
      join(fixtureRoot, 'apps/web/src/node_modules/skip.ts'),
      "export const x = '#fff';\n",
    );

    const result = scanRoots(fixtureRoot, ['apps/web/src', 'packages/ui/src']);
    expect(result.violations.map((item) => `${item.file}:${String(item.line)}`)).toEqual([
      'apps/web/src/bad.tsx:1',
    ]);
    expect(result.skipped.map((item) => item.file)).toEqual(['packages/ui/src/tokens.ts']);
  });

  it('collectSourceFiles 只收源码扩展名', () => {
    const files = collectSourceFiles(join(process.cwd(), 'src', 'utils'));
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((file) => /\.(ts|mjs)$/.test(file))).toBe(true);
  });
});
