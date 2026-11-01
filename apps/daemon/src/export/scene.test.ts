import { describe, expect, it } from 'vitest';

import { extractScene } from './scene.ts';

/**
 * `extractScene`  seam：导出用最小场景提取（对 opaque 页面 JSON 的容错解析）。
 *
 * 这里只断言**对外事实**——返回的 RenderScene 的 `complete` / `nodes` / 计数，
 * 不碰任何内部遍历细节。契约口径（`packages/contracts/src/export/index.ts`）：
 * `complete` 是「产物是否覆盖页面全部可渲染节点」的保证；未判定/部分结果不得当完整报。
 */

/** web 落盘信封：`{ $format: 'dforge.canvas.page', page, tokens }`。 */
function envelope(page: unknown): Record<string, unknown> {
  return { $format: 'dforge.canvas.page', $version: 1, page, tokens: {} };
}

describe('extractScene · 信封页面完整性（票 18 红线：不把未判定当完整）', () => {
  it('信封 page 为 null：不能认证为完整（产物是空白）', () => {
    const scene = extractScene(envelope(null));
    expect(scene.nodes).toHaveLength(0);
    expect(scene.complete).toBe(false);
  });

  it('信封 page 为空数组：不能认证为完整', () => {
    const scene = extractScene(envelope([]));
    expect(scene.nodes).toHaveLength(0);
    expect(scene.complete).toBe(false);
  });

  it('信封 page 为字符串（不可解析）：不能认证为完整', () => {
    const scene = extractScene(envelope('oops'));
    expect(scene.nodes).toHaveLength(0);
    expect(scene.complete).toBe(false);
  });

  it('信封缺 page 字段：不能认证为完整', () => {
    const scene = extractScene({ $format: 'dforge.canvas.page', $version: 1 });
    expect(scene.nodes).toHaveLength(0);
    expect(scene.complete).toBe(false);
  });

  it('信封有 30 个可渲染节点但 rootIds 为空：一个都没进产物 → 非完整', () => {
    const nodes: Record<string, unknown> = {};
    for (let index = 0; index < 30; index += 1) {
      nodes[`rect-${String(index)}`] = {
        id: `rect-${String(index)}`,
        type: 'rect',
        x: index,
        y: 0,
        width: 10,
        height: 10,
        visible: true,
        fills: [],
        children: [],
      };
    }
    const scene = extractScene(
      envelope({ id: 'page-1', nodes, rootIds: [], backgroundColor: '#FFFFFF' }),
    );
    expect(scene.nodes).toHaveLength(0);
    expect(scene.complete).toBe(false);
  });

  it('真正空的页面（无节点、无根）：诚实报 complete=true（覆盖全部 0 个可渲染节点）', () => {
    const scene = extractScene(
      envelope({ id: 'page-1', nodes: {}, rootIds: [], backgroundColor: '#FFFFFF' }),
    );
    expect(scene.nodes).toHaveLength(0);
    // 与「有可渲染节点却产出为空」区分开：这里节点表本就为空，无损失可报，故完整。
    expect(scene.complete).toBe(true);
  });

  it('存量顶层形状：非对象子节点被丢弃 → 计为跳过且非完整', () => {
    const scene = extractScene({
      width: 100,
      height: 100,
      background: '#FFFFFF',
      children: ['oops', { kind: 'rect', x: 0, y: 0, width: 10, height: 10 }],
    });
    expect(scene.nodes).toHaveLength(1);
    expect(scene.skippedNodes).toBe(1);
    expect(scene.complete).toBe(false);
  });
});

/** 一枚可见矩形 + 一枚隐藏矩形（同层，均挂根）。 */
function visiblePlusHidden(): Record<string, unknown> {
  return envelope({
    id: 'page-1',
    nodes: {
      'visible-1': {
        id: 'visible-1',
        type: 'rect',
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        visible: true,
        children: [],
      },
      'hidden-1': {
        id: 'hidden-1',
        type: 'rect',
        x: 20,
        y: 0,
        width: 10,
        height: 10,
        visible: false,
        children: [],
      },
    },
    rootIds: ['visible-1', 'hidden-1'],
    backgroundColor: '#FFFFFF',
  });
}

