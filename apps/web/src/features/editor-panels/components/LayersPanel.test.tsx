// @vitest-environment jsdom
/**
 * 图层面板组件测试（seam：面板对外可观测的行为——DOM 语义、文档变更、选择联动）。
 *
 * 断言口径：能通过「读文档 / 读选择集 / 读 aria 语义」观察到的东西；
 * 不碰内部实现（行内 state 只通过 `data-df-state` 这类**对外挂点**呈现，那本来就是门禁取样契约）。
 */
import { getChildrenIds, getNode, getPage, type ScenePage } from '@dforge/engine';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { setLockedCommands } from '../commands/layer-commands';
import {
  createFixtureSession,
  manyLayersDocument,
  panelsFixture,
  stubRowRects,
} from '../test-utils';
import { LayersPanel } from './LayersPanel';
import { PanelsProvider } from './panels-context';

/** 渲染图层面板（夹具会话）。 */
function renderPanel(options: { loading?: boolean; error?: string | null } = {}) {
  const session = createFixtureSession();
  render(
    <PanelsProvider session={session}>
      <LayersPanel {...options} />
    </PanelsProvider>,
  );
  const panel = session;
  const page = (): ScenePage => getPage(session.stack.document, session.pageId);
  return { session: panel, page };
}

const row = (name: string) => screen.getByRole('treeitem', { name: new RegExp(`^${name}（`) });

