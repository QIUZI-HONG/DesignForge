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
});
