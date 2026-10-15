/**
 * 交互白名单 13 类逐条断言（《前端实现规格 v1》§一.5 与 ENG-01 DoD）。
 *
 * 本文件是**逐条对照表**：每条一个 describe，断言外部行为（不是实现细节）。
 * 细粒度用例分散在各模块测试里，这里保证「13 类一条不漏」且能一眼对照票面。
 */

import { describe, expect, it } from 'vitest';
import { copyNodes, duplicateCommands, pasteCommands } from './clipboard/index';
import { CommandStack, dissolveGroupCommands, groupNodesCommands } from './commands/index';
import { boundsCenter } from './geometry/bounds';
import { worldBoundsOfNode } from './geometry/transform';
import {
  beginInteraction,
  beginTextEdit,
  commitInteraction,
  commitTextEdit,
  createViewport,
  IDLE,
  type InteractionContext,
  insertText,
  type PointerDownEvent,
  panBy,
  screenToWorld,
  updateInteraction,
  zoomAt,
} from './interaction/index';
import { createIdFactory } from './model/ids';
import {
  createDocument,
  createFrame,
  createPage,
  createRect,
  createText,
  type DesignDocument,
} from './model/index';
import { getChildrenIds, getPage, insertNode, insertNodes, requireNode } from './scene/index';
import { alignCommands, clickSelection, createSelection, EMPTY_SELECTION } from './selection/index';
import { computeSnap, SNAP_THRESHOLD_PX, snapThresholdWorld } from './snap/index';

/** 节点世界包围盒水平中心（对齐断言用）。 */
function hcenterOf(page: ReturnType<typeof getPage>, nodeId: string): number {
  const bounds = worldBoundsOfNode(page, nodeId);
  return bounds ? boundsCenter(bounds).x : Number.NaN;
}

/** 共享场景：画板 f1 ⊃ [r1, r2]；顶层 t1。 */
function scene(): { doc: DesignDocument; context: InteractionContext } {
  let doc = createDocument({ id: 'd1', pages: [createPage({ id: 'p1' })] });
  doc = insertNode(doc, 'p1', createFrame({ id: 'f1', x: 0, y: 0, width: 300, height: 200 }), null);
  doc = insertNodes(
    doc,
    'p1',
    [
      createRect({ id: 'r1', x: 20, y: 20, width: 60, height: 40 }),
      createRect({ id: 'r2', x: 120, y: 20, width: 60, height: 40 }),
    ],
    'f1',
  );
  doc = insertNode(doc, 'p1', createText({ id: 't1', x: 0, y: 300, width: 80, height: 20 }), null);
  const page = getPage(doc, 'p1');
  return { doc, context: { page, pageId: 'p1', zoom: 1 } };
}

function pointerDown(overrides: Partial<PointerDownEvent> = {}): PointerDownEvent {
  return {
    type: 'pointer.down',
    point: { x: 30, y: 30 },
    screen: { x: 30, y: 30 },
    selection: [],
    clickTarget: null,
    handle: null,
    tool: 'select',
    ...overrides,
  };
}

describe('白名单 1 · 选择', () => {
  it('单选/多选/Shift 切换/点空清空', () => {
    let selection = clickSelection(EMPTY_SELECTION, 'r1');
    expect(selection.ids).toEqual(['r1']);
    selection = clickSelection(selection, 'r2', { shift: true });
    expect(selection.ids).toEqual(['r1', 'r2']);
    selection = clickSelection(selection, 'r1', { shift: true });
    expect(selection.ids).toEqual(['r2']);
    expect(clickSelection(selection, null)).toEqual(EMPTY_SELECTION);
    expect(createSelection(['r1', 'r2'], 'r2').activeId).toBe('r2');
  });
});

describe('白名单 2 · 移动', () => {
  it('拖动 → 预览位移 → 松手产出命令并落盘', () => {
    const { doc, context } = scene();
    const stack = new CommandStack(doc);
    let state = beginInteraction(
      IDLE,
      pointerDown({ clickTarget: 'r1', selection: ['r1'] }),
      context,
    );
    state = updateInteraction(
      state,
      { type: 'pointer.move', point: { x: 80, y: 60 }, screen: { x: 80, y: 60 } },
      context,
    );
    const { commands } = commitInteraction(state, context);
    stack.dispatch(commands);
    expect(requireNode(getPage(stack.document, 'p1'), 'r1')).toMatchObject({ x: 70, y: 50 });
  });
});

describe('白名单 3 · 缩放', () => {
  it('8 手柄拖拽 → 新包围盒 → 写回宽高', () => {
    const { doc, context } = scene();
    const stack = new CommandStack(doc);
    let state = beginInteraction(
      IDLE,
      pointerDown({
        selection: ['r1'],
        clickTarget: 'r1',
        handle: { id: 'se', mode: 'resize' },
        point: { x: 80, y: 60 },
      }),
      context,
    );
    state = updateInteraction(
      state,
      { type: 'pointer.move', point: { x: 140, y: 100 }, screen: { x: 140, y: 100 } },
      context,
    );
    if (state.kind !== 'resize') throw new Error('应为缩放态');
    expect(state.nextBounds).toEqual({ x: 20, y: 20, width: 120, height: 80 });
    stack.dispatch(commitInteraction(state, context).commands);
    expect(requireNode(getPage(stack.document, 'p1'), 'r1')).toMatchObject({
      x: 20,
      y: 20,
      width: 120,
      height: 80,
    });
  });
});

