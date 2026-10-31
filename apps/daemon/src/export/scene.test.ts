import { describe, expect, it } from 'vitest';

import { extractScene } from './scene.ts';

/**
 * web 真实落盘信封（`documents-client.ts` 的 `encodePageBody` 输出形状）：
 * `{ $format: 'dforge.canvas.page', $version: 1, page: ScenePage, tokens }`，
 * 其中 ScenePage 是**扁平节点表**（`nodes: Record<id, node>`）+ `rootIds` 顶层顺序
 * （引擎 `model/node.ts`：children 是 NodeId 引用，不是嵌套对象）。
 */

/** 构造一个引擎形状的矩形节点（字段集对齐 `RectNode`）。 */
function rectNode(
  id: string,
  overrides: Partial<{
    x: number;
    y: number;
    width: number;
    height: number;
    color: string;
    visible: boolean;
    opacity: number;
  }> = {},
): Record<string, unknown> {
  return {
    id,
    name: '矩形',
    type: 'rect',
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    rotation: 0,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    fills: [{ type: 'solid', color: '#FF0000', opacity: 1, visible: true }],
    strokes: [],
    effects: [],
    cornerRadius: 0,
    ...overrides,
    ...(overrides.color === undefined
      ? {}
      : { fills: [{ type: 'solid', color: overrides.color, opacity: 1, visible: true }] }),
  };
}

/** 装配信封正文（对齐 `encodePageBody` 的输出）。 */
function envelopePage(init: {
  nodes: Record<string, unknown>;
  rootIds: string[];
  backgroundColor?: string;
}): Record<string, unknown> {
  return {
    $format: 'dforge.canvas.page',
    $version: 1,
    page: {
      id: 'page-1',
      name: '页面 1',
      nodes: init.nodes,
      rootIds: init.rootIds,
      backgroundColor: init.backgroundColor ?? '#F5F5F5',
      grid: { size: 10, visible: false, snapToGrid: false, style: 'grid' },
    },
    tokens: {},
  };
}

