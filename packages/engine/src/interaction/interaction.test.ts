import { describe, expect, it } from 'vitest';
import { CommandStack } from '../commands/index';
import { marqueeSelect } from '../geometry/hit-test';
import {
  createDocument,
  createFrame,
  createPage,
  createRect,
  createText,
  type ScenePage,
} from '../model/index';
import { getPage, insertNode, insertNodes, requireNode } from '../scene/index';
import {
  applySnapToMove,
  backspace,
  beginInteraction,
  beginTextEdit,
  cancelInteraction,
  clampZoom,
  commitInteraction,
  commitTextEdit,
  createViewport,
  fitBounds,
  IDLE,
  type InteractionContext,
  insertText,
  marqueeRect,
  marqueeSelectionOf,
  movePreview,
  type PointerDownEvent,
  panDelta,
  patchTextContent,
  rotatePreview,
  screenToWorld,
  selectAllText,
  setTextSelection,
  updateInteraction,
  visibleWorldRect,
  worldToScreen,
  zoomAt,
  zoomByFactor,
  zoomByWheel,
  zoomPercent,
  zoomStep,
} from './index';

function scene(): {
  page: ScenePage;
  doc: ReturnType<typeof createDocument>;
  context: InteractionContext;
} {
  let doc = createDocument({ id: 'd1', pages: [createPage({ id: 'p1' })] });
  doc = insertNode(
    doc,
    'p1',
    createRect({ id: 'n1', x: 100, y: 100, width: 50, height: 50 }),
    null,
  );
  doc = insertNodes(
    doc,
    'p1',
    [
      createRect({ id: 'n2', x: 200, y: 100, width: 50, height: 50 }),
      createText({ id: 'txt', x: 0, y: 300, width: 100, height: 20 }),
    ],
    null,
  );
  const page = getPage(doc, 'p1');
  return { page, doc, context: { page, pageId: 'p1', zoom: 1 } };
}

function down(overrides: Partial<PointerDownEvent> = {}): PointerDownEvent {
  return {
    type: 'pointer.down',
    point: { x: 110, y: 110 },
    screen: { x: 110, y: 110 },
    selection: [],
    clickTarget: null,
    handle: null,
    tool: 'select',
    ...overrides,
  };
}

describe('interaction · 视口（画布缩放/平移）', () => {
  it('屏幕 ↔ 世界换算互逆', () => {
    const viewport = createViewport(2, 30, -10);
    const world = screenToWorld(viewport, { x: 130, y: 90 });
    expect(world.x).toBeCloseTo(50);
    expect(world.y).toBeCloseTo(50);
    const screen = worldToScreen(viewport, world);
    expect(screen).toEqual({ x: 130, y: 90 });
  });

  it('画布平移只改屏幕平移量，缩放不变', () => {
    const viewport = createViewport(1.5, 0, 0);
    const next = { ...viewport, panX: viewport.panX + 10, panY: viewport.panY - 5 };
    expect(next.zoom).toBe(1.5);
    expect(screenToWorld(next, { x: 0, y: 0 })).toEqual({ x: -10 / 1.5, y: 5 / 1.5 });
  });

  it('以锚点缩放：锚点下的世界点保持不动', () => {
    const viewport = createViewport(1, 0, 0);
    const anchor = { x: 400, y: 300 };
    const worldBefore = screenToWorld(viewport, anchor);
    const zoomed = zoomAt(viewport, 2, anchor);
    expect(screenToWorld(zoomed, anchor).x).toBeCloseTo(worldBefore.x);
    expect(screenToWorld(zoomed, anchor).y).toBeCloseTo(worldBefore.y);
  });

  it('缩放上下限与档位步进', () => {
    expect(clampZoom(1000)).toBe(256);
    expect(clampZoom(0.0001)).toBe(0.02);
    const viewport = createViewport(1, 0, 0);
    expect(zoomStep(viewport, 1, { x: 0, y: 0 }).zoom).toBe(1.5);
    expect(zoomStep(viewport, -1, { x: 0, y: 0 }).zoom).toBe(0.75);
    expect(zoomPercent(createViewport(0.5))).toBe(50);
  });

  it('滚轮缩放：向上放大、向下缩小', () => {
    const viewport = createViewport(1);
    expect(zoomByWheel(viewport, -100, { x: 0, y: 0 }).zoom).toBeGreaterThan(1);
    expect(zoomByWheel(viewport, 100, { x: 0, y: 0 }).zoom).toBeLessThan(1);
    expect(zoomByFactor(viewport, 2, { x: 0, y: 0 }).zoom).toBe(2);
  });

  it('适应画布与可见世界矩形', () => {
    const fitted = fitBounds({ x: 0, y: 0, width: 200, height: 100 }, { width: 1000, height: 500 });
    expect(fitted.zoom).toBe(1); // maxZoom 默认 1
    const small = fitBounds(
      { x: 0, y: 0, width: 2000, height: 1000 },
      { width: 1000, height: 500 },
    );
    expect(small.zoom).toBeCloseTo(0.42); // 高度方向受限：(500-80)/1000
    const rect = visibleWorldRect(createViewport(2, 0, 0), { width: 100, height: 100 });
    expect(rect).toEqual({ x: 0, y: 0, width: 50, height: 50 });
  });
});