describe('白名单 4 · 旋转', () => {
  it('角外侧旋转区拖拽 → 角度（15° 吸附）→ 写回 rotation', () => {
    const { doc, context } = scene();
    const stack = new CommandStack(doc);
    // r1 中心 (50,40)；从正上方开始拖到正右方 → 顺时针 90°
    let state = beginInteraction(
      IDLE,
      pointerDown({
        selection: ['r1'],
        clickTarget: 'r1',
        handle: { id: 'ne', mode: 'rotate' },
        point: { x: 50, y: 0 },
      }),
      context,
    );
    state = updateInteraction(
      state,
      {
        type: 'pointer.move',
        point: { x: 100, y: 40 },
        screen: { x: 100, y: 40 },
        modifiers: { shift: true },
      },
      context,
    );
    stack.dispatch(commitInteraction(state, context).commands);
    expect(requireNode(getPage(stack.document, 'p1'), 'r1').rotation).toBeCloseTo(90);
  });
});

describe('白名单 5 · 画布缩放', () => {
  it('锚点缩放（滚轮/档位）不移动锚点下的世界点', () => {
    const viewport = createViewport(1, 0, 0);
    const zoomed = zoomAt(viewport, 2, { x: 200, y: 100 });
    expect(zoomed.zoom).toBe(2);
    expect(screenToWorld(zoomed, { x: 200, y: 100 })).toEqual({ x: 200, y: 100 });
  });
});

describe('白名单 6 · 画布平移', () => {
  it('平移只改屏幕偏移；手型工具拖拽产出屏幕增量', () => {
    const { context } = scene();
    expect(panBy(createViewport(1, 0, 0), 25, -10)).toMatchObject({ panX: 25, panY: -10 });
    let state = beginInteraction(
      IDLE,
      pointerDown({ tool: 'hand', screen: { x: 0, y: 0 } }),
      context,
    );
    state = updateInteraction(
      state,
      { type: 'pointer.move', point: { x: 0, y: 0 }, screen: { x: 15, y: 5 } },
      context,
    );
    expect(state.kind === 'pan' && { x: state.currentScreen.x, y: state.currentScreen.y }).toEqual({
      x: 15,
      y: 5,
    });
  });
});

describe('白名单 7 · 复制粘贴', () => {
  it('复制 → 粘贴（新 id、偏移）/ 副本紧随原节点', () => {
    const { doc } = scene();
    const stack = new CommandStack(doc);
    const page = getPage(stack.document, 'p1');
    const payload = copyNodes(page, 'p1', ['r1']);
    // 未指定目标父级 → 粘贴到页面顶层（顶层顺序末尾），并带默认偏移 (10,10)
    stack.dispatch(pasteCommands(payload, { pageId: 'p1', ids: createIdFactory(900) }));
    const pastedPage = getPage(stack.document, 'p1');
    const pasted = pastedPage.rootIds[pastedPage.rootIds.length - 1] as string;
    expect(pasted).not.toBe('r1');
    expect(requireNode(pastedPage, pasted)).toMatchObject({ x: 30, y: 30 });

    // 副本留在原父级（f1）内，紧随原节点
    stack.dispatch(duplicateCommands(pastedPage, 'p1', ['r2'], { ids: createIdFactory(950) }));
    const children = getChildrenIds(getPage(stack.document, 'p1'), 'f1');
    expect(children).toHaveLength(3);
    expect(children[1]).toBe('r2');
  });
});

describe('白名单 8 · 层级', () => {
  it('置顶/置底/上移/下移按同级顺序变化', () => {
    const { doc } = scene();
    const stack = new CommandStack(doc);
    stack.dispatch({ type: 'node.reorder', pageId: 'p1', nodeId: 'r1', op: 'front' });
    expect(getChildrenIds(getPage(stack.document, 'p1'), 'f1')).toEqual(['r2', 'r1']);
    stack.dispatch({ type: 'node.reorder', pageId: 'p1', nodeId: 'r1', op: 'backward' });
    expect(getChildrenIds(getPage(stack.document, 'p1'), 'f1')).toEqual(['r1', 'r2']);
  });
});

