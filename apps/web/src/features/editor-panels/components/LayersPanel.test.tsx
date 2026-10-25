// @vitest-environment jsdom
/**
 * 图层面板组件测试（RW-13 · Tree 接入版；seam：面板对外可观测的行为）。
 *
 * 断言口径：读文档 / 读选择集 / 读 aria 语义与 Tree 行挂点（`data-node-id`）；
 * 不碰面板内部实现。树控件自身的键盘漫游/开合语义归 packages/ui 的 tree.test.tsx，
 * 这里只测**面板接线**：文档树映射、双向选中同步（含滚动定位与折叠展开链）、
 * 重命名落命令、拖拽落位约定落命令（含跨父 reparent）、行级状态（实例虚节点禁用）、
 * 千级图层的渲染窗口化（零依赖：全量挂载 + content-visibility 跳过屏外行渲染）。
 *
 * 样式单轨（工单 06）：External CSS 在 jsdom 不计算，样式断言走「类挂载 + CSS 规则文本」
 * （先例 verify/a11y-keyboard.test.tsx）。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  createInstance,
  createRect,
  getChildrenIds,
  getNode,
  getPage,
  insertNode,
  type ScenePage,
} from '@dforge/engine';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { setLockedCommands } from '../commands/layer-commands';
import {
  createFixtureSession,
  manyLayersDocument,
  panelsFixture,
  ROW_HEIGHT,
  stubRowRects,
} from '../test-utils';
import { LayersPanel } from './LayersPanel';
import { PanelsProvider } from './panels-context';

/** 读域内 CSS 文本并截取某个规则块（jsdom 不计算 External CSS）。 */
function cssRule(cssPath: string, selector: string): string {
  const css = readFileSync(resolve(process.cwd(), cssPath), 'utf8');
  const at = css.indexOf(`${selector} {`);
  expect(at, `${cssPath} 缺少 ${selector} 规则`).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf('}', at));
}

/** 渲染图层面板（夹具会话）。 */
function renderPanel(options: { loading?: boolean; error?: string | null } = {}) {
  return renderPanelDoc(panelsFixture(), options);
}

/** 渲染图层面板（给定文档）。 */
function renderPanelDoc(
  document: ReturnType<typeof panelsFixture>,
  options: { loading?: boolean; error?: string | null } = {},
) {
  const session = createFixtureSession(document);
  render(
    <PanelsProvider session={session}>
      <LayersPanel {...options} />
    </PanelsProvider>,
  );
  const page = (): ScenePage => getPage(session.stack.document, session.pageId);
  return { session, page };
}

const row = (name: string) => screen.getByRole('treeitem', { name });
const nodeRow = (id: string) => document.querySelector(`[data-node-id="${id}"]`);
const toggleOf = (name: string): HTMLElement => {
  const toggle = row(name).querySelector('.dfg-tree__toggle');
  expect(toggle, `${name} 缺少展开钮`).not.toBeNull();
  return toggle as HTMLElement;
};