describe('interaction · 状态机（选择/移动）', () => {
  it('点未选中对象进入移动态，选择集切到该对象', () => {
    const { context } = scene();
    const state = beginInteraction(IDLE, down({ clickTarget: 'n1', selection: [] }), context);
    expect(state.kind).toBe('move');
    if (state.kind !== 'move') return;
    expect(state.nodeIds).toEqual(['n1']);
    expect(movePreview(state)).toEqual({ n1: { x: 0, y: 0 } });
  });

  it('点已选中对象时移动整个选择集', () => {
    const { context } = scene();
    const state = beginInteraction(
      IDLE,
      down({ clickTarget: 'n1', selection: ['n1', 'n2'] }),
      context,
    );
    expect(state.kind === 'move' && state.nodeIds).toEqual(['n1', 'n2']);
  });

  it('移动到目标位置并提交为命令（撤销可回退）', () => {
    const { context, doc } = scene();
    const stack = new CommandStack(doc);
    let state = beginInteraction(IDLE, down({ clickTarget: 'n1' }), context);
    state = updateInteraction(
      state,
      { type: 'pointer.move', point: { x: 130, y: 120 }, screen: { x: 130, y: 120 } },
      context,
    );
    expect(state.kind === 'move' && state.delta).toEqual({ x: 20, y: 10 });
    const { commands } = commitInteraction(state, context);
    stack.dispatch(commands);
    expect(requireNode(getPage(stack.document, 'p1'), 'n1')).toMatchObject({ x: 120, y: 110 });
    stack.undo();
    expect(requireNode(getPage(stack.document, 'p1'), 'n1')).toMatchObject({ x: 100, y: 100 });
  });

  it('Shift 约束单轴移动', () => {
    const { context } = scene();
    let state = beginInteraction(IDLE, down({ clickTarget: 'n1' }), context);
    state = updateInteraction(
      state,
      {
        type: 'pointer.move',
        point: { x: 200, y: 120 },
        screen: { x: 200, y: 120 },
        modifiers: { shift: true },
      },
      context,
    );
    expect(state.kind === 'move' && state.delta).toEqual({ x: 90, y: 0 });
  });

  it('移动时吸附到邻近对象的边缘（含参考线数据）', () => {
    const { context } = scene();
    let state = beginInteraction(IDLE, down({ clickTarget: 'n1' }), context);
    // n2 左边缘 = 200；把 n1 移到 197（差 3px，命中阈值）
    state = updateInteraction(
      state,
      { type: 'pointer.move', point: { x: 207, y: 110 }, screen: { x: 207, y: 110 } },
      context,
    );
    if (state.kind !== 'move') throw new Error('应为移动态');
    expect(state.delta.x).toBeCloseTo(100); // 100 + 100 = 200 → 与 n2 左边缘对齐
    expect(state.snap.guides.some((guide) => guide.axis === 'x' && guide.position === 200)).toBe(
      true,
    );
  });

  it('画布缩放后吸附阈值按世界单位放大', () => {
    const { context } = scene();
    const zoomed: InteractionContext = { ...context, zoom: 0.5 }; // 世界阈值 12
    const delta = applySnapToMove(zoomed, ['n1'], { x: 90, y: 0 });
    expect(delta.delta.x).toBeCloseTo(100); // 100+90=190 → 与 200 差 10 ≤ 12 → 吸附
    const unzoomed = applySnapToMove(context, ['n1'], { x: 90, y: 0 });
    expect(unzoomed.delta.x).toBeCloseTo(90);
  });

  it('可选关闭吸附', () => {
    const { context } = scene();
    const off: InteractionContext = { ...context, snapEnabled: false };
    expect(applySnapToMove(off, ['n1'], { x: 97, y: 0 }).delta.x).toBe(97);
  });

  it('点击空处进入框选态并可产出选择集', () => {
    const { context } = scene();
    let state = beginInteraction(
      IDLE,
      down({ point: { x: 90, y: 90 }, screen: { x: 90, y: 90 } }),
      context,
    );
    expect(state.kind).toBe('marquee');
    state = updateInteraction(
      state,
      { type: 'pointer.move', point: { x: 260, y: 160 }, screen: { x: 260, y: 160 } },
      context,
    );
    if (state.kind !== 'marquee') throw new Error('应为框选态');
    expect(marqueeRect(state)).toEqual({ x: 90, y: 90, width: 170, height: 70 });
    const selection = marqueeSelectionOf(state, context, (page, rect, mode) =>
      marqueeSelect(page, rect, { mode }),
    );
    expect(selection.sort()).toEqual(['n1', 'n2']);
  });

  it('手型工具进入平移态，预览屏幕增量', () => {
    const { context } = scene();
    let state = beginInteraction(IDLE, down({ tool: 'hand', screen: { x: 10, y: 10 } }), context);
    state = updateInteraction(
      state,
      { type: 'pointer.move', point: { x: 0, y: 0 }, screen: { x: 40, y: 25 } },
      context,
    );
    if (state.kind !== 'pan') throw new Error('应为平移态');
    expect(panDelta(state)).toEqual({ x: 30, y: 15 });
    expect(commitInteraction(state, context).commands).toEqual([]);
  });

  it('取消交互丢弃预览', () => {
    const { context } = scene();
    let state = beginInteraction(IDLE, down({ clickTarget: 'n1' }), context);
    state = updateInteraction(
      state,
      { type: 'pointer.move', point: { x: 500, y: 500 }, screen: { x: 500, y: 500 } },
      context,
    );
    expect(cancelInteraction(state)).toEqual(IDLE);
  });
});

