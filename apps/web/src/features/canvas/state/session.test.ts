/**
 * 画布会话测试（引擎夹具驱动，白名单 13 类逐条断言）。
 *
 * 测试口径：**行为断言**——通过会话的公开方法（指针/滚轮/键盘语义输入）与命令栈快照观察结果，
 * 不触碰内部实现。会话是「引擎 ↔ UI」的唯一接缝，因此这一层覆盖 = 编辑行为的回归网。
 */

import {
  countNodes,
  createDocument,
  createIdFactory,
  createPage,
  createRect,
  createSelection,
  createText,
  type DesignDocument,
  defaultGridSettings,
  getChildrenIds,
  type NodeId,
  resolveNode,
  type ScenePage,
  type TextContent,
} from '@dforge/engine';
import { beforeEach, describe, expect, it } from 'vitest';

import { handleKeyDown, type ShortcutContext } from '../input/keyboard';
import { type CanvasSession, createCanvasSession } from './session';

const CONTEXT: ShortcutContext = {
  screenSize: { width: 800, height: 600 },
  screenCenter: { x: 400, y: 300 },
};

/** 夹具页面：两个矩形 + 一个文本。 */
function fixturePage(): ScenePage {
  const rect = createRect({ id: 'n_rect', x: 10, y: 10, width: 50, height: 30 });
  const rect2 = createRect({ id: 'n_rect2', x: 100, y: 20, width: 40, height: 40 });
  const textContent: TextContent = {
    characters: '标题',
    fontFamily: 'Noto Sans SC',
    fontSize: 14,
    fontWeight: 400,
    lineHeight: 1.4,
    letterSpacing: 0,
    align: 'left',
    autoResize: 'none',
  };
  const text = createText({
    id: 'n_text',
    x: 10,
    y: 80,
    width: 100,
    height: 20,
    text: textContent,
  });
  return createPage({
    id: 'page_1',
    rootIds: ['n_rect', 'n_rect2', 'n_text'],
    nodes: { n_rect: rect, n_rect2: rect2, n_text: text },
    grid: { ...defaultGridSettings(), visible: false },
  });
}

/** 夹具文档。 */
function fixtureDocument(): DesignDocument {
  return createDocument({ id: 'doc_1', name: '夹具', pages: [fixturePage()] });
}

/** 建会话（确定性 id 工厂）。 */
function session(options: { snapEnabled?: boolean } = {}): CanvasSession {
  return createCanvasSession({
    document: fixtureDocument(),
    ids: createIdFactory(100),
    // 吸附默认关闭，避免「自由拖拽」类断言被引擎的对齐吸附修正；
    // 吸附行为本身在「会话 · 吸附」分组里专门断言。
    snapEnabled: options.snapEnabled ?? false,
  });
}

/** 取节点几何（断言用）。 */
function geometryOf(sessionRef: CanvasSession, id: NodeId) {
  const node = resolveNode(sessionRef.page(), id);
  if (node === undefined) throw new Error(`节点不存在：${id}`);
  return { x: node.x, y: node.y, width: node.width, height: node.height, rotation: node.rotation };
}

/** 一次完整点击（down + up）。 */
function click(
  sessionRef: CanvasSession,
  world: { x: number; y: number },
  modifiers: { shift?: boolean; meta?: boolean } = {},
): void {
  sessionRef.pointerDown({ world, screen: world, button: 'left', modifiers });
  sessionRef.pointerUp({ world, screen: world, modifiers });
}

/** 一次拖拽（down + move + up）。 */
function drag(
  sessionRef: CanvasSession,
  from: { x: number; y: number },
  to: { x: number; y: number },
  modifiers: { shift?: boolean; alt?: boolean; meta?: boolean } = {},
): void {
  sessionRef.pointerDown({ world: from, screen: from, button: 'left', modifiers });
  sessionRef.pointerMove({ world: to, screen: to, modifiers });
  sessionRef.pointerUp({ world: to, screen: to, modifiers });
}