describe('extractScene · dforge.canvas.page 信封分支', () => {
  it('识别信封：按 rootIds 顺序展平 nodes，背景取 page.backgroundColor，尺寸取内容包围盒', () => {
    const body = envelopePage({
      nodes: {
        'rect-1': rectNode('rect-1', { x: 10, y: 20, width: 120, height: 60, color: '#FF0000' }),
        'rect-2': rectNode('rect-2', { x: 200, y: 40, width: 80, height: 90, color: '#00AA00' }),
      },
      rootIds: ['rect-1', 'rect-2'],
    });
    const scene = extractScene(body);
    expect(scene.background).toBe('#F5F5F5');
    // 包围盒：max(x+width) = 200+80 = 280，max(y+height) = 40+90 = 130
    expect(scene.width).toBe(280);
    expect(scene.height).toBe(130);
    expect(scene.nodes).toHaveLength(2);
    // 顶层顺序 = rootIds 顺序（后者在上）
    expect(scene.nodes[0]?.fill).toBe('#FF0000');
    expect(scene.nodes[1]?.fill).toBe('#00AA00');
    expect(scene.nodes[1]?.x).toBe(200);
    expect(scene.nodes[1]?.y).toBe(40);
    expect(scene.skippedNodes).toBe(0);
  });

  it('容器子节点按 NodeId 引用解析（frame.children 指向扁平表）', () => {
    const body = envelopePage({
      nodes: {
        'frame-1': {
          id: 'frame-1',
          name: '画板',
          type: 'frame',
          x: 0,
          y: 0,
          width: 400,
          height: 300,
          rotation: 0,
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'normal',
          fills: [{ type: 'solid', color: '#FFFFFF', opacity: 1, visible: true }],
          strokes: [],
          effects: [],
          cornerRadius: 0,
          children: ['rect-a', 'rect-b'],
          clipsContent: true,
          autoLayout: null,
        },
        'rect-a': rectNode('rect-a', { x: 10, y: 10, width: 50, height: 50, color: '#FF0000' }),
        'rect-b': rectNode('rect-b', { x: 300, y: 200, width: 60, height: 60, color: '#0000FF' }),
      },
      rootIds: ['frame-1'],
    });
    const scene = extractScene(body);
    expect(scene.nodes).toHaveLength(1);
    const frame = scene.nodes[0];
    expect(frame?.kind).toBe('frame');
    expect(frame?.children).toHaveLength(2);
    expect(frame?.children[0]?.fill).toBe('#FF0000');
    expect(frame?.children[1]?.fill).toBe('#0000FF');
    // 包围盒含容器本体与子节点：max(400, 300+60)=400，max(300, 200+60)=300
    expect(scene.width).toBe(400);
    expect(scene.height).toBe(300);
    expect(scene.skippedNodes).toBe(0);
  });

  it('文本节点读 TextContent（characters/fontSize 嵌套在 text 字段）', () => {
    const textBody = {
      id: 'text-1',
      name: '文本',
      type: 'text',
      x: 20,
      y: 30,
      width: 100,
      height: 24,
      rotation: 0,
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      fills: [{ type: 'solid', color: '#000000', opacity: 1, visible: true }],
      strokes: [],
      effects: [],
      cornerRadius: 0,
      text: {
        characters: '你好，设界',
        fontFamily: 'Noto Sans SC',
        fontSize: 24,
        fontWeight: 400,
        lineHeight: 1.4,
        letterSpacing: 0,
        align: 'left',
        autoResize: 'width_and_height',
      },
    };
    const body = envelopePage({ nodes: { 'text-1': textBody }, rootIds: ['text-1'] });
    const scene = extractScene(body);
    expect(scene.nodes).toHaveLength(1);
    expect(scene.nodes[0]?.kind).toBe('text');
    expect(scene.nodes[0]?.text).toBe('你好，设界');
    expect(scene.nodes[0]?.fontSize).toBe(24);
    expect(scene.skippedNodes).toBe(0);
  });

  it('实例/未知类型跳过并计数（daemon 不解析组件语义）', () => {
    const instanceNode = {
      ...rectNode('inst-1', { color: '#123456' }),
      type: 'instance',
      componentId: 'comp-1',
      overrides: {},
    };
    const body = envelopePage({
      nodes: {
        'rect-1': rectNode('rect-1', { color: '#FF0000' }),
        'inst-1': instanceNode,
      },
      rootIds: ['rect-1', 'inst-1'],
    });
    const scene = extractScene(body);
    expect(scene.nodes).toHaveLength(1);
    expect(scene.nodes[0]?.fill).toBe('#FF0000');
    expect(scene.skippedNodes).toBe(1);
  });

  it('隐藏节点（visible:false）不参与渲染并计数', () => {
    const body = envelopePage({
      nodes: {
        'rect-1': rectNode('rect-1', { color: '#FF0000' }),
        'rect-2': rectNode('rect-2', { color: '#00AA00', visible: false }),
      },
      rootIds: ['rect-1', 'rect-2'],
    });
    const scene = extractScene(body);
    expect(scene.nodes).toHaveLength(1);
    expect(scene.nodes[0]?.fill).toBe('#FF0000');
    expect(scene.skippedNodes).toBe(1);
  });

  it('悬空引用（rootIds/children 指向不存在的 id）跳过并计数，不抛错', () => {
    const body = envelopePage({
      nodes: { 'rect-1': rectNode('rect-1', { color: '#FF0000' }) },
      rootIds: ['rect-1', 'ghost-1'],
    });
    const scene = extractScene(body);
    expect(scene.nodes).toHaveLength(1);
    expect(scene.skippedNodes).toBe(1);
  });

  it('节点表成环时不挂死：环上每个节点至多渲染一次', () => {
    const a = rectNode('a', { color: '#FF0000' });
    const b = rectNode('b', { color: '#00AA00' });
    (a as Record<string, unknown>).children = ['b'];
    (b as Record<string, unknown>).children = ['a'];
    const body = envelopePage({ nodes: { a, b }, rootIds: ['a'] });
    const scene = extractScene(body);
    expect(scene.nodes).toHaveLength(1);
    expect(scene.nodes[0]?.fill).toBe('#FF0000');
    expect(scene.nodes[0]?.children).toHaveLength(1);
    expect(scene.nodes[0]?.children[0]?.children).toHaveLength(0);
    // b 的 child a 已渲染过 → 计跳过
    expect(scene.skippedNodes).toBe(1);
  });

  it('rootIds 缺失时兜底：未被任何容器引用的节点视为顶层（旧数据容错）', () => {
    const parent = rectNode('parent', { color: '#FF0000' });
    (parent as Record<string, unknown>).type = 'frame';
    (parent as Record<string, unknown>).children = ['child'];
    const body = {
      $format: 'dforge.canvas.page',
      $version: 1,
      page: {
        id: 'page-1',
        name: '页面 1',
        nodes: { parent, child: rectNode('child', { color: '#00AA00' }) },
        backgroundColor: '#F5F5F5',
      },
      tokens: {},
    };
    const scene = extractScene(body);
    expect(scene.nodes).toHaveLength(1);
    expect(scene.nodes[0]?.children).toHaveLength(1);
    expect(scene.skippedNodes).toBe(0);
  });

  it('画刷 visible:false 时取下一个可见填充（引擎 SolidPaint.visible）', () => {
    const node = rectNode('rect-1', { color: '#00AA00' });
    (node as Record<string, unknown>).fills = [
      { type: 'solid', color: '#FF0000', opacity: 1, visible: false },
      { type: 'solid', color: '#00AA00', opacity: 1, visible: true },
    ];
    const body = envelopePage({ nodes: { 'rect-1': node }, rootIds: ['rect-1'] });
    const scene = extractScene(body);
    expect(scene.nodes[0]?.fill).toBe('#00AA00');
  });
});
