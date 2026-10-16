/**
 * 对抗性验证 · 风险 1：写路径唯一性（能否绕过 engine 命令栈直接改文档？）
 *
 * 验证口径（失败 = 缺陷）：
 * 1. 生产装配（`createEditorWorkspace`，即 `/editor` 的真实接线）拿到的栈**未开 freeze** 时，
 *    就地改 `getSnapshot()` 返回的对象能否静默生效（无历史、无订阅通知）；
 * 2. 开 freeze 时同一手法必须抛错且文档不变；
 * 3. 事务原子性：一组命令中途失败 → 文档逐字段不变、无历史条目；
 * 4. 画布会话/面板会话暴露的文档引用必须与栈内同一份（不存在第二份文档）。
 *
 * 这些用例是「能抓住缺陷的测试」：第 1 组当前即失败（断言冻结），失败本身即证据。
 */
import {
  CommandStack,
  createDocument,
  createFrame,
  createPage,
  createRect,
  createSelection,
  getPage,
  isCommandError,
  serializeDocument,
  worldBoundsOfNodes,
} from '@dforge/engine';
import { describe, expect, it, vi } from 'vitest';

import { createCanvasSession } from '@/features/canvas/state/session';
import {
  createEditorWorkspace,
  EMPTY_PRESET,
  panelsSelectionPort,
} from '@/features/canvas/workspace/workspace-session';
import { createPanelsSession } from '@/features/editor-panels';

/** 一页两节点（矩形 + 画板）。 */
function makeDocument() {
  const rect = createRect({ id: 'n_rect', x: 10, y: 20, width: 100, height: 50 });
  const frame = createFrame({ id: 'n_frame', x: 200, y: 100, width: 300, height: 200 });
  const page = createPage({
    id: 'page_1',
    rootIds: ['n_rect', 'n_frame'],
    nodes: { n_rect: rect, n_frame: frame },
  });
  return createDocument({ id: 'doc_1', pages: [page] });
}

describe('写路径唯一性', () => {
  it('透明栈（生产默认）就地写快照：能否不经命令栈改文档（对抗：期望被拦下）', () => {
    const stack = new CommandStack(makeDocument());
    const before = serializeDocument(stack.getSnapshot());

    // 旁路尝试：拿到快照就地改字段（模拟某个组件「顺手赋值」的写法）
    const mutated = stack.getSnapshot().pages[0] as ReturnType<typeof createPage>;
    (mutated.nodes.n_rect as { x: number }).x = 999;

    const after = serializeDocument(stack.getSnapshot());
    // 结论断言：生产默认配置下，这一步**没有**被拦下 → 文档真值被绕过改写
    expect(after, '就地写入被静默接受：旁路成立').not.toBe(before);
    expect(stack.canUndo, '旁路写入不进历史：撤销栈为空').toBe(false);
    expect(stack.history().undo).toHaveLength(0);
  });

  it('开 freeze 时同一手法必须抛错，且文档/历史不变', () => {
    const stack = new CommandStack(makeDocument(), { freeze: true });
    const before = serializeDocument(stack.getSnapshot());
    expect(() => {
      (stack.getSnapshot().pages[0]!.nodes.n_rect as { x: number }).x = 999;
    }).toThrow();
    expect(serializeDocument(stack.getSnapshot())).toBe(before);
    expect(stack.canUndo).toBe(false);
  });

  it('[缺陷] /editor 生产装配（createEditorWorkspace）应启用 freeze —— 当前未启用，旁路成立', () => {
    const workspace = createEditorWorkspace(EMPTY_PRESET);
    const snapshot = workspace.canvas.stack.getSnapshot();
    // 记录：装配层把这个「对象」交给了整个 UI 树
    let threw = false;
    try {
      (snapshot.pages[0] as { name: string }).name = '被就地改名';
    } catch {
      threw = true;
    }
    expect(threw, '/editor 装配未冻结文档：任何持有快照的组件都能就地改写').toBe(true);
  });

  it('画布/面板拿到的是同一份文档（不存在第二份真值）', () => {
    const document = makeDocument();
    const panels = createPanelsSession({ document, pageId: 'page_1' });
    const canvas = createCanvasSession({
      stack: panels.stack,
      document,
      pageId: 'page_1',
      selectionPort: panelsSelectionPort(panels),
    });
    expect(canvas.document()).toBe(panels.stack.getSnapshot());
    expect(canvas.document()).toBe(panels.getSnapshot());
    expect(canvas.page()).toBe(getPage(panels.stack.getSnapshot(), 'page_1'));
  });

  it('事务原子性：一组命令中途失败 → 文档逐字段不变、无历史（不留半成品）', () => {
    const stack = new CommandStack(makeDocument());
    const before = serializeDocument(stack.getSnapshot());
    const listener = vi.fn();
    stack.subscribe(listener);

    expect(() =>
      stack.dispatch([
        { type: 'node.update', pageId: 'page_1', nodeId: 'n_rect', patch: { x: 111 } },
        { type: 'node.remove', pageId: 'page_1', nodeId: '不存在' },
      ]),
    ).toThrow();

    expect(serializeDocument(stack.getSnapshot())).toBe(before);
    expect(stack.canUndo).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('命令错误带位置与错误码（上层能区分「哪条命令坏了」）', () => {
    const stack = new CommandStack(makeDocument());
    // 坏文档（页面 nodes 表里挂着一个不存在的子 id）触发 document.replace 的结构校验
    const broken = makeDocument();
    (broken.pages[0]! as { nodes: Record<string, unknown> }).nodes = {
      n_rect: { ...broken.pages[0]!.nodes.n_rect, children: ['幽灵'] },
    };
    try {
      stack.dispatch([
        { type: 'node.update', pageId: 'page_1', nodeId: 'n_rect', patch: { x: 1 } },
        { type: 'document.replace', document: broken },
      ]);
      expect.unreachable('应抛 CommandError');
    } catch (error) {
      expect(isCommandError(error)).toBe(true);
      if (isCommandError(error)) {
        expect(error.commandIndex).toBe(1);
        expect(typeof error.code).toBe('string');
      }
    }
    // 第一条命令也不得残留
    expect(stack.canUndo).toBe(false);
  });

  it('选中集合里的失效 id 参与几何运算时应被忽略而非崩溃（拖动中节点被删除的最小面）', () => {
    const page = getPage(makeDocument(), 'page_1');
    expect(worldBoundsOfNodes(page, ['n_rect', '已被删除'])).toEqual(
      worldBoundsOfNodes(page, ['n_rect']),
    );
    expect(createSelection(['已被删除']).ids).toEqual(['已被删除']);
  });
});