describe('会话 · 选择（白名单 1）', () => {
  let sessionRef: CanvasSession;
  beforeEach(() => {
    sessionRef = session();
  });

  it('点选命中最上层对象并高亮（框选/悬停共用同一命中口径）', () => {
    click(sessionRef, { x: 30, y: 20 });
    expect(sessionRef.selection().ids).toEqual(['n_rect']);
    expect(sessionRef.selectionBounds()).toMatchObject({ x: 10, y: 10, width: 50, height: 30 });
  });

  it('Shift 点选追加与取消（切换语义）', () => {
    click(sessionRef, { x: 30, y: 20 });
    sessionRef.pointerDown({
      world: { x: 120, y: 40 },
      screen: { x: 120, y: 40 },
      button: 'left',
      modifiers: { shift: true },
    });
    sessionRef.pointerUp({
      world: { x: 120, y: 40 },
      screen: { x: 120, y: 40 },
      modifiers: { shift: true },
    });
    expect(sessionRef.selection().ids.sort()).toEqual(['n_rect', 'n_rect2']);

    // 再次 Shift 点同一对象 → 取消选中
    sessionRef.pointerDown({
      world: { x: 120, y: 40 },
      screen: { x: 120, y: 40 },
      button: 'left',
      modifiers: { shift: true },
    });
    sessionRef.pointerUp({
      world: { x: 120, y: 40 },
      screen: { x: 120, y: 40 },
      modifiers: { shift: true },
    });
    expect(sessionRef.selection().ids).toEqual(['n_rect']);
  });

  it('框选（从右下往左上拖）命中与矩形相交的对象', () => {
    sessionRef.pointerDown({
      world: { x: 200, y: 160 },
      screen: { x: 200, y: 160 },
      button: 'left',
    });
    sessionRef.pointerMove({ world: { x: 0, y: 0 }, screen: { x: 0, y: 0 } });
    // 拖动中：草稿矩形为交互态（渲染层据此画框选）
    expect(sessionRef.marquee()).toMatchObject({ x: 0, y: 0, width: 200, height: 160 });
    sessionRef.pointerUp({ world: { x: 0, y: 0 }, screen: { x: 0, y: 0 } });
    expect(sessionRef.selection().ids.sort()).toEqual(['n_rect', 'n_rect2', 'n_text']);
  });

  it('点空白清空选择；Shift 点空白保留选择', () => {
    click(sessionRef, { x: 30, y: 20 });
    click(sessionRef, { x: 400, y: 400 });
    expect(sessionRef.selection().ids).toEqual([]);
    click(sessionRef, { x: 30, y: 20 });
    sessionRef.pointerDown({
      world: { x: 400, y: 400 },
      screen: { x: 400, y: 400 },
      button: 'left',
      modifiers: { shift: true },
    });
    sessionRef.pointerUp({
      world: { x: 400, y: 400 },
      screen: { x: 400, y: 400 },
      modifiers: { shift: true },
    });
    expect(sessionRef.selection().ids).toEqual(['n_rect']);
  });

  it('选择集接收脏值（未定义/空串）时不崩：按无效 id 处理', () => {
    sessionRef.setSelection(['n_rect', undefined as unknown as string, '']);
    expect(sessionRef.selection().ids).toEqual(['n_rect']);
    sessionRef.addNodeToSelection(undefined as unknown as string);
    expect(sessionRef.selection().ids).toEqual(['n_rect']);
  });

  it('悬停命中给出节点与光标（拖动前的视觉反馈）', () => {
    sessionRef.pointerMove({ world: { x: 30, y: 20 }, screen: { x: 30, y: 20 } });
    expect(sessionRef.store.getState().hoverId).toBe('n_rect');
    expect(sessionRef.store.getState().hoverCursor).toBe('move');
    sessionRef.pointerMove({ world: { x: 400, y: 400 }, screen: { x: 400, y: 400 } });
    expect(sessionRef.store.getState().hoverId).toBeNull();
  });
});