describe('图层面板', () => {
  it('渲染层级树：同级逆绘制顺序、子行紧随父行、深度进 aria-level 与缩进', () => {
    renderPanel();
    const items = screen.getAllByRole('treeitem');
    expect(items.map((item) => item.getAttribute('data-df-layer-row'))).toEqual([
      'c1',
      'cr1',
      'f2',
      'f1',
      'g1',
      't1',
      'r2',
      'r1',
    ]);
    expect(row('首屏').getAttribute('aria-level')).toBe('1');
    expect(row('标题组').getAttribute('aria-level')).toBe('2');
    expect(row('标题').getAttribute('aria-level')).toBe('3');
    // 缩进 = 4 + 12 × 深度（单位来自令牌）
    expect(row('标题组').style.paddingLeft).toContain('var(--dfg-space-3)');
    // 容器带展开态语义，叶子不带
    expect(row('首屏').getAttribute('aria-expanded')).toBe('true');
    expect(row('卡片').hasAttribute('aria-expanded')).toBe(false);
  });

  it('单击行 → 写入选择集并高亮；Shift 点击 → 加选', () => {
    const { session } = renderPanel();
    fireEvent.click(row('卡片'));
    expect(session.ui.getState().selection).toEqual({ ids: ['r2'], activeId: 'r2' });
    expect(row('卡片').getAttribute('data-df-state')).toBe('selected');

    fireEvent.click(row('背景块'), { shiftKey: true });
    expect(session.ui.getState().selection.ids).toEqual(['r2', 'r1']);
  });

  it('画布选择变化 → 面板同源高亮（订阅同一 store）', () => {
    const { session } = renderPanel();
    act(() => {
      session.ui.getState().setSelection({ ids: ['g1'], activeId: 'g1' });
    });
    expect(row('标题组').getAttribute('data-df-state')).toBe('selected');
    expect(row('卡片').getAttribute('data-df-state')).toBe('default');
  });

  it('展开/收起：点箭头后子行消失，再点回来（折叠集进 UI store）', () => {
    const { session } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: '收起「首屏」' }));
    expect(screen.queryByRole('treeitem', { name: /^标题组（/ })).toBeNull();
    expect(session.ui.getState().collapsedIds.has('f1')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '展开「首屏」' }));
    expect(screen.queryByRole('treeitem', { name: /^标题组（/ })).not.toBeNull();
  });

  it('眼睛：切换可见性产生文档变更（走命令栈，撤销可复原）', () => {
    const { session, page } = renderPanel();
    fireEvent.mouseEnter(row('卡片'));
    fireEvent.click(screen.getByRole('button', { name: '隐藏「卡片」' }));
    expect(getNode(page(), 'r2')?.visible).toBe(false);
    expect(session.stack.canUndo).toBe(true);
    session.stack.undo();
    expect(getNode(page(), 'r2')?.visible).toBe(true);
  });

  it('锁：切换锁定产生文档变更', () => {
    const { page } = renderPanel();
    fireEvent.mouseEnter(row('卡片'));
    fireEvent.click(screen.getByRole('button', { name: '锁定「卡片」' }));
    expect(getNode(page(), 'r2')?.locked).toBe(true);
  });

  it('祖先锁定时子行按钮禁用，并给出禁用原因（F15）', () => {
    const session = createFixtureSession();
    session.run(
      setLockedCommands(
        getPage(session.stack.document, session.pageId),
        session.pageId,
        'f1',
        true,
      ),
      '锁定画板',
    );
    render(
      <PanelsProvider session={session}>
        <LayersPanel />
      </PanelsProvider>,
    );
    fireEvent.mouseEnter(row('卡片'));
    const eye = screen.getByRole('button', { name: '隐藏「卡片」' });
    expect((eye as HTMLButtonElement).disabled).toBe(true);
    // 禁用原因经 Tooltip 挂在锚点外层：悬停后出现提示文本
    fireEvent.mouseEnter(eye.parentElement as HTMLElement);
    return waitFor(() => {
      expect(screen.getByRole('tooltip').textContent).toBe('父级已锁定');
    });
  });

  it('双击重命名：Enter 提交走命令栈；Esc 取消不改文档', () => {
    const { session, page } = renderPanel();
    fireEvent.doubleClick(row('卡片'));
    const input = screen.getByLabelText('重命名图层') as HTMLInputElement;
    expect(input.value).toBe('卡片');
    fireEvent.change(input, { target: { value: '  主卡片  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(getNode(page(), 'r2')?.name).toBe('主卡片');
    expect(session.stack.history().undo.at(-1)).toBe('重命名图层');

    fireEvent.doubleClick(row('主卡片'));
    const cancelInput = screen.getByLabelText('重命名图层') as HTMLInputElement;
    fireEvent.change(cancelInput, { target: { value: '不该生效' } });
    fireEvent.keyDown(cancelInput, { key: 'Escape' });
    expect(getNode(page(), 'r2')?.name).toBe('主卡片');
  });

  it('悬停态：行把 hover 投射到 data-df-state（截图门禁的 hover 挂点）', () => {
    renderPanel();
    const target = row('背景块');
    fireEvent.mouseEnter(target);
    expect(target.getAttribute('data-df-state')).toBe('hover');
    fireEvent.mouseLeave(target);
    expect(target.getAttribute('data-df-state')).toBe('default');
  });

  it('右键菜单：六个条目齐备，点「删除」真的删掉（并进撤销栈）', () => {
    const { session, page } = renderPanel();
    fireEvent.contextMenu(row('卡片'), { clientX: 40, clientY: 60 });
    const menu = screen.getByRole('menu');
    for (const label of ['重命名', '删除', '编组', '解组', '上移到顶', '下移到底']) {
      expect(within(menu).getByRole('menuitem', { name: new RegExp(label) })).toBeTruthy();
    }
    // 单选下「编组」置灰（原因由 Tooltip 给）
    expect(within(menu).getByRole('menuitem', { name: /编组/ }).getAttribute('aria-disabled')).toBe(
      'true',
    );
    fireEvent.click(within(menu).getByRole('menuitem', { name: /删除/ }));
    expect(getNode(page(), 'r2')).toBeUndefined();
    expect(getChildrenIds(page(), 'f1')).toEqual(['r1', 'g1']);
    session.stack.undo();
    expect(getNode(page(), 'r2')).not.toBeUndefined();
  });

  it('拖拽同级重排：指针序列 → 落点指示 → 松手后层级更新（r1 移到 g1 之后）', () => {
    const restore = stubRowRects();
    try {
      const { page } = renderPanel();
      const tree = screen.getByRole('tree');
      const dragged = row('背景块');
      // 行序：c1(0) cr1(1) f2(2) f1(3) g1(4) t1(5) r2(6) r1(7)
      fireEvent.pointerDown(dragged, { button: 0, clientY: 7 * 28 + 14 });
      fireEvent.pointerMove(tree, { clientY: 4 * 28 + 26 });
      expect(row('标题组').getAttribute('data-df-drop-indicator')).toBe('bottom');
      fireEvent.pointerUp(tree, { clientY: 4 * 28 + 26 });
      expect(getChildrenIds(page(), 'f1')).toEqual(['r2', 'g1', 'r1']);
      // 世界位置不变（父级仍是 f1）
      expect(getNode(page(), 'r1')?.x).toBe(0);
    } finally {
      restore();
    }
  });

  it('拖拽跨容器：r2 拖进第二屏，保持世界位置', () => {
    const restore = stubRowRects();
    try {
      const { page } = renderPanel();
      const tree = screen.getByRole('tree');
      // f2 在行序 2：拖到其中段 = 放入画板内部
      fireEvent.pointerDown(row('卡片'), { button: 0, clientY: 6 * 28 + 14 });
      fireEvent.pointerMove(tree, { clientY: 2 * 28 + 14 });
      expect(row('第二屏').getAttribute('data-df-drop-indicator')).toBe('inside');
      fireEvent.pointerUp(tree, { clientY: 2 * 28 + 14 });
      expect(getChildrenIds(page(), 'f2')).toEqual(['r2']);
      expect(getChildrenIds(page(), 'f1')).toEqual(['r1', 'g1']);
      // r2 世界位置 (70,0) → f2 局部 (70-400, 0)
      expect(getNode(page(), 'r2')?.x).toBe(70 - 400);
    } finally {
      restore();
    }
  });

  it('空态：空文档给空态挂点与文案', () => {
    const session = createFixtureSession({
      ...panelsFixture(),
      pages: [{ ...getPage(panelsFixture(), 'p1'), nodes: {}, rootIds: [] }],
    });
    render(
      <PanelsProvider session={session}>
        <LayersPanel />
      </PanelsProvider>,
    );
    expect(screen.getByText('还没有图层')).toBeTruthy();
    expect(document.querySelector('[data-df-sample="layers/empty"]')).not.toBeNull();
  });

  it('加载态与错误态：各有取样挂点，错误态带重试按钮', () => {
    const { unmount } = render(
      <PanelsProvider session={createFixtureSession()}>
        <LayersPanel loading />
      </PanelsProvider>,
    );
    expect(document.querySelector('[data-df-sample="layers/loading"]')).not.toBeNull();
    unmount();

    render(
      <PanelsProvider session={createFixtureSession()}>
        <LayersPanel error="本地文档服务不可用" onRetry={() => undefined} />
      </PanelsProvider>,
    );
    expect(document.querySelector('[data-df-sample="layers/error"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
  });

  it('长列表（300 图层）：全部渲染且行样式带 content-visibility（不引重依赖的窗口化替代）', () => {
    const session = createFixtureSession(manyLayersDocument(300));
    render(
      <PanelsProvider session={session}>
        <LayersPanel />
      </PanelsProvider>,
    );
    const items = screen.getAllByRole('treeitem');
    expect(items).toHaveLength(300);
    expect((items[0] as HTMLElement).style.contentVisibility).toBe('auto');
    // 行数挂在树容器上（门禁取样用）
    expect(screen.getByRole('tree').getAttribute('data-df-layer-count')).toBe('300');
  });

  it('键盘漫游：↓ 走到下一行，Enter 进重命名，← 收起容器', () => {
    renderPanel();
    const first = row('按钮');
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(document.activeElement?.getAttribute('data-df-layer-row')).toBe('cr1');

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' });
    const onF1 = document.activeElement as HTMLElement;
    expect(onF1.getAttribute('data-df-layer-row')).toBe('f1');
    fireEvent.keyDown(onF1, { key: 'ArrowLeft' });
    expect(row('首屏').getAttribute('aria-expanded')).toBe('false');

    fireEvent.keyDown(row('首屏'), { key: 'Enter' });
    expect(screen.getByLabelText('重命名图层')).toBeTruthy();
  });
});
