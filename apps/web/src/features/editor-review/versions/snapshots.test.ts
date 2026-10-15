/**
 * 版本快照与对比测试（seam：`snapshots.ts` 纯函数 + `document.replace` 命令）。
 *
 * 规则来自 C14/F10 与 briefs/fe-07.md §2：列表**新→旧**；对比给出逐页差异；
 * 回滚 = 引擎**整文档替换命令**（施加后文档逐字段等于快照，且可撤销）。
 */
import {
  CommandStack,
  createDocument,
  createFrame,
  createPage,
  createRect,
  type DesignDocument,
  insertNode,
  removeNode,
  setNodeProps,
} from '@dforge/engine';
import { describe, expect, it } from 'vitest';
import {
  appendSnapshot,
  createSnapshot,
  diffDocuments,
  restoreCommands,
  snapshotSummary,
  sortSnapshots,
  type VersionSnapshot,
} from './snapshots';

/** 基线文档：一页 + 画板 f1 ⊃ r1。 */
function baseDoc(): DesignDocument {
  let doc = createDocument({ id: 'doc-1', name: '设计稿', pages: [createPage({ id: 'p1' })] });
  doc = insertNode(doc, 'p1', createFrame({ id: 'f1', width: 100, height: 100 }), null);
  doc = insertNode(doc, 'p1', createRect({ id: 'r1', width: 20, height: 20 }), 'f1');
  return doc;
}

function snapshotOf(id: string, createdAt: string, document: DesignDocument): VersionSnapshot {
  return createSnapshot({ id, document, label: `版本 ${id}`, createdAt });
}

describe('版本快照 · 列表', () => {
  it('按时间倒序排列（新→旧），同时刻按 id 稳定兜底', () => {
    const list = [
      snapshotOf('b', '2026-10-15T10:00:00.000Z', baseDoc()),
      snapshotOf('c', '2026-10-15T12:00:00.000Z', baseDoc()),
      snapshotOf('a', '2026-10-15T10:00:00.000Z', baseDoc()),
    ];
    expect(sortSnapshots(list).map((item) => item.id)).toEqual(['c', 'a', 'b']);
  });

  it('追加后仍是新→旧，且同 id 覆盖不重复', () => {
    const older = snapshotOf('v1', '2026-10-15T10:00:00.000Z', baseDoc());
    const newer = snapshotOf('v2', '2026-10-15T11:00:00.000Z', baseDoc());
    const list = appendSnapshot(appendSnapshot([], older), newer);
    expect(list.map((item) => item.id)).toEqual(['v2', 'v1']);
    const replaced = appendSnapshot(list, { ...older, label: '版本 v1（改名）' });
    expect(replaced).toHaveLength(2);
    expect(replaced.find((item) => item.id === 'v1')?.label).toBe('版本 v1（改名）');
  });

  it('摘要给出页数与节点数（对比面板头部用）', () => {
    const summary = snapshotSummary(snapshotOf('v1', '2026-10-15T10:00:00.000Z', baseDoc()));
    expect(summary).toEqual({ pages: 1, nodes: 2 });
  });
});

describe('版本对比 · diffDocuments', () => {
  it('同一文档：无任何变化', () => {
    const diff = diffDocuments(baseDoc(), baseDoc());
    expect(diff.changed).toBe(false);
    expect(diff.pages.every((page) => page.status === 'unchanged')).toBe(true);
    expect(diff.nodesAdded).toBe(0);
    expect(diff.nodesRemoved).toBe(0);
    expect(diff.nodesChanged).toBe(0);
  });

  it('节点新增/删除/修改分别计数（以当前文档为基准）', () => {
    // 快照 = base；当前 = base 去掉 r1、加 r2、改 f1 名称
    const snapshot = baseDoc();
    let current = insertNode(baseDoc(), 'p1', createRect({ id: 'r2', width: 5, height: 5 }), 'f1');
    current = removeNode(current, 'p1', 'r1');
    current = setNodeProps(current, 'p1', 'f1', { name: '改过的画板' });
    const diff = diffDocuments(snapshot, current);
    expect(diff.changed).toBe(true);
    expect(diff.nodesAdded).toBe(1);
    expect(diff.nodesRemoved).toBe(1);
    expect(diff.nodesChanged).toBe(1);
  });

  it('页面新增/删除体现在页面条目状态与文档级名称/令牌标记', () => {
    const snapshot = baseDoc();
    let current = {
      ...baseDoc(),
      name: '设计稿（改）',
      tokens: { color: { brand: { $type: 'color' as const, $value: '#000000' } } },
    };
    current = {
      ...current,
      pages: [...current.pages, createPage({ id: 'p2', name: '第二页' })],
    };
    const diff = diffDocuments(snapshot, current);
    expect(diff.nameChanged).toBe(true);
    expect(diff.tokensChanged).toBe(true);
    expect(diff.pages.find((page) => page.pageId === 'p2')?.status).toBe('added');
  });

  it('快照独有页面标记为 removed（相对当前文档）', () => {
    let snapshot = baseDoc();
    snapshot = { ...snapshot, pages: [...snapshot.pages, createPage({ id: 'p9', name: '旧页' })] };
    const diff = diffDocuments(snapshot, baseDoc());
    expect(diff.pages.find((page) => page.pageId === 'p9')?.status).toBe('removed');
  });
});

describe('版本回滚 · 整文档替换命令', () => {
  it('restoreCommands 产出 document.replace，施加后文档等于快照且可撤销', () => {
    const snapshot = snapshotOf('v1', '2026-10-15T10:00:00.000Z', baseDoc());
    let current = baseDoc();
    current = insertNode(current, 'p1', createRect({ id: 'r9', width: 1, height: 1 }), null);
    const stack = new CommandStack(current);

    const commands = restoreCommands(snapshot);
    expect(commands.map((command) => command.type)).toEqual(['document.replace']);
    stack.dispatch(commands, { label: '恢复版本' });
    expect(JSON.parse(JSON.stringify(stack.document))).toEqual(
      JSON.parse(JSON.stringify(snapshot.document)),
    );

    stack.undo();
    expect(JSON.parse(JSON.stringify(stack.document))).toEqual(JSON.parse(JSON.stringify(current)));
  });
});