describe('会话 · 选择集端口（编辑器工作区同源）', () => {
  it('画布 ⇄ 宿主双向同源：任一侧改选择，另一侧立即一致', () => {
    // 最小端口替身（编辑器里它就是 FE-04 面板 UI store 的适配）
    let shared = createSelection([]);
    const listeners = new Set<() => void>();
    const port = {
      get: () => shared,
      set: (selection: ReturnType<typeof createSelection>) => {
        shared = selection;
        for (const listener of listeners) listener();
      },
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const canvas = createCanvasSession({
      document: fixtureDocument(),
      ids: createIdFactory(500),
      selectionPort: port,
    });

    // 画布侧改 → 端口侧同源
    canvas.setSelection(['n_rect']);
    expect(port.get().ids).toEqual(['n_rect']);

    // 端口侧改（模拟点图层面板）→ 画布侧同源
    port.set(createSelection(['n_rect2']));
    expect(canvas.selection().ids).toEqual(['n_rect2']);

    // 清空也要同步
    canvas.clearSelection();
    expect(port.get().ids).toEqual([]);
  });

  it('共享命令栈：文档真值只有一份（画布写入，面板读到的就是同一份）', () => {
    const doc = fixtureDocument();
    const canvas = createCanvasSession({ document: doc, ids: createIdFactory(700) });
    const shared = canvas.stack;
    const other = createCanvasSession({ document: doc, ids: createIdFactory(800), stack: shared });
    canvas.setSelection(['n_rect']);
    canvas.nudge(5, 0);
    expect(other.document()).toBe(canvas.document());
    expect(other.page().nodes.n_rect?.x).toBe(15);
  });
});

describe('会话 · 移动/缩放/旋转（白名单 2/3/4）', () => {
  let sessionRef: CanvasSession;
  beforeEach(() => {
    sessionRef = session();
  });

  it('拖拽移动：拖动中给预览补丁、松手产出命令（文档在松手前不变）', () => {
    click(sessionRef, { x: 30, y: 20 });
    sessionRef.pointerDown({ world: { x: 30, y: 20 }, screen: { x: 30, y: 20 }, button: 'left' });
    sessionRef.pointerMove({ world: { x: 60, y: 40 }, screen: { x: 60, y: 40 } });
    // 拖动中：文档未变、预览补丁已给出
    expect(geometryOf(sessionRef, 'n_rect').x).toBe(10);
    expect(sessionRef.preview().get('n_rect')).toMatchObject({ x: 40, y: 30 });
    sessionRef.pointerUp({ world: { x: 60, y: 40 }, screen: { x: 60, y: 40 } });
    expect(geometryOf(sessionRef, 'n_rect')).toMatchObject({ x: 40, y: 30 });
    expect(sessionRef.stack.history().undo[0]).toBe('移动');
  });

  it('8 手柄缩放：se 手柄拖出更大包围盒（对侧锚点不动）', () => {
    click(sessionRef, { x: 30, y: 20 });
    // 手柄命中（屏幕半径 5px → 世界 5）
    sessionRef.pointerDown({ world: { x: 60, y: 40 }, screen: { x: 60, y: 40 }, button: 'left' });
    expect(sessionRef.store.getState().interaction.kind).toBe('resize');
    sessionRef.pointerMove({ world: { x: 110, y: 70 }, screen: { x: 110, y: 70 } });
    const preview = sessionRef.preview().get('n_rect');
    expect(preview?.width).toBeCloseTo(100, 3);
    expect(preview?.height).toBeCloseTo(60, 3);
    sessionRef.pointerUp({ world: { x: 110, y: 70 }, screen: { x: 110, y: 70 } });
    expect(geometryOf(sessionRef, 'n_rect')).toMatchObject({
      x: 10,
      y: 10,
      width: 100,
      height: 60,
    });
  });

  it('每个手柄都能命中（8 个手柄逐点验证）', () => {
    click(sessionRef, { x: 30, y: 20 });
    const points: Array<{ x: number; y: number }> = [
      { x: 10, y: 10 },
      { x: 35, y: 10 },
      { x: 60, y: 10 },
      { x: 60, y: 25 },
      { x: 60, y: 40 },
      { x: 35, y: 40 },
      { x: 10, y: 40 },
      { x: 10, y: 25 },
    ];
    for (const point of points) {
      sessionRef.pointerDown({ world: point, screen: point, button: 'left' });
      const interaction = sessionRef.store.getState().interaction;
      expect(interaction.kind, `手柄 ${String(point.x)},${String(point.y)} 未命中`).toBe('resize');
      sessionRef.cancelActiveInteraction();
    }
  });

  it('角外侧旋转区：拖动改变 rotation（Shift 吸附 15°）', () => {
    click(sessionRef, { x: 30, y: 20 });
    // 矩形中心 (35,25)；nw 角 (10,10)，角外侧 (0,0) 落在旋转区
    sessionRef.pointerDown({ world: { x: 0, y: 0 }, screen: { x: 0, y: 0 }, button: 'left' });
    expect(sessionRef.store.getState().interaction.kind).toBe('rotate');
    sessionRef.pointerMove({
      world: { x: 70, y: -20 },
      screen: { x: 70, y: -20 },
      modifiers: { shift: true },
    });
    sessionRef.pointerUp({
      world: { x: 70, y: -20 },
      screen: { x: 70, y: -20 },
      modifiers: { shift: true },
    });
    const rotation = geometryOf(sessionRef, 'n_rect').rotation;
    expect(rotation).not.toBe(0);
    expect(Math.abs(rotation % 15)).toBeLessThan(1e-6);
  });

  it('Shift 约束单轴移动（取位移较大的轴）', () => {
    click(sessionRef, { x: 30, y: 20 });
    drag(sessionRef, { x: 30, y: 20 }, { x: 80, y: 25 }, { shift: true });
    const geometry = geometryOf(sessionRef, 'n_rect');
    expect(geometry.x).toBe(60);
    expect(geometry.y).toBe(10);
  });

  it('Esc 取消交互：文档与预览都不留痕', () => {
    click(sessionRef, { x: 30, y: 20 });
    sessionRef.pointerDown({ world: { x: 30, y: 20 }, screen: { x: 30, y: 20 }, button: 'left' });
    sessionRef.pointerMove({ world: { x: 90, y: 60 }, screen: { x: 90, y: 60 } });
    sessionRef.cancelActiveInteraction();
    expect(sessionRef.store.getState().interaction.kind).toBe('idle');
    expect(sessionRef.preview().size).toBe(0);
    expect(geometryOf(sessionRef, 'n_rect')).toMatchObject({ x: 10, y: 10 });
  });
});

describe('会话 · 画布缩放与平移（白名单 5/6）', () => {
  let sessionRef: CanvasSession;
  beforeEach(() => {
    sessionRef = session();
  });

  it('⌘ + 滚轮以指针为锚点缩放（锚点下的世界点不动）', () => {
    const anchor = { x: 100, y: 100 };
    const worldBefore = {
      x: (anchor.x - sessionRef.viewport().panX) / sessionRef.viewport().zoom,
      y: (anchor.y - sessionRef.viewport().panY) / sessionRef.viewport().zoom,
    };
    sessionRef.wheel({ deltaX: 0, deltaY: -120, zoom: true, screen: anchor });
    const viewport = sessionRef.viewport();
    expect(viewport.zoom).toBeGreaterThan(1);
    const worldAfter = {
      x: (anchor.x - viewport.panX) / viewport.zoom,
      y: (anchor.y - viewport.panY) / viewport.zoom,
    };
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
  });

  it('普通滚轮平移视口（不改缩放）', () => {
    sessionRef.wheel({ deltaX: 0, deltaY: 40, screen: { x: 0, y: 0 } });
    expect(sessionRef.viewport().panY).toBe(-40);
    expect(sessionRef.viewport().zoom).toBe(1);
  });

  it('空格 + 拖拽平移；中键拖拽同样平移（视口实时跟随）', () => {
    sessionRef.setSpacePressed(true);
    sessionRef.pointerDown({ world: { x: 0, y: 0 }, screen: { x: 0, y: 0 }, button: 'left' });
    sessionRef.pointerMove({ world: { x: 0, y: 0 }, screen: { x: 30, y: 20 } });
    expect(sessionRef.store.getState().interaction.kind).toBe('pan');
    expect(sessionRef.viewport()).toMatchObject({ panX: 30, panY: 20 });
    sessionRef.pointerMove({ world: { x: 0, y: 0 }, screen: { x: 40, y: 50 } });
    expect(sessionRef.viewport()).toMatchObject({ panX: 40, panY: 50 });
    sessionRef.pointerUp({ world: { x: 0, y: 0 }, screen: { x: 40, y: 50 } });
    sessionRef.setSpacePressed(false);

    sessionRef.pointerDown({ world: { x: 0, y: 0 }, screen: { x: 0, y: 0 }, button: 'middle' });
    sessionRef.pointerMove({ world: { x: 0, y: 0 }, screen: { x: -20, y: -10 } });
    expect(sessionRef.viewport()).toMatchObject({ panX: 20, panY: 40 });
    sessionRef.cancelActiveInteraction();
  });

  it('⌘+ / ⌘- / ⌘0 走缩放档位与 100%', () => {
    handleKeyDown(
      sessionRef,
      { key: '=', meta: true, ctrl: false, shift: false, alt: false },
      CONTEXT,
    );
    expect(sessionRef.viewport().zoom).toBeGreaterThan(1);
    handleKeyDown(
      sessionRef,
      { key: '0', meta: true, ctrl: false, shift: false, alt: false },
      CONTEXT,
    );
    expect(sessionRef.viewport().zoom).toBe(1);
    handleKeyDown(
      sessionRef,
      { key: '-', meta: true, ctrl: false, shift: false, alt: false },
      CONTEXT,
    );
    expect(sessionRef.viewport().zoom).toBeLessThan(1);
  });
});

describe('会话 · 命令类操作（白名单 7/8/9/10/11）', () => {
  let sessionRef: CanvasSession;
  beforeEach(() => {
    sessionRef = session();
  });

  it('复制粘贴：id 重映射 + 偏移 10/10 + 粘贴后选中新对象', async () => {
    click(sessionRef, { x: 30, y: 20 });
    sessionRef.copy();
    await sessionRef.paste();
    const selection = sessionRef.selection().ids;
    expect(selection).toHaveLength(1);
    const pasted = geometryOf(sessionRef, selection[0] as NodeId);
    expect(pasted).toMatchObject({ x: 20, y: 20, width: 50, height: 30 });
    expect(countNodes(sessionRef.page())).toBe(4);
  });

  it('层级调整：⌘] 上移、⇧⌘] 置顶', () => {
    click(sessionRef, { x: 30, y: 20 });
    sessionRef.reorder('front');
    expect(sessionRef.page().rootIds[sessionRef.page().rootIds.length - 1]).toBe('n_rect');
    sessionRef.reorder('back');
    expect(sessionRef.page().rootIds[0]).toBe('n_rect');
  });

  it('编组与解组：世界形状不变 + 选中集切换', () => {
    const before = geometryOf(sessionRef, 'n_rect');
    sessionRef.setSelection(['n_rect', 'n_rect2']);
    sessionRef.group();
    const groupId = sessionRef.selection().ids[0] as NodeId;
    const group = resolveNode(sessionRef.page(), groupId);
    expect(group?.type).toBe('group');
    expect(getChildrenIds(sessionRef.page(), groupId).sort()).toEqual(['n_rect', 'n_rect2']);
    // 世界形状不变（编组只改坐标参照系）
    expect(geometryOf(sessionRef, 'n_rect')).toMatchObject({
      width: before.width,
      height: before.height,
    });

    sessionRef.setSelection([groupId]);
    sessionRef.ungroup();
    expect(sessionRef.page().nodes[groupId]).toBeUndefined();
    expect(countNodes(sessionRef.page())).toBe(3);
  });

  it('撤销/重做往返恒等（移动 → 撤销 → 重做）', () => {
    click(sessionRef, { x: 30, y: 20 });
    drag(sessionRef, { x: 30, y: 20 }, { x: 80, y: 50 });
    expect(geometryOf(sessionRef, 'n_rect').x).toBe(60);
    sessionRef.undo();
    expect(geometryOf(sessionRef, 'n_rect').x).toBe(10);
    sessionRef.redo();
    expect(geometryOf(sessionRef, 'n_rect').x).toBe(60);
  });

  it('对齐：左对齐把两者世界左边缘对齐', () => {
    sessionRef.setSelection(['n_rect', 'n_rect2']);
    sessionRef.align('left');
    const lefts = ['n_rect', 'n_rect2'].map((id) => {
      const node = resolveNode(sessionRef.page(), id);
      return node?.x;
    });
    expect(lefts[0]).toBe(lefts[1]);
  });

  it('分布：三个对象等间隙（首尾不动）', () => {
    const a = sessionRef.createRect({ x: 0, y: 0, width: 10, height: 10 });
    sessionRef.setSelection(['n_rect', 'n_rect2', a]);
    sessionRef.distribute('horizontal');
    const rects = ['n_rect', 'n_rect2', a].map((id) => geometryOf(sessionRef, id));
    const sorted = [...rects].sort((left, right) => left.x - right.x);
    const gap1 =
      (sorted[1] as { x: number }).x -
      ((sorted[0] as { x: number }).x + (sorted[0] as { width: number }).width);
    const gap2 =
      (sorted[2] as { x: number }).x -
      ((sorted[1] as { x: number }).x + (sorted[1] as { width: number }).width);
    expect(Math.abs(gap1 - gap2)).toBeLessThan(1e-6);
  });

  it('删除与微移（方向键 1px / Shift 10px）', () => {
    click(sessionRef, { x: 30, y: 20 });
    handleKeyDown(
      sessionRef,
      { key: 'ArrowRight', meta: false, ctrl: false, shift: false, alt: false },
      CONTEXT,
    );
    expect(geometryOf(sessionRef, 'n_rect').x).toBe(11);
    handleKeyDown(
      sessionRef,
      { key: 'ArrowDown', meta: false, ctrl: false, shift: true, alt: false },
      CONTEXT,
    );
    expect(geometryOf(sessionRef, 'n_rect').y).toBe(20);
    handleKeyDown(
      sessionRef,
      { key: 'Delete', meta: false, ctrl: false, shift: false, alt: false },
      CONTEXT,
    );
    expect(sessionRef.page().nodes.n_rect).toBeUndefined();
  });
});

describe('会话 · 吸附（白名单 12）', () => {
  it('拖动到参考对象 6px 内自动吸附（落点对齐世界边缘）', () => {
    const sessionRef = session({ snapEnabled: true });
    click(sessionRef, { x: 30, y: 20 }); // 选中 n_rect（x=10）
    sessionRef.pointerDown({ world: { x: 30, y: 20 }, screen: { x: 30, y: 20 }, button: 'left' });
    // 目标：让 n_rect 左边缘贴到 n_rect2 的左边缘（x=100）：当前 10 → 拖 80（世界）
    sessionRef.pointerMove({ world: { x: 110, y: 20 }, screen: { x: 110, y: 20 } });
    const snap = sessionRef.store.getState().snap;
    expect(snap).not.toBeNull();
    expect((snap?.guides.length ?? 0) + (snap?.measurements.length ?? 0)).toBeGreaterThan(0);
    sessionRef.pointerUp({ world: { x: 110, y: 20 }, screen: { x: 110, y: 20 } });
    expect(geometryOf(sessionRef, 'n_rect').x).toBe(90); // 90 + 10 = 100（与 n_rect2 左边缘对齐）
  });

  it('吸附参考线/测量数据来自引擎（红色参考线由渲染层按令牌绘制）', () => {
    const sessionRef = session({ snapEnabled: true });
    click(sessionRef, { x: 30, y: 20 });
    sessionRef.pointerDown({ world: { x: 30, y: 20 }, screen: { x: 30, y: 20 }, button: 'left' });
    sessionRef.pointerMove({ world: { x: 111, y: 24 }, screen: { x: 111, y: 24 } });
    const snap = sessionRef.store.getState().snap;
    expect(snap?.guides.every((guide) => guide.axis === 'x' || guide.axis === 'y')).toBe(true);
    sessionRef.cancelActiveInteraction();
  });
});

describe('会话 · 文本编辑（白名单 13）', () => {
  it('文本编辑：插入 → 提交（整段编辑一条撤销）', () => {
    const sessionRef = session();
    click(sessionRef, { x: 60, y: 88 });
    sessionRef.beginTextEditing('n_text', { selectAll: true });
    expect(sessionRef.store.getState().editing?.nodeId).toBe('n_text');
    sessionRef.insertTextAtCaret('新标题');
    sessionRef.commitText();
    const node = resolveNode(sessionRef.page(), 'n_text');
    expect(node?.type === 'text' && node.text.characters).toBe('新标题');
    // 一次撤销回退整段编辑
    sessionRef.undo();
    const restored = resolveNode(sessionRef.page(), 'n_text');
    expect(restored?.type === 'text' && restored.text.characters).toBe('标题');
  });

  it('Esc 取消编辑：文档不留痕（会话丢弃）', () => {
    const sessionRef = session();
    sessionRef.beginTextEditing('n_text', { selectAll: true });
    sessionRef.insertTextAtCaret('临时');
    sessionRef.cancelText();
    expect(sessionRef.store.getState().editing).toBeNull();
    const node = resolveNode(sessionRef.page(), 'n_text');
    expect(node?.type === 'text' && node.text.characters).toBe('标题');
  });

  it('双击文本进入编辑；双击非文本进入容器（深选）', () => {
    const sessionRef = session();
    sessionRef.doubleClick({ world: { x: 60, y: 88 }, screen: { x: 60, y: 88 }, button: 'left' });
    expect(sessionRef.store.getState().editing?.nodeId).toBe('n_text');
    sessionRef.cancelText();
    sessionRef.doubleClick({ world: { x: 30, y: 20 }, screen: { x: 30, y: 20 }, button: 'left' });
    expect(sessionRef.selection().ids).toEqual(['n_rect']);
    expect(sessionRef.store.getState().editing).toBeNull();
  });

  it('退格/前向删除走引擎的文本会话操作', () => {
    const sessionRef = session();
    sessionRef.beginTextEditing('n_text', { selectAll: true });
    sessionRef.deleteBackward();
    expect(sessionRef.store.getState().editing?.content.characters).toBe('');
    sessionRef.insertTextAtCaret('AB');
    sessionRef.setEditingSelection({ start: 0, end: 0 });
    sessionRef.deleteForwardAtCaret();
    expect(sessionRef.store.getState().editing?.content.characters).toBe('B');
  });

  it('文本编辑中指针与删除快捷键不劫持（输入框自己处理）', () => {
    const sessionRef = session();
    sessionRef.beginTextEditing('n_text');
    sessionRef.pointerDown({ world: { x: 30, y: 20 }, screen: { x: 30, y: 20 }, button: 'left' });
    expect(sessionRef.selection().ids).toEqual([]);
    expect(
      handleKeyDown(
        sessionRef,
        { key: 'Delete', meta: false, ctrl: false, shift: false, alt: false },
        CONTEXT,
      ),
    ).toBeNull();
  });
});

describe('会话 · 创建工具（拖画矩形/点击文本）', () => {
  it('矩形工具拖画落成节点并选中', () => {
    const sessionRef = session();
    sessionRef.setTool('rect');
    sessionRef.pointerDown({
      world: { x: 200, y: 200 },
      screen: { x: 200, y: 200 },
      button: 'left',
    });
    sessionRef.pointerMove({ world: { x: 260, y: 240 }, screen: { x: 260, y: 240 } });
    expect(sessionRef.store.getState().draft).toMatchObject({ width: 60, height: 40 });
    sessionRef.pointerUp({ world: { x: 260, y: 240 }, screen: { x: 260, y: 240 } });
    expect(sessionRef.store.getState().draft).toBeNull();
    const ids = sessionRef.selection().ids;
    expect(ids).toHaveLength(1);
    expect(geometryOf(sessionRef, ids[0] as NodeId)).toMatchObject({
      x: 200,
      y: 200,
      width: 60,
      height: 40,
    });
  });

  it('文本工具点击创建文本并立即进入编辑', () => {
    const sessionRef = session();
    sessionRef.setTool('text');
    sessionRef.pointerDown({
      world: { x: 300, y: 300 },
      screen: { x: 300, y: 300 },
      button: 'left',
    });
    expect(sessionRef.store.getState().editing).not.toBeNull();
    sessionRef.insertTextAtCaret('正文');
    sessionRef.commitText();
    const selection = sessionRef.selection().ids[0] as NodeId;
    const node = resolveNode(sessionRef.page(), selection);
    expect(node?.type === 'text' && node.text.characters).toBe('正文');
  });
});

describe('会话 · HUD（C20 内部实现）', () => {
  it('拖动时出现提示、松手消失', () => {
    const sessionRef = session();
    click(sessionRef, { x: 30, y: 20 });
    sessionRef.pointerDown({ world: { x: 30, y: 20 }, screen: { x: 30, y: 20 }, button: 'left' });
    sessionRef.pointerMove({ world: { x: 50, y: 40 }, screen: { x: 50, y: 40 } });
    expect(sessionRef.store.getState().hud).toMatch(/^X .*Y /);
    sessionRef.pointerUp({ world: { x: 50, y: 40 }, screen: { x: 50, y: 40 } });
    expect(sessionRef.store.getState().hud).toBeNull();
  });
});