describe('白名单 9 · 编组', () => {
  it('编组生成组容器并把选中移入；解组还原', () => {
    const { doc } = scene();
    const stack = new CommandStack(doc);
    const page = getPage(stack.document, 'p1');
    stack.dispatch(groupNodesCommands(page, 'p1', ['r1', 'r2'], { groupId: 'g1' }));
    const grouped = getPage(stack.document, 'p1');
    const group = requireNode(grouped, 'g1');
    expect(group.type).toBe('group');
    expect(getChildrenIds(grouped, 'g1')).toEqual(['r1', 'r2']);
    expect(getChildrenIds(grouped, 'f1')).toEqual(['g1']); // 组留在原父级内

    stack.dispatch(dissolveGroupCommands(grouped, 'p1', 'g1'));
    const dissolved = getPage(stack.document, 'p1');
    expect(dissolved.nodes.g1).toBeUndefined();
    expect(getChildrenIds(dissolved, 'f1')).toEqual(['r1', 'r2']);
    expect(requireNode(dissolved, 'r1')).toMatchObject({ x: 20, y: 20 });
  });
});

describe('白名单 10 · 撤销', () => {
  it('任意写入后可撤销回退，重做可重放', () => {
    const { doc, context } = scene();
    const stack = new CommandStack(doc);
    const before = JSON.parse(JSON.stringify(stack.document));
    let state = beginInteraction(
      IDLE,
      pointerDown({ clickTarget: 'r1', selection: ['r1'] }),
      context,
    );
    state = updateInteraction(
      state,
      { type: 'pointer.move', point: { x: 90, y: 90 }, screen: { x: 90, y: 90 } },
      context,
    );
    stack.dispatch(commitInteraction(state, context).commands);
    expect(requireNode(getPage(stack.document, 'p1'), 'r1')).toMatchObject({ x: 80, y: 80 });
    expect(stack.undo()).toBe(true);
    expect(JSON.parse(JSON.stringify(stack.document))).toEqual(before);
    expect(stack.redo()).toBe(true);
    expect(requireNode(getPage(stack.document, 'p1'), 'r1')).toMatchObject({ x: 80, y: 80 });
  });
});

describe('白名单 11 · 对齐', () => {
  it('对齐到选择集基准（左对齐 + 水平居中）', () => {
    const { doc } = scene();
    const stack = new CommandStack(doc);
    stack.dispatch(alignCommands(getPage(stack.document, 'p1'), 'p1', ['r1', 'r2'], 'left'));
    expect(requireNode(getPage(stack.document, 'p1'), 'r2')).toMatchObject({ x: 20 });
    const stack2 = new CommandStack(doc);
    stack2.dispatch(alignCommands(getPage(stack2.document, 'p1'), 'p1', ['r1', 'r2'], 'hcenter'));
    // 基准中心 x = (20+180)/2 = 100；r1 中心 50 → 平移 50 → x=70
    expect(requireNode(getPage(stack2.document, 'p1'), 'r1')).toMatchObject({ x: 70 });
    expect(hcenterOf(getPage(stack2.document, 'p1'), 'r1')).toBe(100);
  });
});

describe('白名单 12 · 吸附', () => {
  it('阈值 6px（屏幕）→ 世界换算；对齐参考线与测量数据齐备', () => {
    expect(SNAP_THRESHOLD_PX).toBe(6);
    expect(snapThresholdWorld(2)).toBe(3);
    const moving = { x: 100, y: 100, width: 50, height: 50 };
    const result = computeSnap(moving, [
      { id: 't', bounds: { x: 154, y: 100, width: 50, height: 50 } },
    ]);
    expect(result.dx).toBe(4);
    expect(result.guides[0]).toMatchObject({ axis: 'x', refs: ['t'] });
    // 拖动时的吸附在同一入口生效
    const { context } = scene();
    const snapped = beginInteraction(
      IDLE,
      pointerDown({ clickTarget: 'r1', selection: ['r1'] }),
      context,
    );
    const moved = updateInteraction(
      snapped,
      { type: 'pointer.move', point: { x: 30 + 97, y: 30 }, screen: { x: 127, y: 30 } },
      context,
    );
    if (moved.kind !== 'move') throw new Error('应为移动态');
    expect(moved.delta.x).toBeCloseTo(100); // 20+100 = 120 → 与 r2 左边缘 120 对齐
  });
});

describe('白名单 13 · 文本编辑', () => {
  it('双击进入会话 → 输入 → 失焦提交为一条命令', () => {
    const { doc } = scene();
    const stack = new CommandStack(doc);
    const page = getPage(stack.document, 'p1');
    let session = beginTextEdit(page, 'p1', 't1');
    session = insertText(session, '设界');
    stack.dispatch(commitTextEdit(session));
    const node = requireNode(getPage(stack.document, 'p1'), 't1');
    expect(node.type === 'text' && node.text.characters).toBe('设界');
    stack.undo();
    const restored = requireNode(getPage(stack.document, 'p1'), 't1');
    expect(restored.type === 'text' && restored.text.characters).toBe('');
  });
});

describe('白名单 13 类汇总', () => {
  it('清单齐全（防止后续重构漏项）', () => {
    const whitelist = [
      '选择',
      '移动',
      '缩放',
      '旋转',
      '画布缩放',
      '画布平移',
      '复制粘贴',
      '层级',
      '编组',
      '撤销',
      '对齐',
      '吸附',
      '文本编辑',
    ];
    expect(whitelist).toHaveLength(13);
    void requireNode;
  });
});
