/**
 * axe-core 共享入口（#107 · 审计 10a；从审计 04 的一次性脚本抽出）。
 *
 * 为什么不各写一份：axe 的注入方式、WCAG tag 集合与计数口径一旦分叉，
 * 「a11y 通过」在两个门禁之间就不可比。审计 04（#54）与 `audit:a11y` 共用本模块。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** WCAG 2.2 AA 自动化检查使用的 tag 集合（审计 04 口径）。 */
export const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/**
 * 读取 axe-core 注入脚本。
 *
 * @param {string} repoRoot 仓库根（axe-core 是根 devDependency）
 * @returns {string} axe.min.js 内容
 */
export function loadAxeSource(repoRoot) {
  const path = join(repoRoot, 'node_modules', 'axe-core', 'axe.min.js');
  if (!existsSync(path)) throw new Error(`未找到 axe-core：${path}（先 pnpm install）`);
  return readFileSync(path, 'utf8');
}

/**
 * 在页面里注入 axe 并跑 WCAG tag 集合。
 *
 * @param {import('playwright-core').Page} page
 * @param {string} source `loadAxeSource` 的返回值
 * @param {string[]} [tags]
 * @returns {Promise<any>} axe 原始结果（violations + incomplete）
 */
export async function runAxe(page, source, tags = WCAG_TAGS) {
  await page.addScriptTag({ content: source });
  return page.evaluate(
    async (selectedTags) =>
      globalThis.axe.run(document, {
        runOnly: { type: 'tag', values: selectedTags },
        resultTypes: ['violations', 'incomplete'],
      }),
    tags,
  );
}

/** impact → 计数（未知 impact 记 unknown，不静默丢弃）。 */
export function countImpacts(violations) {
  const counts = { critical: 0, serious: 0, moderate: 0, minor: 0, unknown: 0 };
  for (const violation of violations) {
    const impact = violation.impact ?? 'unknown';
    counts[impact] = (counts[impact] ?? 0) + 1;
  }
  return counts;
}
