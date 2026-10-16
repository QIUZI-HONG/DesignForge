/**
 * 验证线 · 风险点 2/3 交叉：内容取回预算的分配对抗（design-system 根饿死）。
 *
 * 背景（真批次实证，只读核对 `~/df-evidence/mk-05/batch/data`）：
 *   - DWD：design-system 153 条，**全部** digest_status=incomplete-content；
 *   - ODS：`nexu-io/open-design` 记录 requestUrls 里 `/contents/design-systems/` 请求数 = 0，
 *     该根 4015 个文件已知 sha = 0；
 *   - 索引：344 卡片里 design-system = 0（被 index 的 digest 硬门槛全量挡下）。
 *
 * 本文件用**合成夹具**把机制钉死为可复现的最小案例：预算 48 时，凡是根规模 > 预算一半（24）
 * 的资产根，在有「小根」竞争时会被系统性饿死（组份额装不下 → 兜底装填只挑装得下的小根）。
 */

import { describe, expect, it } from 'vitest';
import { selectContentPaths } from '../collect/run.ts';
import type { TreeEntry } from '../collect/types.ts';

const blob = (path: string, size = 100): TreeEntry => ({
  path,
  type: 'blob',
  sha: 'x'.repeat(40),
  size,
});

/** 造仓：一个 42 文件的 design-system 根（DESIGN.md + 41 个 css）+ 50 个单文件 skill 根。 */
function competingTree(): TreeEntry[] {
  const tree: TreeEntry[] = [blob('design-systems/brand/DESIGN.md')];
  for (let i = 0; i < 41; i += 1) {
    tree.push(blob(`design-systems/brand/style${String(i).padStart(2, '0')}.css`));
  }
  for (let i = 0; i < 50; i += 1) tree.push(blob(`skills/s${i}/SKILL.md`));
  return tree;
}

describe('内容预算分配（selectContentPaths）对抗', () => {
  it('基线：DS 根规模 ≤ 预算一半时能整根取回（24 文件 / 预算 48 → 24 取回）', () => {
    const tree: TreeEntry[] = [blob('design-systems/brand/DESIGN.md')];
    for (let i = 0; i < 23; i += 1) tree.push(blob(`design-systems/brand/style${i}.css`));
    for (let i = 0; i < 50; i += 1) tree.push(blob(`skills/s${i}/SKILL.md`));

    const { selected } = selectContentPaths(tree, 48);
    const ds = selected.filter((p) => p.startsWith('design-systems/'));
    expect(ds).toHaveLength(24);
  });

  it('[发现] 资产根 > 预算一半且存在小根竞争：该根被系统性饿死（0 文件取回）', () => {
    const { selected, deferred } = selectContentPaths(competingTree(), 48);
    const dsSelected = selected.filter((p) => p.startsWith('design-systems/'));

    // 真批次口径：nexu-io/open-design 的 153 个 design-system 资产根一个文件都没取回
    // （ODS requestUrls 里 /contents/design-systems/ = 0）；合成夹具同样复现：
    // 组份额上限 = budget/2 = 24 < 根规模 42 → 组内装填立刻 break；兜底装填只挑装得下的
    // 单文件 skill 根（50 个）→ 预算耗尽，DS 根一个文件都取不到 → digest 恒 incomplete →
    // index 的 digest 硬门槛把整类卡片挡在市场之外。
    expect(
      dsSelected.length,
      `预算 48：DS 根取回 ${dsSelected.length} 个文件（deferred=${deferred.filter((p) => p.startsWith('design-systems/')).length}）；` +
        `选中的 50 个名额全部给了单文件 skill 根`,
    ).toBeGreaterThan(0);
  });

  it('[发现] 无竞争时（仓内只有该大根）：整根装不下 → 只取回 1 个结构件（digest 仍不完备）', () => {
    const tree = competingTree().filter((entry) => entry.path.startsWith('design-systems/'));
    const { selected } = selectContentPaths(tree, 20);
    // 预算 20 < 根规模 42：整根装填失败 → 兜底也不装 → 最后只按优先级补了 1 个文件（DESIGN.md）。
    // digest 需要根内全部文件的 sha256（§1.6），取回 1 个文件与取回 0 个文件对卡片而言等价：
    // 都出不了 digest。差异不在「能否出卡」，而在「有没有显式上报预算不足」。
    expect(selected).toHaveLength(1);
  });
});
