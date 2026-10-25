/**
 * 对抗性验证 · 风险 6：版本回滚（F10 / C14）
 *
 * 验证口径：
 * - **两步确认是真两步**：第一步（beginCompare）绝不碰文档；
 * - 第二步（confirmRestore）落一条 `document.replace`，撤销栈随之可回退（撤销 → 回滚前；重做 → 回滚后）；
 * - 回滚前自动快照存在（误回滚可再回来）；
 * - **损坏/缺字段快照**：结构校验必须挡住（整体不生效、文档/历史不变、不崩）。
 */
import {
  createDocument as _createDocument,
  CommandStack,
  createDocument,
  createPage,
  createRect,
  isCommandError,
} from '@dforge/engine';
import { describe, expect, it } from 'vitest';
import {
  createMemoryBackend,
  isVersionSnapshot,
  versionsKey,
} from '@/features/editor-review/storage';
import { createSnapshot } from '@/features/editor-review/versions/snapshots';
import { createVersionStore } from '@/features/editor-review/versions/versions-store';

void _createDocument;

/** 有内容的文档（两个矩形）。 */
function makeDocument(name = '当前文档') {
  const rectA = createRect({ id: 'n_a', x: 0, y: 0, width: 10, height: 10 });
  const rectB = createRect({ id: 'n_b', x: 50, y: 50, width: 10, height: 10 });
  const page = createPage({
    id: 'page_1',
    rootIds: ['n_a', 'n_b'],
    nodes: { n_a: rectA, n_b: rectB },
  });
  return createDocument({ id: 'doc_1', name, pages: [page] });
}

/** 建栈 + 版本 store（run 直连命令栈，与宿主接线一致）。 */
function setup(seedSnapshots: unknown[] = []) {
  const stack = new CommandStack(makeDocument());
  const backend = createMemoryBackend({
    [versionsKey('doc_1')]: JSON.stringify(seedSnapshots),
  });
  let counter = 0;
  const store = createVersionStore({
    documentId: 'doc_1',
    getDocument: () => stack.getSnapshot(),
    run: (commands, label) => stack.dispatch([...commands], { label }),
    backend,
    now: () => new Date('2026-01-01T00:00:00.000Z'),
    nextId: () => {
      counter += 1;
      return `ver_${counter}`;
    },
    defaultLabel: '手动保存',
  });
  return { stack, store, backend };
}

/** 造一份「合法但内容不同」的快照。 */
function snapshotOf(stack: CommandStack, id = 'ver_seed') {
  return createSnapshot({
    id,
    createdAt: '2025-12-31T00:00:00.000Z',
    document: stack.getSnapshot(),
    label: '旧版本',
    documentId: 'doc_1',
  });
}

describe('版本回滚 · 两步确认', () => {
  it('第一步 beginCompare：进对比态但绝不改文档、不写历史', () => {
    const { stack, store } = setup([snapshotOf(new CommandStack(makeDocument()))]);
    const before = JSON.stringify(stack.getSnapshot());
    store.getState().beginCompare('ver_seed');
    expect(store.getState().compareId).toBe('ver_seed');
    expect(JSON.stringify(stack.getSnapshot())).toBe(before);
    expect(stack.history().undo).toHaveLength(0);
  });

  it('未进对比态时 confirmRestore 是空操作（两步不可跳过）', () => {
    const { stack, store } = setup([snapshotOf(new CommandStack(makeDocument()))]);
    const before = JSON.stringify(stack.getSnapshot());
    store.getState().confirmRestore();
    expect(JSON.stringify(stack.getSnapshot())).toBe(before);
    expect(stack.history().undo).toHaveLength(0);
  });

  it('第二步 confirmRestore：整文档替换生效（逐字段等于快照），撤销回退、重做复原', () => {
    const stack = new CommandStack(makeDocument('被改过的名字'));
    const oldDoc = makeDocument('旧版本');
    const seeded = createSnapshot({
      id: 'ver_old',
      createdAt: '2025-01-01T00:00:00.000Z',
      document: oldDoc,
      label: '旧版本',
      documentId: 'doc_1',
    });
    const backend = createMemoryBackend({ [versionsKey('doc_1')]: JSON.stringify([seeded]) });
    const store = createVersionStore({
      documentId: 'doc_1',
      getDocument: () => stack.getSnapshot(),
      run: (commands, label) => stack.dispatch([...commands], { label }),
      backend,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
      nextId: () => 'ver_auto',
      defaultLabel: '手动保存',
    });

    const beforeRestore = JSON.stringify(stack.getSnapshot());
    store.getState().beginCompare('ver_old');
    store.getState().confirmRestore('回滚前自动保存');

    // 文档 = 快照（逐字段）
    expect(JSON.stringify(stack.getSnapshot())).toBe(JSON.stringify(oldDoc));
    // 历史 += 1（回滚），且是单条可撤销事务
    expect(stack.history().undo).toHaveLength(1);
    expect(stack.history().undo[0]).toBe('恢复版本');

    // 撤销 → 回滚前；重做 → 快照态
    stack.undo();
    expect(JSON.stringify(stack.getSnapshot())).toBe(beforeRestore);
    stack.redo();
    expect(JSON.stringify(stack.getSnapshot())).toBe(JSON.stringify(oldDoc));
  });

  it('回滚前自动快照：列表 +1 且其内容 = 回滚前文档（误回滚可再回来）', () => {
    const { stack, store } = setup([snapshotOf(new CommandStack(makeDocument()))]);
    const beforeRestore = JSON.stringify(stack.getSnapshot());
    store.getState().beginCompare('ver_seed');
    store.getState().confirmRestore('回滚前自动保存');

    const auto = store.getState().snapshots.find((item) => item.id === 'ver_1');
    expect(auto).toBeDefined();
    expect(JSON.stringify(auto?.document)).toBe(beforeRestore);
    expect(store.getState().snapshots.length).toBe(2);
  });

  it('对比数据以当前文档为基准（改过文档后 diff 显示差异）', () => {
    const { stack, store } = setup([snapshotOf(new CommandStack(makeDocument()))]);
    store.getState().beginCompare('ver_seed');
    const clean = store.getState().diffOf('ver_seed');
    expect(clean?.changed).toBe(false);

    stack.dispatch([{ type: 'node.update', pageId: 'page_1', nodeId: 'n_a', patch: { x: 999 } }], {
      label: '改一下',
    });
    const dirty = store.getState().diffOf('ver_seed');
    expect(dirty?.changed).toBe(true);
    expect(dirty?.nodesChanged).toBe(1);
  });
});