describe('interaction · 缩放（8 手柄）', () => {
  it('拖角手柄缩放并写回局部属性', () => {
    const { context, doc } = scene();
    const stack = new CommandStack(doc);
    let state = beginInteraction(
      IDLE,
      down({ selection: ['n1'], clickTarget: 'n1', handle: { id: 'se', mode: 'resize' } }),
      context,
    );
    expect(state.kind).toBe('resize');
    state = updateInteraction(
      state,
      { type: 'pointer.move', point: { x: 200, y: 200 }, screen: { x: 200, y: 200 } },
      context,
    );
    if (state.kind !== 'resize') throw new Error('应为缩放态');
    expect(state.nextBounds).toEqual({ x: 100, y: 100, width: 100, height: 100 });
    const { commands } = commitInteraction(state, context);
    stack.dispatch(commands);
    expect(requireNode(getPage(stack.document, 'p1'), 'n1')).toMatchObject({
      x: 100,
      y: 100,
      width: 100,
      height: 100,
    });
  });

  it('旋转节点的缩放保持对侧锚点不动', () => {
    let doc = createDocument({ id: 'd1', pages: [createPage({ id: 'p1' })] });
    doc = insertNode(
      doc,
      'p1',
      createRect({ id: 'r', x: 0, y: 0, width: 100, height: 100, rotation: 90 }),
      null,
    );
    const page = getPage(doc, 'p1');
    const context: InteractionContext = { page, pageId: 'p1', zoom: 1 };
    let state = beginInteraction(
      IDLE,
      down({
        selection: ['r'],
        clickTarget: 'r',
        handle: { id: 'e', mode: 'resize' },
        point: { x: 0, y: 100 },
      }),
      context,
    );
    state = updateInteraction(
      state,
      { type: 'pointer.move', point: { x: 0, y: 140 }, screen: { x: 0, y: 140 } },
      context,
    );
    if (state.kind !== 'resize') throw new Error('应为缩放态');
    expect(state.nextBounds.width).toBeCloseTo(140);
    const stack = new CommandStack(doc);
    const { commands } = commitInteraction(state, context);
    stack.dispatch(commands);
    const node = requireNode(getPage(stack.document, 'p1'), 'r');
    expect(node.width).toBeCloseTo(140);
    expect(node.rotation).toBe(90);
  });
});

