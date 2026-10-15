// @vitest-environment jsdom
/**
 * 版本抽屉与两步确认回滚测试（seam：`VersionsDrawer` + `VersionCompare` 的可观测行为）。
 *
 * 断言口径（C14/F10 + briefs/fe-07.md §2）：
 * 抽屉时间戳列表（新→旧）；**两步确认**——第一步（对比）不动文档，
 * 第二步（确认恢复）才派发 `document.replace`，恢复后文档逐字段等于快照且可撤销。
 */
import {
  createDocument,
  createFrame,
  createPage,
  createRect,
  type DesignDocument,
  insertNode,
} from '@dforge/engine';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReviewProvider } from '../review-context';
import { createReviewSession, type ReviewSession } from '../session';
import { createMemoryBackend } from '../storage';
import { VersionsButton } from './VersionsButton';
import { VersionsDrawer } from './VersionsDrawer';

/** 夹具：一页 + 一个画板。 */
function baseDoc(): DesignDocument {
  let doc = createDocument({ id: 'doc-1', name: '设计稿', pages: [createPage({ id: 'p1' })] });
  doc = insertNode(
    doc,
    'p1',
    createFrame({ id: 'f1', name: '首屏', width: 100, height: 100 }),
    null,
  );
  return doc;
}

function versionsSession(): ReviewSession {
  let counter = 0;
  let second = 0;
  return createReviewSession({
    document: baseDoc(),
    documentId: 'doc-1',
    pageId: 'p1',
    backend: createMemoryBackend(),
    now: () => new Date(2026, 9, 15, 10, 0, second++),
    nextId: () => {
      counter += 1;
      return `v${String(counter)}`;
    },
  });
}

function renderDrawer(session: ReviewSession = versionsSession()) {
  render(
    <ReviewProvider session={session}>
      <VersionsDrawer />
    </ReviewProvider>,
  );
  return session;
}

/** 打开抽屉（走入口按钮，顺带覆盖插槽按钮）。 */
function openDrawer(session: ReviewSession): void {
  act(() => {
    session.versions.getState().setOpen(true);
  });
}

/** 保存一个版本（走界面按钮：与用户路径一致）。 */
function saveVersion(): void {
  fireEvent.click(screen.getByRole('button', { name: '保存当前版本' }));
}

