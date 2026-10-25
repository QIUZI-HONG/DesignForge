// @vitest-environment node
/**
 * 样式单轨守卫（工单 06 立规 · 豁免登记表常驻于 docs/quality）。
 *
 * 两件事：
 * 1. **无内联样式对象文件**——`features/**` 下不得再有 `styles.ts` / `*-styles.ts`
 *   （工单 06 已把八组内联样式对象全部收敛为域内 CSS + 类名；新样式只能进 `.css`，
 *    由 guard:tokens 与组件测试同轨约束）；
 * 2. **内联 `style={` 逐条对表**——扫描 `apps/web/src` 非测试源码的全部 `style={` 出现点，
 *    每个文件都必须登记在豁免登记表（**常驻真源**
 *    `docs/quality/style-single-track-registry-v1.md`——2026-10 修复批自工单 06 迁出，
 *    工单树随批次归档而登记是长期口径；测试解析该文件表格首列）。
 *    本测试只保证「代码面与登记表双向一致」：
 *    代码里冒出未登记的内联样式 → 红；登记表指向已不再有内联样式的文件 → 红。
 *
 * guard:tokens 覆盖确认（验收 §1 的「两轨同等约束」）：域内 CSS 落在 `apps/web/src` 下，
 * `guard-tokens-core.mjs` 的 `DEFAULT_ROOTS` 含该根、`SCAN_EXTENSIONS` 含 `.css`——
 * 对本仓新 CSS 文件的 R1-R4 约束在此做文本级锁定（行为级断言由
 * `packages/ui/src/tools/guard-tokens-core.test.ts` 就近覆盖，本测试不跨包引 `.mjs`）。
 * 先例：`features/market/state-coverage.test.ts`（读真实源码文件逐字断言，不 mock）。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

/** 仓库根（vitest cwd = apps/web）。 */
const repoRoot = resolve(process.cwd(), '../..');
/** 应用层源码根。 */
const webSrcRoot = resolve(process.cwd(), 'src');
/** 豁免登记表（常驻真源；原载工单 06，2026-10 修复批迁 docs/quality）。 */
const registryPath = resolve(repoRoot, 'docs/quality/style-single-track-registry-v1.md');

/** 递归收集源码文件（.ts/.tsx；跳过测试与无关目录）。 */
function collectSourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) continue;
      out.push(abs);
    }
  };
  walk(root);
  return out.sort();
}

/** 解析豁免登记表（docs/quality/style-single-track-registry-v1.md）的首列路径集合（`| apps/web/src/… | 类别 | 理由 |`）。 */
function registeredExemptionPaths(): Set<string> {
  const text = readFileSync(registryPath, 'utf8');
  const paths = new Set<string>();
  for (const line of text.split('\n')) {
    const match = /^\|\s*(apps\/web\/src\/[^\s|]+)\s*\|/.exec(line);
    if (match?.[1] !== undefined) paths.add(match[1]);
  }
  return paths;
}

/** 仓库相对路径（`/` 分隔）。 */
function relOf(absPath: string): string {
  return relative(repoRoot, absPath).split(sep).join('/');
}

describe('样式单轨 · 无内联样式对象文件', () => {
  it('apps/web/src 下不再有 styles.ts / *-styles.ts（单轨化已收敛为域内 CSS）', () => {
    const offenders = collectSourceFiles(webSrcRoot).filter((abs) =>
      /(^|[/\\-])styles\.tsx?$/.test(abs),
    );
    expect(
      offenders.map(relOf),
      '仍存在内联样式对象文件——应迁移为域内 CSS + 类名（样式单轨口径）',
    ).toEqual([]);
  });
});

describe('样式单轨 · 内联 style 逐条对豁免登记表', () => {
  it('登记表非空且每行指向真实存在的文件（防「登记表是空话」）', () => {
    const registry = registeredExemptionPaths();
    expect(registry.size, '豁免登记表为空——几何/动态值场景必须逐条登记').toBeGreaterThan(0);
    const missing = [...registry].filter((rel) => !existsSync(join(repoRoot, rel)));
    expect(missing, '登记表指向不存在的文件').toEqual([]);
  });

  it('源码里的 style={ 全部落在登记表内（未登记的内联样式即违规）', () => {
    const registry = registeredExemptionPaths();
    const hits = collectSourceFiles(webSrcRoot)
      .filter((abs) => readFileSync(abs, 'utf8').includes('style={'))
      .map(relOf);
    // 扫描器自身不能静默失效：本仓至少保留几何/动态值豁免场景
    expect(hits.length, '未扫到任何 style={ ——扫描面可能失真，请核对').toBeGreaterThan(0);
    const unregistered = hits.filter((rel) => !registry.has(rel));
    expect(
      unregistered,
      '存在未登记的内联样式：迁域内 CSS，或在 docs/quality/style-single-track-registry-v1.md 逐条登记理由',
    ).toEqual([]);
  });

  it('登记表每行仍与代码面对应（文件里已无 style={ 就该撤销登记）', () => {
    const registry = registeredExemptionPaths();
    const hits = new Set(
      collectSourceFiles(webSrcRoot)
        .filter((abs) => readFileSync(abs, 'utf8').includes('style={'))
        .map(relOf),
    );
    const stale = [...registry].filter((rel) => !hits.has(rel));
    expect(stale, '登记表条目已无对应内联样式——撤销登记，保持登记表与代码面一致').toEqual([]);
  });
});

describe('样式单轨 · guard:tokens 对域内 CSS 同权覆盖（文本级锁定）', () => {
  const guardCore = readFileSync(
    resolve(repoRoot, 'packages/ui/src/tools/guard-tokens-core.mjs'),
    'utf8',
  );

  it('扫描根含 apps/web/src、扫描扩展名含 .css（新域内 CSS 自动受 R1-R4 约束）', () => {
    expect(guardCore).toContain("DEFAULT_ROOTS = ['apps/web/src', 'packages/ui/src']");
    expect(guardCore).toContain("'.css'");
  });

  it('域内 CSS 真实存在于被扫描根下（ai/image/mcp/diagnostics/panels/review/market/settings/design）', () => {
    const domainCss = [
      'apps/web/src/features/ai/components/ai.css',
      'apps/web/src/features/image/components/image.css',
      'apps/web/src/features/mcp/components/mcp.css',
      'apps/web/src/features/diagnostics/components/diagnostics.css',
      'apps/web/src/features/editor-panels/editor-panels.css',
      'apps/web/src/features/editor-review/review.css',
      'apps/web/src/features/market/market.css',
      'apps/web/src/features/settings/components/settings.css',
      'apps/web/src/app/_design/design.css',
    ];
    const missing = domainCss.filter((rel) => !existsSync(join(repoRoot, rel)));
    expect(missing, '域内 CSS 缺失').toEqual([]);
  });
});
