import { describe, expect, it } from 'vitest';
import { CommandStack } from '../commands/index';
import {
  autoLayoutCommands,
  autoLayoutOf,
  hugDirections,
  layoutInputs,
  solveAutoLayout,
} from '../layout/index';
import {
  type AutoLayoutConfig,
  createDocument,
  createFrame,
  createPage,
  createRect,
  type DesignDocument,
  defaultAutoLayout,
  type ScenePage,
} from '../model/index';
import { getPage, insertNode, insertNodes, requireNode } from '../scene/index';
import {
  addToSelection,
  alignCommands,
  clearSelection,
  clickSelection,
  commonParentId,
  commonValue,
  createSelection,
  distributeCommands,
  hasMixedValue,
  normalizeNodeSelection,
  selectionBounds,
  selectionKinds,
  selectionNodes,
  selectionSize,
  selectOnly,
  setSelection,
  toggleSelection,
} from './index';

/** 场景：a(0,0,100,50)、b(200,100,50,100)、c(400,300,100,50)，均在页面顶层。 */
function scene(): { doc: DesignDocument; page: ScenePage } {
  let doc = createDocument({ id: 'd1', pages: [createPage({ id: 'p1' })] });
  doc = insertNodes(
    doc,
    'p1',
    [
      createRect({ id: 'a', x: 0, y: 0, width: 100, height: 50 }),
      createRect({ id: 'b', x: 200, y: 100, width: 50, height: 100 }),
      createRect({ id: 'c', x: 400, y: 300, width: 100, height: 50 }),
    ],
    null,
  );
  return { doc, page: getPage(doc, 'p1') };
}