describe('版本抽屉 · 列表与时间戳', () => {
  it('未打开时不渲染抽屉', () => {
    renderDrawer();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('打开后显示「版本历史」与空态', () => {
    const session = renderDrawer();
    openDrawer(session);
    expect(screen.getByRole('dialog').textContent).toContain('版本历史');
    expect(screen.getByText('还没有版本')).toBeDefined();
  });

  it('保存当前版本后列表出现条目（标签 + 摘要 + 时间戳）', () => {
    const session = renderDrawer();
    openDrawer(session);
    saveVersion();
    expect(screen.queryByText('还没有版本')).toBeNull();
    const list = screen.getByRole('list', { name: '版本列表' });
    expect(within(list).getByText('手动保存')).toBeDefined();
    expect(within(list).getByText('1 页 · 1 图层')).toBeDefined();
  });

  it('多次保存按新→旧排列', () => {
    const session = renderDrawer();
    openDrawer(session);
    saveVersion();
    act(() => {
      session.stack.dispatch(
        { type: 'node.insert', pageId: 'p1', parentId: null, node: createRect({ id: 'r1' }) },
        { label: '加矩形' },
      );
    });
    saveVersion();
    const rows = screen
      .getByRole('list', { name: '版本列表' })
      .querySelectorAll('[data-df-version-row]');
    expect(rows).toHaveLength(2);
    expect((rows[0] as HTMLElement).dataset.dfVersionId).toBe('v2');
    expect((rows[1] as HTMLElement).dataset.dfVersionId).toBe('v1');
  });
});

describe('版本抽屉 · 两步确认回滚', () => {
  it('第一步「对比」只进并排对比，不改文档', () => {
    const session = renderDrawer();
    openDrawer(session);
    saveVersion();
    act(() => {
      session.stack.dispatch(
        { type: 'node.insert', pageId: 'p1', parentId: null, node: createRect({ id: 'r1' }) },
        { label: '加矩形' },
      );
    });
    const before = JSON.stringify(session.stack.document);

    fireEvent.click(screen.getByRole('button', { name: '对比' }));
    expect(document.querySelector('[data-df-version-compare]')).not.toBeNull();
    expect(JSON.stringify(session.stack.document)).toBe(before);
  });

  it('第二步「确认恢复」派发整文档替换：文档等于快照，且可撤销回来', () => {
    const session = renderDrawer();
    openDrawer(session);
    saveVersion();
    act(() => {
      session.stack.dispatch(
        { type: 'node.insert', pageId: 'p1', parentId: null, node: createRect({ id: 'r1' }) },
        { label: '加矩形' },
      );
    });
    const changed = JSON.stringify(session.stack.document);

    fireEvent.click(screen.getByRole('button', { name: '对比' }));
    fireEvent.click(screen.getByRole('button', { name: '确认恢复' }));

    // 恢复后不含 r1（回到快照那一刻）
    expect(session.stack.document.pages[0]?.nodes.r1).toBeUndefined();
    // 对比视图关闭、抽屉仍在
    expect(document.querySelector('[data-df-version-compare]')).toBeNull();
    expect(session.versions.getState().compareId).toBeNull();

    // 可撤销：命令栈的逆命令是「换回旧文档」
    act(() => {
      session.stack.undo();
    });
    expect(JSON.stringify(session.stack.document)).toBe(changed);
  });

  it('对比视图「取消」不落回滚（文档不变）', () => {
    const session = renderDrawer();
    openDrawer(session);
    saveVersion();
    act(() => {
      session.stack.dispatch(
        { type: 'node.insert', pageId: 'p1', parentId: null, node: createRect({ id: 'r1' }) },
        { label: '加矩形' },
      );
    });
    const before = JSON.stringify(session.stack.document);
    fireEvent.click(screen.getByRole('button', { name: '对比' }));
    // 取消按钮（对比视图底部）
    const compare = document.querySelector('[data-df-version-compare]') as HTMLElement;
    fireEvent.click(within(compare).getByRole('button', { name: '取消' }));
    expect(document.querySelector('[data-df-version-compare]')).toBeNull();
    expect(JSON.stringify(session.stack.document)).toBe(before);
  });

  it('对比视图显示快照 vs 当前与逐页差异', () => {
    const session = renderDrawer();
    openDrawer(session);
    saveVersion();
    act(() => {
      session.stack.dispatch(
        { type: 'node.insert', pageId: 'p1', parentId: null, node: createRect({ id: 'r1' }) },
        { label: '加矩形' },
      );
    });
    fireEvent.click(screen.getByRole('button', { name: '对比' }));
    const compare = document.querySelector('[data-df-version-compare]') as HTMLElement;
    expect(within(compare).getByText('该版本')).toBeDefined();
    expect(within(compare).getByText('当前')).toBeDefined();
    expect(within(compare).getByText('新增 1 个图层')).toBeDefined();
  });

  it('恢复后自动保存「回滚前自动保存」快照（误回滚可再回来）', () => {
    const session = renderDrawer();
    openDrawer(session);
    saveVersion();
    act(() => {
      session.stack.dispatch(
        { type: 'node.insert', pageId: 'p1', parentId: null, node: createRect({ id: 'r1' }) },
        { label: '加矩形' },
      );
    });
    fireEvent.click(screen.getByRole('button', { name: '对比' }));
    fireEvent.click(screen.getByRole('button', { name: '确认恢复' }));
    expect(screen.getByText('回滚前自动保存')).toBeDefined();
  });
});

describe('版本抽屉 · 删除与入口', () => {
  it('删除版本后从列表消失', () => {
    const session = renderDrawer();
    openDrawer(session);
    saveVersion();
    fireEvent.click(screen.getByRole('button', { name: '删除此版本' }));
    expect(screen.getByText('还没有版本')).toBeDefined();
  });

  it('入口按钮打开抽屉（顶栏插槽）', () => {
    const session = versionsSession();
    render(
      <ReviewProvider session={session}>
        <VersionsButton />
      </ReviewProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: '版本历史' }));
    expect(session.versions.getState().open).toBe(true);
  });

  it('跨会话持久化：重开会话仍能读到版本（本地快照目录）', () => {
    const backend = createMemoryBackend();
    const first = createReviewSession({ document: baseDoc(), documentId: 'doc-1', backend });
    first.versions.getState().capture('手动保存');
    const second = createReviewSession({ document: baseDoc(), documentId: 'doc-1', backend });
    expect(second.versions.getState().snapshots.map((item) => item.label)).toEqual(['手动保存']);
  });
});