/** 记录 scrollIntoView 的调用目标（jsdom 不实现该方法，测试自备桩）。 */
let scrolledIds: string[];
function stubScrollIntoView(): void {
  scrolledIds = [];
  (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView = function scrollIntoViewStub(
    this: Element,
  ) {
    scrolledIds.push((this as HTMLElement).dataset['nodeId'] ?? '');
  };
}
const restoreScrollIntoView = (): void => {
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
};

/** Tree 拖拽序列：dragStart(source) → 记录指针 Y（document dragover）→ drop(target)。 */
function dragOnto(sourceName: string, targetId: string, clientY?: number): void {
  fireEvent.dragStart(row(sourceName));
  if (clientY !== undefined) {
    document.dispatchEvent(new MouseEvent('dragover', { clientY, bubbles: true }));
  }
  fireEvent.drop(nodeRow(targetId) as Element);
}

afterEach(() => {
  restoreScrollIntoView();
});

describe('图层面板 · 树渲染（Tree 接入）', () => {
  it('渲染层级树：同级逆绘制顺序、子行紧随父行、深度进 aria-level', () => {
    renderPanel();
    const items = screen.getAllByRole('treeitem');
    expect(items.map((item) => item.getAttribute('data-node-id'))).toEqual([
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
    // 容器带展开态语义，叶子不带
    expect(row('首屏').getAttribute('aria-expanded')).toBe('true');
    expect(row('卡片').hasAttribute('aria-expanded')).toBe(false);
    // 树容器取样挂点：全量节点数（门禁用，与折叠态无关；挂在面板树容器上）
    expect(document.querySelector('[data-df-layer-count]')?.getAttribute('data-df-layer-count')).toBe(
      '8',
    );
  });

  it('类型图标挂点：行内 icon 槽渲染类型图标（组件族落 data-df-layer-type 供 CSS 着色）', () => {
    renderPanel();
    expect(nodeRow('c1')?.querySelector('[data-df-layer-type="component"]')).not.toBeNull();
    expect(nodeRow('r2')?.querySelector('[data-df-layer-type="rect"]')).not.toBeNull();
  });

  it('展开/收起：点箭头后子行消失，折叠集进 UI store，再点回来', () => {
    const { session } = renderPanel();
    fireEvent.click(toggleOf('首屏'));
    expect(screen.queryByRole('treeitem', { name: /^标题组$/ })).toBeNull();
    expect(session.ui.getState().collapsedIds.has('f1')).toBe(true);

    fireEvent.click(toggleOf('首屏'));
    expect(screen.queryByRole('treeitem', { name: /^标题组$/ })).not.toBeNull();
  });

  it('空画板不可开合（叶子语义：无子行就没有展开钮）', () => {
    renderPanel();
    expect(nodeRow('f2')?.querySelector('.dfg-tree__toggle')).toBeNull();
  });
});

describe('图层面板 · 选中双向联动（单选）', () => {
  it('面板点选 → 选择集更新（画布同源读同一 store），行高亮', () => {
    const { session } = renderPanel();
    fireEvent.click(row('卡片'));
    expect(session.ui.getState().selection).toEqual({ ids: ['r2'], activeId: 'r2' });
    expect(row('卡片').getAttribute('aria-selected')).toBe('true');
    expect(row('卡片').className).toContain('dfg-tree__node--selected');
    expect(row('背景块').getAttribute('aria-selected')).toBe('false');
  });

  it('画布选中 → 面板高亮跟随 + 行滚动定位（scrollIntoView 落在选中行上）', () => {
    stubScrollIntoView();
    const { session } = renderPanel();
    act(() => {
      session.ui.getState().setSelection({ ids: ['r2'], activeId: 'r2' });
    });
    expect(row('卡片').getAttribute('aria-selected')).toBe('true');
    expect(scrolledIds).toEqual(['r2']);
  });

  it('画布选中折叠容器内的深层节点：面板自动展开祖先链再定位', () => {
    stubScrollIntoView();
    const { session } = renderPanel();
    fireEvent.click(toggleOf('首屏'));
    expect(screen.queryByRole('treeitem', { name: /^标题$/ })).toBeNull();

    act(() => {
      session.ui.getState().setSelection({ ids: ['t1'], activeId: 't1' });
    });
    expect(screen.queryByRole('treeitem', { name: /^标题$/ })).not.toBeNull();
    expect(session.ui.getState().collapsedIds.has('f1')).toBe(false);
    expect(scrolledIds).toEqual(['t1']);
  });
});

describe('图层面板 · 重命名（Tree 行内编辑 → node.update 命令）', () => {
  it('双击进入行内编辑，Enter 提交走命令栈（空白折叠进文档名），Esc 取消不改文档', () => {
    const { session, page } = renderPanel();
    fireEvent.doubleClick(row('卡片'));
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('卡片');
    fireEvent.change(input, { target: { value: '  主卡片  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(getNode(page(), 'r2')?.name).toBe('主卡片');
    expect(session.stack.history().undo.at(-1)).toBe('重命名图层');

    fireEvent.doubleClick(row('主卡片'));
    const cancelInput = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(cancelInput, { target: { value: '不该生效' } });
    fireEvent.keyDown(cancelInput, { key: 'Escape' });
    expect(getNode(page(), 'r2')?.name).toBe('主卡片');
  });

  it('同名提交不产生历史（Tree 侧把关，无命令即无事务）', () => {
    const { session } = renderPanel();
    fireEvent.doubleClick(row('卡片'));
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '卡片' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(session.stack.history().undo).toHaveLength(0);
  });

  it('F2 也能进入重命名（Tree 键盘入口经面板接线开放）', () => {
    renderPanel();
    row('卡片').focus();
    fireEvent.keyDown(row('卡片'), { key: 'F2' });
    expect(screen.getByRole('textbox')).toBeTruthy();
  });
});

describe('图层面板 · 拖拽落位约定（RW-13：上/下各半；跨父 = reparent）', () => {
  it('同父重排：背景块落到「标题组」下半 → 移到同级末尾，世界位置不变', () => {
    const restore = stubRowRects();
    try {
      const { session, page } = renderPanel();
      // g1 在可见行序 4：行带 [112, 140]，130 在下半
      dragOnto('背景块', 'g1', 4 * ROW_HEIGHT + 18);
      expect(getChildrenIds(page(), 'f1')).toEqual(['r2', 'g1', 'r1']);
      expect(getNode(page(), 'r1')?.x).toBe(0);
      expect(session.stack.history().undo.at(-1)).toBe('移动图层');
    } finally {
      restore();
    }
  });

  it('跨父拖拽 = reparent：卡片落到第二屏的子行下半 → 改父进第二屏，世界位置保持', () => {
    const restore = stubRowRects();
    try {
      let doc = panelsFixture();
      doc = insertNode(
        doc,
        'p1',
        createRect({ id: 'f2c1', name: '第二屏内容', x: 400, width: 20, height: 20 }),
        'f2',
      );
      const { session, page } = renderPanelDoc(doc);
      // 可见行序：c1(0) cr1(1) f2(2) f2c1(3) f1(4) g1(5) t1(6) r2(7) r1(8)；f2c1 行带 [84,112]
      dragOnto('卡片', 'f2c1', 3 * ROW_HEIGHT + 24);
      expect(getChildrenIds(page(), 'f2')).toEqual(['f2c1', 'r2']);
      expect(getChildrenIds(page(), 'f1')).toEqual(['r1', 'g1']);
      // r2 世界位置 (70,0) → f2 局部 (70-400, 0)：保持世界位置的改父语义
      expect(getNode(page(), 'r2')?.x).toBe(70 - 400);
      expect(session.stack.history().undo.at(-1)).toBe('移动图层');
    } finally {
      restore();
    }
  });

  it('落回原位 = 无操作：不产生历史条目（CommandStack 合并语义不被空事务污染）', () => {
    const restore = stubRowRects();
    try {
      const { session, page } = renderPanel();
      // r1 在 f1 同级第 0 位；落到 r2 行上半 = 插到 index 0 = 原位
      dragOnto('背景块', 'r2', 6 * ROW_HEIGHT + 6);
      expect(getChildrenIds(page(), 'f1')).toEqual(['r1', 'r2', 'g1']);
      expect(session.stack.history().undo).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it('落进自身子树 = 无操作：不发命令、文档不变', () => {
    const restore = stubRowRects();
    try {
      const { session, page } = renderPanel();
      dragOnto('首屏', '标题', 5 * ROW_HEIGHT + 14);
      expect(getChildrenIds(page(), 'f1')).toEqual(['r1', 'r2', 'g1']);
      expect(session.stack.history().undo).toHaveLength(0);
    } finally {
      restore();
    }
  });
});

describe('图层面板 · 右键菜单（结构操作；重命名归行内编辑）', () => {
  it('五个条目齐备（无重命名条目），点「删除」真的删掉（并进撤销栈）', () => {
    const { session, page } = renderPanel();
    fireEvent.contextMenu(row('卡片'));
    const menu = screen.getByRole('menu');
    for (const label of ['删除', '编组', '解组', '上移到顶', '下移到底']) {
      expect(
        screen
          .getAllByRole('menuitem')
          .some((item) => new RegExp(label).test(item.textContent ?? '')),
        `缺少菜单条目：${label}`,
      ).toBe(true);
    }
    expect(screen.getAllByRole('menuitem')).toHaveLength(5);
    expect(menu).toBeTruthy();
    // 右键未选中的行先把它选上（Figma 语义）
    expect(session.ui.getState().selection.ids).toEqual(['r2']);

    fireEvent.click(screen.getByRole('menuitem', { name: /删除/ }));
    expect(getNode(page(), 'r2')).toBeUndefined();
    expect(getChildrenIds(page(), 'f1')).toEqual(['r1', 'g1']);
    session.stack.undo();
    expect(getNode(page(), 'r2')).not.toBeUndefined();
  });
});

describe('图层面板 · 行级状态（Tree 六态消费）', () => {
  it('实例子树的虚节点行：aria-disabled、不可选中、不进重命名、不可拖拽（结构只读）', () => {
    let doc = panelsFixture();
    doc = insertNode(
      doc,
      'p1',
      createInstance({ id: 'i1', name: '按钮实例', componentId: 'c1', x: 0, y: 500 }),
      null,
    );
    const { session } = renderPanelDoc(doc);
    const virtualChild = getChildrenIds(getPage(session.stack.document, session.pageId), 'i1')[0];
    const virtualRow = nodeRow(virtualChild);
    expect(virtualRow?.getAttribute('aria-disabled')).toBe('true');

    fireEvent.click(virtualRow as Element);
    expect(session.ui.getState().selection.ids).toEqual([]);
    fireEvent.doubleClick(virtualRow as Element);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(virtualRow?.getAttribute('draggable')).toBe('false');
  });

  it('祖先锁定的行仍可选中（锁定只禁结构按钮——禁用态是结构只读，不是锁定）', () => {
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
    fireEvent.click(row('卡片'));
    expect(session.ui.getState().selection.ids).toEqual(['r2']);
  });

  // 行级 loading / error 在同步命令栈文档下不产生（无异步子树装载），
  // Tree 的对应挂点保持透传（不给 onRetry 即关闭错误行入口），留给后续异步装载票。
});

describe('图层面板 · 千级图层与渲染窗口化（零依赖）', () => {
  it('1000 图层：全量行挂载（结构完整），渲染窗口交给浏览器 content-visibility', () => {
    const session = createFixtureSession(manyLayersDocument(1000));
    render(
      <PanelsProvider session={session}>
        <LayersPanel />
      </PanelsProvider>,
    );
    expect(screen.getAllByRole('treeitem')).toHaveLength(1000);
    expect(document.querySelector('[data-df-layer-count]')?.getAttribute('data-df-layer-count')).toBe(
      '1000',
    );
  });

  it('窗口化规则文本：面板树行声明 content-visibility 与 contain-intrinsic-size（行高令牌）', () => {
    renderPanel();
    const rule = cssRule(
      'src/features/editor-panels/editor-panels.css',
      '.dfg-panels__tree .dfg-tree__node',
    );
    expect(rule).toContain('content-visibility: auto');
    expect(rule).toContain('contain-intrinsic-size: auto var(--dfg-row-height-md)');
  });
});

describe('图层面板 · 面板壳状态（沿用验收 §5 挂点）', () => {
  it('空态：空文档给空态挂点与文案（Tree 空树插槽）', () => {
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
});
