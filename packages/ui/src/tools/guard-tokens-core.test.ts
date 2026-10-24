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
  SCAN_EXTENSIONS,
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
    expect(RULES.map((rule) => rule.id)).toEqual(['R1', 'R2', 'R3', 'R4']);
    for (const rule of RULES) {
      expect(rule.title.length).toBeGreaterThan(0);
      expect(rule.hint.length).toBeGreaterThan(0);
    }
  });
});

describe('guard-tokens · 单位合法性（R4，F-1 缺陷回归守卫）', () => {
  // 病灶（总纲 §1 F-1）：时长令牌落盘 `150px`，一致性测试两边一致地错。
  // R4 让「单位」本身成为被守卫对象：时长必须 ms、长度必须 px、字重/行高/层级必须无单位。
  // 白名单对 R1-R3 豁免令牌定义文件（px/色值在那里是合法居民），但 R4 对 tokens.css 照查。

  it('R4 抓时长令牌落 px（既有误用现场：--dfg-duration-fast: 150px 必须被抓）', () => {
    const violations = scanText(
      'packages/ui/src/tokens.css',
      ':root {\n  --dfg-duration-fast: 150px;\n}\n',
    );
    expect(violations.map((item) => `${item.rule}:${item.line}:${item.text}`)).toEqual([
      'R4:2:--dfg-duration-fast: 150px',
    ]);
  });

  it('R4 双向抓错：长度缺单位 / 无单位族带单位 / 时长非 ms / 未登记数值族', () => {
    const violations = scanText(
      'packages/ui/src/tokens.css',
      [
        ':root {',
        '  --dfg-space-2: 8;',
        '  --dfg-font-weight-bold: 700px;',
        '  --dfg-duration-base: 200;',
        '  --dfg-duration-slow: 0.3s;',
        '  --dfg-z-toast: 1300px;',
        '  --dfg-opacity-ghost: 0.4;',
        '}',
      ].join('\n'),
    );
    expect(violations.map((item) => item.rule)).toEqual(['R4', 'R4', 'R4', 'R4', 'R4', 'R4']);
  });

  it('R4 放行单位正确写法：时长 ms / 长度 px / 无单位族裸数字 / 字距 em / 非数值令牌', () => {
    const violations = scanText(
      'packages/ui/src/tokens.css',
      [
        ':root {',
        '  --dfg-duration-fast: 150ms;',
        '  --dfg-space-0: 0px;',
        '  --dfg-space-2: 8px;',
        '  --dfg-font-weight-regular: 400;',
        '  --dfg-line-height-base: 1.4;',
        '  --dfg-z-modal: 1200;',
        '  --dfg-letter-spacing-tight: -0.01em;',
        '  --dfg-font-sans: "Noto Sans SC", ui-sans-serif, sans-serif;',
        '  --dfg-color-primary: #0d99ff;',
        '  --dfg-shadow-md: 0 4px 12px rgba(0, 0, 0, 0.12);',
        '  --dfg-easing-standard: cubic-bezier(0.2, 0, 0, 1);',
        '}',
      ].join('\n'),
    );
    expect(violations).toEqual([]);
  });

  it('R1-R3 对令牌定义文件仍豁免（px/色值在落盘件合法），R4 照查', () => {
    const violations = scanText(
      'packages/ui/src/tokens.css',
      ':root {\n  --dfg-color-primary: #0d99ff;\n  --dfg-duration-fast: 150px;\n}\n',
    );
    // 只有 R4 报时长单位：R1 不因 #0d99ff 报、R2 不因落盘 px 报
    expect(violations.map((item) => item.rule)).toEqual(['R4']);
  });

  it('R4 对任意扫描文件里重新声明的 --dfg-* 生效；注释与示例文本不误报', () => {
    const declared = scanText(
      'apps/web/src/app/globals.css',
      ':root {\n  --dfg-duration-fast: 0.2s;\n}\n',
    );
    expect(declared.map((item) => `${item.rule}:${item.text}`)).toEqual([
      'R4:--dfg-duration-fast: 0.2s',
    ]);

    const documented = scanText(
      'apps/web/src/a.ts',
      '// 示例：var(--dfg-duration-fast) 或 { --dfg-duration-fast: 150px } 均为说明文本\n',
    );
    expect(documented).toEqual([]);
  });

  it('scanRoots：tokens.css 仍记入白名单跳过（R1-R3 豁免），但 R4 违规照报', () => {
    const root = join(process.cwd(), 'node_modules', '.cache', 'guard-tokens-units-fixture');
    rmSync(root, { recursive: true, force: true });
    mkdirSync(join(root, 'packages/ui/src'), { recursive: true });
    writeFileSync(
      join(root, 'packages/ui/src/tokens.css'),
      ':root {\n  --dfg-duration-fast: 150px;\n}\n',
    );

    const result = scanRoots(root, ['packages/ui/src']);
    expect(result.violations.map((item) => `${item.file}:${item.rule}`)).toEqual([
      'packages/ui/src/tokens.css:R4',
    ]);
    expect(result.skipped.map((item) => item.file)).toEqual(['packages/ui/src/tokens.css']);
    expect(result.skipped[0]?.reason).toContain('R4');
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

  it('扫描扩展名含 .svg（复核 J7：静态 SVG 的裸色值不得从扫描面漏走）', () => {
    expect(SCAN_EXTENSIONS).toContain('.svg');
  });

  it('SVG 里的裸色值被抓；行内登记例外（同行 guard-tokens:allow）则放行', () => {
    const bare = scanText(
      'apps/web/src/app/icon.svg',
      '<rect width="32" height="32" fill="#0d99ff" />\n',
    );
    expect(bare.map((item) => `${item.rule}:${item.text}`)).toEqual(['R1:#0d99ff']);

    const registered = scanText(
      'apps/web/src/app/icon.svg',
      '<rect width="32" height="32" fill="#0d99ff" /> <!-- guard-tokens:allow 静态 favicon 无令牌运行时 -->\n',
    );
    expect(registered).toEqual([]);
  });
});