describe('版本回滚 · 损坏 / 缺字段快照', () => {
  /** 绕过形状校验直接注入坏快照（列表 API 与手改 localStorage 都能造出这种数据）。 */
  function corrupt(overrides: Record<string, unknown>): unknown {
    return {
      id: 'ver_bad',
      documentId: 'doc_1',
      label: '坏快照',
      createdAt: '2025-01-01T00:00:00.000Z',
      document: { id: 'doc_bad', pages: [] },
      ...overrides,
    };
  }

  it('形状校验：document 缺 pages / 非对象被挡在加载层（不进列表）', () => {
    expect(isVersionSnapshot(corrupt({}))).toBe(true); // 通过外层校验（pages 是数组）
    expect(isVersionSnapshot(corrupt({ document: { id: 'x' } }))).toBe(false);
    expect(isVersionSnapshot(corrupt({ document: null }))).toBe(false);
    const { store } = setup([corrupt({ document: { id: 'x' } }), 'not-an-object']);
    expect(store.getState().snapshots).toHaveLength(0);
  });

  it('pages 为空数组（过外层校验）：回滚必须整体失败且文档/历史不变', () => {
    const { stack, store } = setup([corrupt({})]);
    expect(store.getState().snapshots).toHaveLength(1);
    const before = JSON.stringify(stack.getSnapshot());
    store.getState().beginCompare('ver_bad');
    expect(() => store.getState().confirmRestore()).toThrow();
    expect(JSON.stringify(stack.getSnapshot())).toBe(before);
    expect(stack.history().undo).toHaveLength(0);
    // 失败后不留在对比态（UI 不会卡在「正在确认」）
    expect(store.getState().compareId).toBeNull();
  });

  it('节点表引用幽灵子节点（缺字段/半坏）：回滚必须整体失败（错误码可诊断）', () => {
    const brokenDoc = {
      id: 'doc_bad',
      name: '坏文档',
      pages: [
        {
          id: 'page_1',
          name: '页面 1',
          rootIds: ['n_ghost_parent'],
          nodes: {
            n_ghost_parent: {
              id: 'n_ghost_parent',
              type: 'frame',
              name: '帧',
              x: 0,
              y: 0,
              width: 10,
              height: 10,
              rotation: 0,
              opacity: 1,
              visible: true,
              locked: false,
              fills: [],
              strokes: [],
              cornerRadius: 0,
              blendMode: 'normal',
              children: ['不存在的子节点'],
              clipsContent: true,
              autoLayout: null,
            },
          },
          backgroundColor: '#ffffff',
          grid: { size: 8, snapToGrid: false, visible: false },
        },
      ],
      tokens: {},
    };
    const { stack, store } = setup([corrupt({ document: brokenDoc })]);
    const before = JSON.stringify(stack.getSnapshot());
    store.getState().beginCompare('ver_bad');
    try {
      store.getState().confirmRestore();
      expect.unreachable('应抛 CommandError');
    } catch (error) {
      expect(isCommandError(error)).toBe(true);
      if (isCommandError(error)) expect(error.code).toBe('invalid-argument');
    }
    expect(JSON.stringify(stack.getSnapshot())).toBe(before);
    expect(stack.history().undo).toHaveLength(0);
  });

  it('对比态指向已被删除的快照：confirmRestore 安全退出（不崩、不改文档）', () => {
    const { stack, store } = setup([snapshotOf(new CommandStack(makeDocument()))]);
    store.getState().beginCompare('ver_seed');
    store.getState().remove('ver_seed');
    expect(store.getState().compareId).toBeNull();
    const before = JSON.stringify(stack.getSnapshot());
    store.getState().confirmRestore();
    expect(JSON.stringify(stack.getSnapshot())).toBe(before);
  });
});