describe('extractScene · 隐藏层是非损失（票 18 部分态误报）', () => {
  it('只有一枚隐藏节点：产物本就正确，不得判部分（complete=true，hiddenNodes 单列）', () => {
    const scene = extractScene(visiblePlusHidden());
    expect(scene.nodes).toHaveLength(1);
    expect(scene.hiddenNodes).toBe(1);
    expect(scene.skippedNodes).toBe(0);
    expect(scene.truncatedNodes).toBe(0);
    expect(scene.complete).toBe(true);
  });

  it('隐藏容器连整棵子树都不渲染：子节点计隐藏、不计损失', () => {
    const scene = extractScene(
      envelope({
        id: 'page-1',
        nodes: {
          'hidden-box': {
            id: 'hidden-box',
            type: 'group',
            x: 0,
            y: 0,
            width: 40,
            height: 40,
            visible: false,
            children: ['kid-1', 'kid-2'],
          },
          'kid-1': {
            id: 'kid-1',
            type: 'rect',
            x: 0,
            y: 0,
            width: 10,
            height: 10,
            visible: true,
            children: [],
          },
          'kid-2': {
            id: 'kid-2',
            type: 'rect',
            x: 10,
            y: 0,
            width: 10,
            height: 10,
            visible: true,
            children: [],
          },
        },
        rootIds: ['hidden-box'],
        backgroundColor: '#FFFFFF',
      }),
    );
    // 隐藏父节点让整棵子树都不进渲染（应用侧 drawNode 见 !visible 即 return）→ 全计隐藏、非损失
    expect(scene.nodes).toHaveLength(0);
    expect(scene.hiddenNodes).toBe(3);
    expect(scene.skippedNodes).toBe(0);
    expect(scene.complete).toBe(true);
  });
});

describe('extractScene · 预算越界按整棵子树计 truncated（下界不再是 1）', () => {
  it('被拒容器连子树逐枚计入 truncated；容器下的隐藏子计隐藏', () => {
    const nodes: Record<string, unknown> = {};
    const rootIds: string[] = [];
    // 先填满 2000 枚可见叶子（用满预算）
    for (let index = 0; index < 2000; index += 1) {
      const id = `leaf-${String(index)}`;
      nodes[id] = {
        id,
        type: 'rect',
        x: index,
        y: 0,
        width: 1,
        height: 1,
        visible: true,
        children: [],
      };
      rootIds.push(id);
    }
    // 第 2001 枚是容器：命中预算闸门被拒，其子树也一并被丢弃
    nodes.over = {
      id: 'over',
      type: 'group',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      visible: true,
      children: ['oc-1', 'oc-2', 'oc-3', 'oc-hidden'],
    };
    rootIds.push('over');
    for (const id of ['oc-1', 'oc-2', 'oc-3']) {
      nodes[id] = {
        id,
        type: 'rect',
        x: 0,
        y: 0,
        width: 5,
        height: 5,
        visible: true,
        children: [],
      };
    }
    nodes['oc-hidden'] = {
      id: 'oc-hidden',
      type: 'rect',
      x: 0,
      y: 0,
      width: 5,
      height: 5,
      visible: false,
      children: [],
    };

    const scene = extractScene(
      envelope({ id: 'page-1', nodes, rootIds, backgroundColor: '#FFFFFF' }),
    );
    expect(scene.complete).toBe(false);
    // over + oc-1/2/3 = 4 枚真被丢弃（预算截断）；oc-hidden 是非损失（隐藏）
    expect(scene.truncatedNodes).toBe(4);
    expect(scene.hiddenNodes).toBe(1);
  });
});
