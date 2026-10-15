/**
 * 空态判定测试（FE-02 · B7）。
 *
 * 三种空态各有各的出口动作（新建 / 清除筛选 / 返回本地文档），判定错了用户就被指到死路上。
 */
import { describe, expect, it } from 'vitest';

import { resolveEmptyKind } from './empty-kind';

describe('resolveEmptyKind', () => {
  it('回收站分区 → trash（无论库里有多少文档）', () => {
    expect(
      resolveEmptyKind({ inTrash: true, totalDocuments: 5, visibleCount: 0, filtered: false }),
    ).toBe('trash');
  });

  it('库里没有文件 → documents（引导新建，而不是让他清筛选）', () => {
    expect(
      resolveEmptyKind({ inTrash: false, totalDocuments: 0, visibleCount: 0, filtered: false }),
    ).toBe('documents');
  });

  it('有文件但被搜索挡掉 → search（引导清筛选）', () => {
    expect(
      resolveEmptyKind({ inTrash: false, totalDocuments: 3, visibleCount: 0, filtered: true }),
    ).toBe('search');
  });

  it('有文件、无筛选、却空 → 仍归 documents（异常输入不指向死路）', () => {
    expect(
      resolveEmptyKind({ inTrash: false, totalDocuments: 3, visibleCount: 0, filtered: false }),
    ).toBe('documents');
  });
});