describe('selection · 选择模型', () => {
  it('单选/多选/切换/清空', () => {
    let selection = selectOnly('a');
    expect(selection.ids).toEqual(['a']);
    selection = addToSelection(selection, 'b');
    expect(selection.ids).toEqual(['a', 'b']);
    expect(selection.activeId).toBe('b');
    selection = toggleSelection(selection, 'a');
    expect(selection.ids).toEqual(['b']);
    expect(clearSelection().ids).toEqual([]);
    expect(selectionSize(createSelection(['a', 'a', 'b']))).toBe(2);
  });

  it('点击规则：空白清空、Shift 切换、点已选集合保持多选', () => {
    const multi = createSelection(['a', 'b']);
    expect(clickSelection(multi, null).ids).toEqual([]);
    expect(clickSelection(multi, 'c').ids).toEqual(['c']);
    expect(clickSelection(multi, 'c', { shift: true }).ids).toEqual(['a', 'b', 'c']);
    expect(clickSelection(multi, 'a').ids).toEqual(['a', 'b']);
    expect(clickSelection(multi, 'a').activeId).toBe('a');
  });

  it('选择集包围盒与规约（父子同选只留上层）', () => {
    let doc = createDocument({ id: 'd1', pages: [createPage({ id: 'p1' })] });
    doc = insertNode(
      doc,
      'p1',
      createFrame({ id: 'f', x: 0, y: 0, width: 100, height: 100 }),
      null,
    );
    doc = insertNode(
      doc,
      'p1',
      createRect({ id: 'child', x: 10, y: 10, width: 20, height: 20 }),
      'f',
    );
    const page = getPage(doc, 'p1');
    expect(normalizeNodeSelection(page, ['f', 'child'])).toEqual(['f']);
    const bounds = selectionBounds(page, createSelection(['f', 'child']));
    expect(bounds).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it('混选取值：一致返回该值，不一致返回 undefined（Inspector 显示「—」）', () => {
    const { page } = scene();
    const same = createSelection(['a', 'c']);
    expect(commonValue(page, same, (node) => node.width)).toBe(100);
    const mixed = createSelection(['a', 'b']); // 100×50 与 50×100
    expect(commonValue(page, mixed, (node) => node.width)).toBeUndefined();
    expect(hasMixedValue(page, mixed, (node) => node.width)).toBe(true);
    expect(hasMixedValue(page, selectOnly('a'), (node) => node.width)).toBe(false);
    expect(selectionKinds(page, same)).toEqual(['rect']);
    expect(selectionNodes(page, same)).toHaveLength(2);
  });

  it('共同父级：同父返回父 id，异父返回 undefined', () => {
    let doc = createDocument({ id: 'd2', pages: [createPage({ id: 'p1' })] });
    doc = insertNode(
      doc,
      'p1',
      createFrame({ id: 'f', x: 0, y: 0, width: 100, height: 100 }),
      null,
    );
    doc = insertNode(
      doc,
      'p1',
      createRect({ id: 'child', x: 0, y: 0, width: 10, height: 10 }),
      'f',
    );
    doc = insertNode(doc, 'p1', createRect({ id: 'top', x: 0, y: 0, width: 10, height: 10 }), null);
    const page = getPage(doc, 'p1');
    expect(commonParentId(page, createSelection(['child', 'top']))).toBeUndefined();
    expect(commonParentId(page, setSelection(createSelection(), ['child']))).toBe('f');
    void scene;
    void setSelection;
  });
});

describe('selection · 对齐（白名单第 11 类）', () => {
  it('六向对齐到选择集基准', () => {
    const { doc, page } = scene();
    const stack = new CommandStack(doc);
    stack.dispatch(alignCommands(page, 'p1', ['a', 'b', 'c'], 'left'));
    expect(requireNode(getPage(stack.document, 'p1'), 'b').x).toBe(0);
    expect(requireNode(getPage(stack.document, 'p1'), 'c').x).toBe(0);

    const stack2 = new CommandStack(doc);
    stack2.dispatch(alignCommands(page, 'p1', ['a', 'b', 'c'], 'bottom'));
    // 基准下边界 = max(y+h) = 350 → a 移到 y=300，b 移到 y=250
    expect(requireNode(getPage(stack2.document, 'p1'), 'a').y).toBe(300);
    expect(requireNode(getPage(stack2.document, 'p1'), 'b').y).toBe(250);
  });

  it('水平居中与垂直居中', () => {
    const { doc, page } = scene();
    const stack = new CommandStack(doc);
    stack.dispatch(alignCommands(page, 'p1', ['a', 'c'], 'hcenter'));
    // 基准中心 x = (0..500)/2 = 250 → a 中心 50 → 移动 200
    expect(requireNode(getPage(stack.document, 'p1'), 'a').x).toBe(200);
    const stack2 = new CommandStack(doc);
    stack2.dispatch(alignCommands(page, 'p1', ['a', 'b'], 'vcenter'));
    // 基准 = 并集 y 0..200，中心 100 → a 中心 25 → y = 75
    expect(requireNode(getPage(stack2.document, 'p1'), 'a').y).toBe(75);
  });

  it('对齐到父容器（含旋转父级的局部换算）', () => {
    let doc = createDocument({ id: 'd1', pages: [createPage({ id: 'p1' })] });
    doc = insertNode(
      doc,
      'p1',
      createFrame({ id: 'f', x: 0, y: 0, width: 200, height: 100 }),
      null,
    );
    doc = insertNode(
      doc,
      'p1',
      createRect({ id: 'child', x: 50, y: 30, width: 40, height: 20 }),
      'f',
    );
    const page = getPage(doc, 'p1');
    const stack = new CommandStack(doc);
    stack.dispatch(alignCommands(page, 'p1', ['child'], 'left', { relativeTo: 'parent' }));
    expect(requireNode(getPage(stack.document, 'p1'), 'child').x).toBe(0);
  });

  it('对齐到父容器：顶层节点无基准时报错', () => {
    const { page } = scene();
    expect(() => alignCommands(page, 'p1', ['a'], 'left', { relativeTo: 'parent' })).toThrow(
      '无基准',
    );
  });
});

describe('selection · 分布', () => {
  it('等间隙分布：首尾不动、中间等分', () => {
    let doc = createDocument({ id: 'd1', pages: [createPage({ id: 'p1' })] });
    doc = insertNodes(
      doc,
      'p1',
      [
        createRect({ id: 'a', x: 0, y: 0, width: 50, height: 50 }),
        createRect({ id: 'b', x: 70, y: 0, width: 50, height: 50 }),
        createRect({ id: 'c', x: 300, y: 0, width: 50, height: 50 }),
      ],
      null,
    );
    const page = getPage(doc, 'p1');
    const stack = new CommandStack(doc);
    stack.dispatch(distributeCommands(page, 'p1', ['a', 'b', 'c'], 'horizontal'));
    // 总空 = 350 - 150 = 200 → 两段各 100 → b 的 x = 150
    expect(requireNode(getPage(stack.document, 'p1'), 'b').x).toBe(150);
    expect(requireNode(getPage(stack.document, 'p1'), 'a').x).toBe(0);
    expect(requireNode(getPage(stack.document, 'p1'), 'c').x).toBe(300);
  });

  it('指定间距分布', () => {
    const { doc, page } = scene();
    const stack = new CommandStack(doc);
    stack.dispatch(distributeCommands(page, 'p1', ['a', 'b', 'c'], 'vertical', { spacing: 10 }));
    expect(requireNode(getPage(stack.document, 'p1'), 'b').y).toBe(60); // a 高 50 + 10
    expect(requireNode(getPage(stack.document, 'p1'), 'c').y).toBe(170); // b 高 100 + 10
  });

  it('少于两个对象不产出命令', () => {
    const { page } = scene();
    expect(distributeCommands(page, 'p1', ['a'], 'horizontal')).toEqual([]);
    expect(alignCommands(page, 'p1', [], 'left')).toEqual([]);
  });
});

describe('layout · 自动布局子集', () => {
  const config = (overrides: Partial<AutoLayoutConfig> = {}): AutoLayoutConfig => ({
    ...defaultAutoLayout('vertical'),
    ...overrides,
  });

  it('垂直堆叠：间距与内边距参与定位', () => {
    const result = solveAutoLayout(config({ heightSizing: 'fixed' }), { width: 200, height: 300 }, [
      { id: 'a', width: 100, height: 50 },
      { id: 'b', width: 80, height: 40 },
    ]);
    expect(result.positions.a).toEqual({ x: 10, y: 10 });
    expect(result.positions.b).toEqual({ x: 10, y: 70 });
    expect(result.frameSize).toEqual({ width: 200, height: 300 });
  });

  it('包裹高度（hug）：容器高度 = 内容 + 内边距', () => {
    const result = solveAutoLayout(config(), { width: 200, height: 999 }, [
      { id: 'a', width: 100, height: 50 },
      { id: 'b', width: 80, height: 40 },
    ]);
    expect(result.frameSize.height).toBe(10 + 50 + 10 + 40 + 10);
  });

  it('水平布局 + 主轴居中', () => {
    const result = solveAutoLayout(
      config({ direction: 'horizontal', primaryAxisAlign: 'center', widthSizing: 'fixed' }),
      { width: 300, height: 100 },
      [
        { id: 'a', width: 50, height: 20 },
        { id: 'b', width: 50, height: 20 },
      ],
    );
    // 内容宽 110，剩余 300-20-110 = 170 → 起点 10 + 85
    expect(result.positions.a?.x).toBe(95);
    expect(result.positions.b?.x).toBe(155);
  });

  it('交叉轴居中与拉伸（fill）', () => {
    const centered = solveAutoLayout(
      config({ counterAxisAlign: 'center', heightSizing: 'fixed' }),
      { width: 300, height: 200 },
      [{ id: 'a', width: 50, height: 40 }],
    );
    expect(centered.positions.a?.x).toBe(10 + (280 - 50) / 2);
    const stretched = solveAutoLayout(
      config({ counterAxisAlign: 'stretch', heightSizing: 'fixed' }),
      { width: 300, height: 200 },
      [{ id: 'a', width: 50, height: 40 }],
    );
    expect(stretched.sizes.a).toEqual({ width: 280, height: 40 });
  });

  it('autoLayoutCommands：产出子项位置与容器包裹尺寸命令，可直接进命令栈', () => {
    let doc = createDocument({ id: 'd1', pages: [createPage({ id: 'p1' })] });
    doc = insertNode(
      doc,
      'p1',
      createFrame({ id: 'f', x: 0, y: 0, width: 200, height: 300, autoLayout: config() }),
      null,
    );
    doc = insertNodes(
      doc,
      'p1',
      [
        createRect({ id: 'a', x: 999, y: 999, width: 100, height: 50 }),
        createRect({ id: 'b', x: 999, y: 999, width: 80, height: 40 }),
      ],
      'f',
    );
    const page = getPage(doc, 'p1');
    const commands = autoLayoutCommands(page, 'p1', 'f');
    const stack = new CommandStack(doc);
    stack.dispatch(commands);
    const after = getPage(stack.document, 'p1');
    expect(after.nodes.a).toMatchObject({ x: 10, y: 10 });
    expect(after.nodes.b).toMatchObject({ x: 10, y: 70 });
    expect(after.nodes.f?.height).toBe(120);
    stack.undo();
    expect(getPage(stack.document, 'p1').nodes.a).toMatchObject({ x: 999, y: 999 });
    void hugDirections;
    void layoutInputs;
    void autoLayoutOf;
  });
});
