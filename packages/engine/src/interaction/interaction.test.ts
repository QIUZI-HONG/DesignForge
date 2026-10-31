import { describe, expect, it } from 'vitest';
import { CommandStack } from '../commands/index';
import { marqueeSelect } from '../geometry/hit-test';
import { rotateVector } from '../geometry/matrix';
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

describe('interaction · 缩放（父级坐标换算 + 旋转节点，票 06）', () => {
  it('画板内多选缩放：节点随集合盒在世界系缩放，不把世界坐标直写父相对字段', () => {
    let doc = createDocument({ id: 'd1', pages: [createPage({ id: 'p1' })] });
    doc = insertNode(
      doc,
      'p1',
      createFrame({ id: 'f', x: 100, y: 100, width: 400, height: 400 }),
      null,
    );
    doc = insertNodes(
      doc,
      'p1',
      [
        createRect({ id: 'a', x: 10, y: 20, width: 50, height: 50 }),
        createRect({ id: 'b', x: 200, y: 200, width: 100, height: 40 }),
      ],
      'f',
    );
    const page = getPage(doc, 'p1');
    const context: InteractionContext = { page, pageId: 'p1', zoom: 1 };
    // 世界系集合盒：a (110,120,50,50) ∪ b (300,300,100,40) → (110,120,290,220)
    let state = beginInteraction(
      IDLE,
      down({
        selection: ['a', 'b'],
        handle: { id: 'se', mode: 'resize' },
        point: { x: 400, y: 340 },
      }),
      context,
    );
    if (state.kind !== 'resize') throw new Error('应为缩放态');
    expect(state.startBounds).toEqual({ x: 110, y: 120, width: 290, height: 220 });
    // 拖到两倍：nextBounds (110,120,580,440)，scaleX = scaleY = 2
    state = updateInteraction(
      state,
      { type: 'pointer.move', point: { x: 690, y: 560 }, screen: { x: 690, y: 560 } },
      context,
    );
    if (state.kind !== 'resize') throw new Error('应为缩放态');
    const stack = new CommandStack(doc);
    const { commands } = commitInteraction(state, context);
    stack.dispatch(commands);
    const after = getPage(stack.document, 'p1');
    // 锚点角（集合盒左上 = a 的左上）不动：局部坐标保持，尺寸翻倍
    expect(requireNode(after, 'a')).toMatchObject({ x: 10, y: 20, width: 100, height: 100 });
    // b 随集合盒在世界系缩放：世界 (490,480,200,80) = 画板内局部 (390,380,200,80)
    expect(requireNode(after, 'b')).toMatchObject({ x: 390, y: 380, width: 200, height: 80 });
  });

  it('旋转父级下多选缩放：节点中心经父系逆矩阵换算', () => {
    let doc = createDocument({ id: 'd1', pages: [createPage({ id: 'p1' })] });
    doc = insertNode(
      doc,
      'p1',
      createFrame({ id: 'f', x: 100, y: 100, width: 200, height: 200, rotation: 90 }),
      null,
    );
    doc = insertNodes(
      doc,
      'p1',
      [
        createRect({ id: 'r', x: 0, y: 0, width: 100, height: 50 }),
        createRect({ id: 'r2', x: 50, y: 100, width: 50, height: 50 }),
      ],
      'f',
    );
    const page = getPage(doc, 'p1');
    const context: InteractionContext = { page, pageId: 'p1', zoom: 1 };
    // 画板 90° 旋转：r 世界 AABB (250,100,50,100)，r2 世界 AABB (150,150,50,50)
    // 集合盒 (150,100,150,100)；拖 se 到两倍 (150,100,300,200)
    let state = beginInteraction(
      IDLE,
      down({
        selection: ['r', 'r2'],
        handle: { id: 'se', mode: 'resize' },
        point: { x: 300, y: 200 },
      }),
      context,
    );
    if (state.kind !== 'resize') throw new Error('应为缩放态');
    state = updateInteraction(
      state,
      { type: 'pointer.move', point: { x: 450, y: 300 }, screen: { x: 450, y: 300 } },
      context,
    );
    if (state.kind !== 'resize') throw new Error('应为缩放态');
    const stack = new CommandStack(doc);
    const { commands } = commitInteraction(state, context);
    stack.dispatch(commands);
    const after = getPage(stack.document, 'p1');
    // r 新世界中心 (400,200)：父系逆矩阵换算后局部中心 (100,-100) → 局部 (0,-150,200,100)
    expect(requireNode(after, 'r')).toMatchObject({ x: 0, y: -150, width: 200, height: 100 });
    // r2 新世界中心 (200,250)：局部中心 (150,100) → 局部 (100,50,100,100)
    expect(requireNode(after, 'r2')).toMatchObject({ x: 100, y: 50, width: 100, height: 100 });
  });

  // B3 破坏集：旋转非 90° 倍数（任意宽高比）∪ 90°/270° 非正方形。
  // 幻影盒回归：起点盒曾是旋转后世界 AABB，而 resizeRotatedNode 契约要求未旋转盒。
  it.each([
    { w: 100, h: 50, rot: 30, x: 200, y: 100 },
    { w: 100, h: 50, rot: 90, x: 0, y: 0 },
    { w: 100, h: 50, rot: 270, x: 0, y: 0 },
    { w: 100, h: 100, rot: 30, x: 200, y: 100 },
  ])(
    '旋转节点拖 e 手柄加倍宽：起点盒为未旋转盒、对侧锚点不动（$w×$h @$rot°）',
    ({ w, h, rot, x, y }) => {
      let doc = createDocument({ id: 'd1', pages: [createPage({ id: 'p1' })] });
      doc = insertNode(
        doc,
        'p1',
        createRect({ id: 'r', x, y, width: w, height: h, rotation: rot }),
        null,
      );
      const page = getPage(doc, 'p1');
      const context: InteractionContext = { page, pageId: 'p1', zoom: 1 };
      // 对侧锚点（w 边中点）世界位置——修前与修后各测一次，必须重合
      const anchorWorldOf = (node: {
        x: number;
        y: number;
        width: number;
        height: number;
        rotation: number;
      }) => {
        const cx = node.x + node.width / 2;
        const cy = node.y + node.height / 2;
        const anchor = rotateVector({ x: -node.width / 2, y: 0 }, node.rotation);
        return { x: cx + anchor.x, y: cy + anchor.y };
      };
      const before = requireNode(page, 'r');
      const anchorBefore = anchorWorldOf(before);
      let state = beginInteraction(
        IDLE,
        down({
          selection: ['r'],
          handle: { id: 'e', mode: 'resize' },
          point: { x: 0, y: 0 },
        }),
        context,
      );
      if (state.kind !== 'resize') throw new Error('应为缩放态');
      // 起点盒契约：世界中心 + 未旋转尺寸（顶层节点父系为单位阵，两者重合；
      // 世界 AABB 中心经三角函数算出，含 1e-13 级浮点误差，按 1e-9 近等断言）
      expect(state.startBounds.x).toBeCloseTo(x, 9);
      expect(state.startBounds.y).toBeCloseTo(y, 9);
      expect(state.startBounds.width).toBeCloseTo(w, 9);
      expect(state.startBounds.height).toBeCloseTo(h, 9);
      expect(state.rotation).toBe(rot);
      // 指针落在未旋转系 (x + 2w, y + h/2) 的世界对应点 → 宽度加倍
      const pointerLocal = { x: x + 2 * w, y: y + h / 2 };
      const center = { x: x + w / 2, y: y + h / 2 };
      const offset = rotateVector(
        { x: pointerLocal.x - center.x, y: pointerLocal.y - center.y },
        rot,
      );
      state = updateInteraction(
        state,
        {
          type: 'pointer.move',
          point: { x: center.x + offset.x, y: center.y + offset.y },
          screen: { x: center.x + offset.x, y: center.y + offset.y },
        },
        context,
      );
      if (state.kind !== 'resize') throw new Error('应为缩放态');
      const stack = new CommandStack(doc);
      const { commands } = commitInteraction(state, context);
      stack.dispatch(commands);
      const node = requireNode(getPage(stack.document, 'p1'), 'r');
      expect(node.width).toBeCloseTo(2 * w);
      expect(node.height).toBeCloseTo(h);
      expect(node.rotation).toBeCloseTo(rot);
      // 对侧锚点不动（对全部破坏集成员逐例断言）
      const anchorAfter = anchorWorldOf(node);
      expect(anchorAfter.x).toBeCloseTo(anchorBefore.x, 4);
      expect(anchorAfter.y).toBeCloseTo(anchorBefore.y, 4);
    },
  );

  it('旋转节点 Shift 比例缩放：未旋转系内保持宽高比', () => {
    let doc = createDocument({ id: 'd1', pages: [createPage({ id: 'p1' })] });
    doc = insertNode(
      doc,
      'p1',
      createRect({ id: 'r', x: 200, y: 100, width: 100, height: 50, rotation: 30 }),
      null,
    );
    const page = getPage(doc, 'p1');
    const context: InteractionContext = { page, pageId: 'p1', zoom: 1 };
    let state = beginInteraction(
      IDLE,
      down({
        selection: ['r'],
        handle: { id: 'se', mode: 'resize' },
        point: { x: 0, y: 0 },
      }),
      context,
    );
    // 任意偏离比例线的指针：Shift 投影后宽高比仍为 2:1
    state = updateInteraction(
      state,
      {
        type: 'pointer.move',
        point: { x: 380, y: 220 },
        screen: { x: 380, y: 220 },
        modifiers: { shift: true },
      },
      context,
    );
    if (state.kind !== 'resize') throw new Error('应为缩放态');
    expect(state.nextBounds.width / state.nextBounds.height).toBeCloseTo(2, 5);
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