describe('interaction · 旋转', () => {
  it('绕选择集中心旋转，产出度数并支持 15° 吸附', () => {
    const { context, doc } = scene();
    const stack = new CommandStack(doc);
    // n1 中心 (125,125)；从 (125,25) 开始拖到右侧 → 顺时针 90°
    let state = beginInteraction(
      IDLE,
      down({
        selection: ['n1'],
        clickTarget: 'n1',
        handle: { id: 'ne', mode: 'rotate' },
        point: { x: 125, y: 25 },
      }),
      context,
    );
    expect(state.kind).toBe('rotate');
    state = updateInteraction(
      state,
      { type: 'pointer.move', point: { x: 225, y: 125 }, screen: { x: 225, y: 125 } },
      context,
    );
    if (state.kind !== 'rotate') throw new Error('应为旋转态');
    expect(state.rotation).toBeCloseTo(90);
    expect(rotatePreview(state)).toEqual({ n1: 90 });
    const { commands } = commitInteraction(state, context);
    stack.dispatch(commands);
    expect(requireNode(getPage(stack.document, 'p1'), 'n1').rotation).toBeCloseTo(90);

    // Shift：吸附到 15° 档
    let snapped = beginInteraction(
      IDLE,
      down({
        selection: ['n1'],
        clickTarget: 'n1',
        handle: { id: 'ne', mode: 'rotate' },
        point: { x: 125, y: 25 },
      }),
      context,
    );
    snapped = updateInteraction(
      snapped,
      {
        type: 'pointer.move',
        point: { x: 225, y: 130 },
        screen: { x: 225, y: 130 },
        modifiers: { shift: true },
      },
      context,
    );
    expect(snapped.kind === 'rotate' && Number.isInteger(snapped.rotation / 15)).toBe(true);
  });
});

describe('interaction · 文本编辑会话（C10）', () => {
  function textPage(): ScenePage {
    let doc = createDocument({ id: 'd1', pages: [createPage({ id: 'p1' })] });
    doc = insertNode(
      doc,
      'p1',
      createText({ id: 'txt', x: 0, y: 0, width: 100, height: 20 }),
      null,
    );
    doc = insertNode(doc, 'p1', createFrame({ id: 'f', width: 10, height: 10 }), null);
    return getPage(doc, 'p1');
  }

  it('双击进入编辑：光标落在末尾；非文本节点报错', () => {
    const page = textPage();
    const session = beginTextEdit(page, 'p1', 'txt');
    expect(session.selection).toEqual({ start: 0, end: 0 });
    expect(() => beginTextEdit(page, 'p1', 'f')).toThrow('不是文本');
  });

  it('输入/退格/选段替换，提交产出单条命令', () => {
    const page = textPage();
    const stack = new CommandStack(createDocument({ id: 'd1', pages: [page] }));
    let session = beginTextEdit(page, 'p1', 'txt');
    session = insertText(session, '设界');
    session = insertText(session, '设计');
    expect(session.content.characters).toBe('设界设计');
    session = backspace(session);
    expect(session.content.characters).toBe('设界设');
    session = setTextSelection(session, { start: 0, end: 2 });
    session = insertText(session, 'DesignForge');
    expect(session.content.characters).toBe('DesignForge设');
    session = patchTextContent(session, { fontSize: 20 });

    const commands = commitTextEdit(session);
    expect(commands).toHaveLength(1);
    stack.dispatch(commands);
    const node = requireNode(getPage(stack.document, 'p1'), 'txt');
    expect(node.type === 'text' && node.text.characters).toBe('DesignForge设');
    expect(node.type === 'text' && node.text.fontSize).toBe(20);
    // 一次撤销回退整段编辑
    stack.undo();
    const restored = requireNode(getPage(stack.document, 'p1'), 'txt');
    expect(restored.type === 'text' && restored.text.characters).toBe('');
  });

  it('未修改内容时提交为空命令', () => {
    const page = textPage();
    const session = beginTextEdit(page, 'p1', 'txt');
    expect(commitTextEdit(session)).toEqual([]);
    expect(selectAllText(session).selection).toEqual({ start: 0, end: 0 });
  });
});
