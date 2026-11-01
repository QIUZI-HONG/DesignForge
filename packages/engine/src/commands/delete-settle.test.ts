/**
 * 删除命令的引用收口回归缝（复核 H1 · 票 17 后续）。
 *
 * 缺陷现场：删除主组件只发一条裸 `node.remove`（`commands/helpers.ts`），
 * 指向它的实例留在页面上成了悬空引用 → 引擎 `validateDocument` 报 `missing-component`；
 * 而票 17 给写盘加的前置校验（web `saveDesignDocument` / daemon 页正文守门）随后
 * **拒绝整份文档**，用户按 ⌘S 再也存不了（消息见 `documents-client`）。
 *
 * 判据（与粘贴同一条口径，票 17「粘贴不得留下悬空引用」）：
 * 删除**不得产出**悬空引用——主组件消失时依赖者按粘贴的降级口径就地收口
 * （实例 → 普通帧、悬空组件集引用 → null），且与删除本身合成**一个复合命令**，
 * 一次撤销同时还原主组件与被收口的引用。
 *
 * 缝：意图级命令构造器 `deleteNodesCommands`（UI 删除键的唯一路径）+ `CommandStack`
 * + 引擎校验/序列化公开面；不断言内部实现（命令条数、私有函数）。
 */

import { describe, expect, it } from 'vitest';
import {
  createComponent,
  createComponentSet,
  createDocument,
  createFrame,
  createInstance,
  createPage,
  createRect,
  type DesignDocument,
} from '../model/index';
import { getPage, insertNode, insertNodes, validateDocument } from '../scene/index';
import { parseDocument, serializeDocument } from '../serialize/index';
import { CommandStack, deleteNodesCommands } from './index';

/** 删除 = UI 的一次事务：命令构造 → 单条 dispatch（一个历史条目）。 */
function deleteThroughStack(
  doc: DesignDocument,
  pageId: string,
  nodeIds: readonly string[],
): CommandStack {
  const stack = new CommandStack(doc);
  stack.dispatch(deleteNodesCommands(getPage(stack.document, pageId), pageId, nodeIds), {
    label: '删除',
  });
  return stack;
}

/** 删除后的问题码（写读同源的前提：删除不产出非法结构）。 */
function codesOf(doc: DesignDocument): string[] {
  return validateDocument(doc).map((issue) => issue.code);
}

describe('删除 · 主组件消失时收口依赖者（复核 H1）', () => {
  it('删除主组件（同页有实例）：文档仍然自洽、实例降级为普通帧、序列化可重开', () => {
    let doc = createDocument({ id: 'd1', pages: [createPage({ id: 'p1' })] });
    doc = insertNode(
      doc,
      'p1',
      createComponent({ id: 'c1', x: 0, y: 0, width: 100, height: 60 }),
      null,
    );
    doc = insertNode(
      doc,
      'p1',
      createRect({ id: 'cc1', x: 10, y: 10, width: 50, height: 20 }),
      'c1',
    );
    doc = insertNode(
      doc,
      'p1',
      createInstance({ id: 'i1', componentId: 'c1', x: 200, y: 0, width: 100, height: 60 }),
      null,
    );
    expect(codesOf(doc)).toEqual([]);

    const stack = deleteThroughStack(doc, 'p1', ['c1']);
    const after = stack.document;

    // 删除不得产出悬空引用（票 17 写盘前置校验据此拒绝整份文档）
    expect(codesOf(after)).toEqual([]);
    const settled = getPage(after, 'p1').nodes.i1;
    expect(settled?.type).toBe('frame');
    expect(settled).not.toHaveProperty('componentId');
    expect(settled).not.toHaveProperty('overrides');
    // 几何按降级口径保持原值（与粘贴降级同一条规则）
    expect(settled).toMatchObject({ id: 'i1', x: 200, y: 0, width: 100, height: 60 });
    expect(getPage(after, 'p1').nodes.c1).toBeUndefined();

    // 保存/重开闭环：合法文档能序列化并能解析回来（票 23 的锁定路径正是解析侧抛错）
    const reopened = parseDocument(serializeDocument(after)).document;
    expect(codesOf(reopened)).toEqual([]);
    expect(getPage(reopened, 'p1').nodes.i1?.type).toBe('frame');
  });

  it('一次撤销同时还原主组件与实例的 componentId（删除是一个复合命令）', () => {
    let doc = createDocument({ id: 'd1', pages: [createPage({ id: 'p1' })] });
    doc = insertNode(
      doc,
      'p1',
      createComponent({ id: 'c1', x: 0, y: 0, width: 100, height: 60 }),
      null,
    );
    doc = insertNode(
      doc,
      'p1',
      createRect({ id: 'cc1', x: 10, y: 10, width: 50, height: 20 }),
      'c1',
    );
    doc = insertNode(
      doc,
      'p1',
      createInstance({ id: 'i1', componentId: 'c1', x: 200, y: 0, width: 100, height: 60 }),
      null,
    );
    const before = structuredClone(doc);

    const stack = deleteThroughStack(doc, 'p1', ['c1']);
    expect(stack.undo()).toBe(true);

    // 一次撤销 = 逐字段回到删除前（主组件 + 实例引用都在，无需撤销两次）
    expect(structuredClone(stack.document)).toEqual(before);
    expect(codesOf(stack.document)).toEqual([]);
    const restored = stack.document.pages[0]?.nodes.i1;
    expect(restored?.type).toBe('instance');
    if (restored?.type === 'instance') expect(restored.componentId).toBe('c1');
    // 撤销后的文档能正常保存（写盘守门不再拦住这份文档）
    expect(codesOf(parseDocument(serializeDocument(stack.document)).document)).toEqual([]);
  });

  it('同父多个实例 + 顶层与画板内混合：降级帧回到原父级与原绘制次序', () => {
    let doc = createDocument({ id: 'd1', pages: [createPage({ id: 'p1' })] });
    doc = insertNode(
      doc,
      'p1',
      createFrame({ id: 'f1', x: 0, y: 0, width: 300, height: 200 }),
      null,
    );
    doc = insertNodes(
      doc,
      'p1',
      [
        createRect({ id: 'a', x: 0, y: 0 }),
        createInstance({ id: 'i1', componentId: 'c1', x: 10, y: 0 }),
        createRect({ id: 'b', x: 20, y: 0 }),
        createRect({ id: 'c', x: 30, y: 0 }),
        createInstance({ id: 'i2', componentId: 'c1', x: 40, y: 0 }),
      ],
      'f1',
    );
    doc = insertNode(doc, 'p1', createComponent({ id: 'c1', x: 400, y: 0 }), null);
    doc = insertNode(
      doc,
      'p1',
      createInstance({ id: 'i3', componentId: 'c1', x: 600, y: 0 }),
      null,
    );
    expect(codesOf(doc)).toEqual([]);

    const stack = deleteThroughStack(doc, 'p1', ['c1']);
    const after = getPage(stack.document, 'p1');
    expect(codesOf(stack.document)).toEqual([]);
    // 降级帧不因为「主组件先被删掉」而整体偏位：f1 内次序仍是 a → i1 → b → c → i2
    expect(after.nodes.f1).toMatchObject({ children: ['a', 'i1', 'b', 'c', 'i2'] });
    // 顶层实例 i3 仍在顶层原位（c1 之后），且同样是降级帧
    expect(after.rootIds).toEqual(['f1', 'i3']);
    expect(after.nodes.i1?.type).toBe('frame');
    expect(after.nodes.i2?.type).toBe('frame');
    expect(after.nodes.i3?.type).toBe('frame');

    expect(stack.undo()).toBe(true);
    expect(structuredClone(stack.document)).toEqual(structuredClone(doc));
  });

  it('收口只针对被删主组件：指向其它主组件的实例不受影响', () => {
    let doc = createDocument({ id: 'd1', pages: [createPage({ id: 'p1' })] });
    doc = insertNode(doc, 'p1', createComponent({ id: 'c1', x: 0, y: 0 }), null);
    doc = insertNode(doc, 'p1', createComponent({ id: 'c2', x: 200, y: 0 }), null);
    doc = insertNode(doc, 'p1', createInstance({ id: 'i1', componentId: 'c1' }), null);
    doc = insertNode(doc, 'p1', createInstance({ id: 'i2', componentId: 'c2' }), null);
    doc = insertNode(doc, 'p1', createRect({ id: 'gone', x: 900, y: 0 }), null);
    expect(codesOf(doc)).toEqual([]);

    // 一次删除里同时删掉「有实例的主组件」与「无依赖的普通节点」
    const stack = deleteThroughStack(doc, 'p1', ['c1', 'gone']);
    const after = getPage(stack.document, 'p1');
    expect(codesOf(stack.document)).toEqual([]);
    expect(after.nodes.i1?.type).toBe('frame');
    expect(after.nodes.i2?.type).toBe('instance');
    if (after.nodes.i2?.type === 'instance') expect(after.nodes.i2.componentId).toBe('c2');
    expect(after.nodes.gone).toBeUndefined();

    expect(stack.undo()).toBe(true);
    expect(structuredClone(stack.document)).toEqual(structuredClone(doc));
  });
});

describe('删除 · 组件集消失时收口变体引用（复核 H1）', () => {
  it('删除组件集（变体是其子级、实例指向变体）：文档仍然自洽，一次撤销整份还原', () => {
    let doc = createDocument({ id: 'd1', pages: [createPage({ id: 'p1' })] });
    doc = insertNode(doc, 'p1', createComponentSet({ id: 'set1', x: 0, y: 0 }), null);
    doc = insertNode(
      doc,
      'p1',
      createComponent({ id: 'v1', x: 0, y: 0, width: 80, height: 40, componentSetId: 'set1' }),
      'set1',
    );
    doc = insertNode(
      doc,
      'p1',
      createComponent({ id: 'v2', x: 100, y: 0, width: 80, height: 40, componentSetId: 'set1' }),
      'set1',
    );
    doc = insertNode(doc, 'p1', createInstance({ id: 'i1', componentId: 'v1', x: 300 }), null);
    expect(codesOf(doc)).toEqual([]);

    const stack = deleteThroughStack(doc, 'p1', ['set1']);
    // 变体随组件集一起消失 → 指向变体的实例不得留成悬空引用
    expect(codesOf(stack.document)).toEqual([]);
    expect(getPage(stack.document, 'p1').nodes.i1?.type).toBe('frame');
    expect(stack.undo()).toBe(true);
    expect(structuredClone(stack.document)).toEqual(structuredClone(doc));
  });

  it('删除组件集（变体不在集内）：变体的悬空组件集引用置 null 且其子树不丢', () => {
    let doc = createDocument({ id: 'd1', pages: [createPage({ id: 'p1' })] });
    doc = insertNode(doc, 'p1', createComponentSet({ id: 'set1', x: 0, y: 0, children: [] }), null);
    doc = insertNode(
      doc,
      'p1',
      createComponent({ id: 'v3', x: 300, y: 0, width: 80, height: 40, componentSetId: 'set1' }),
      null,
    );
    doc = insertNode(
      doc,
      'p1',
      createRect({ id: 'v3c', x: 10, y: 10, width: 20, height: 20 }),
      'v3',
    );
    expect(codesOf(doc)).toEqual([]);

    const stack = deleteThroughStack(doc, 'p1', ['set1']);
    const after = getPage(stack.document, 'p1');
    expect(codesOf(stack.document)).toEqual([]);
    expect(after.nodes.v3).toMatchObject({ type: 'component', componentSetId: null });
    // 变体的真实子节点必须原样留下（收口只改引用，不动子树）
    expect(after.nodes.v3c).toBeDefined();
    expect(after.nodes.v3).toMatchObject({ children: ['v3c'] });
    expect(after.nodes.set1).toBeUndefined();

    expect(stack.undo()).toBe(true);
    expect(structuredClone(stack.document)).toEqual(structuredClone(doc));
  });

  it('删除单个变体主组件：同集其余变体与其实例不受影响，文档自洽', () => {
    let doc = createDocument({ id: 'd1', pages: [createPage({ id: 'p1' })] });
    doc = insertNode(doc, 'p1', createComponentSet({ id: 'set1', x: 0, y: 0 }), null);
    doc = insertNode(
      doc,
      'p1',
      createComponent({ id: 'v1', x: 0, y: 100, componentSetId: 'set1' }),
      'set1',
    );
    doc = insertNode(
      doc,
      'p1',
      createComponent({ id: 'v2', x: 100, y: 100, componentSetId: 'set1' }),
      'set1',
    );
    doc = insertNode(doc, 'p1', createInstance({ id: 'i1', componentId: 'v1', x: 300 }), null);
    doc = insertNode(doc, 'p1', createInstance({ id: 'i2', componentId: 'v2', x: 400 }), null);
    expect(codesOf(doc)).toEqual([]);

    const stack = deleteThroughStack(doc, 'p1', ['v1']);
    const after = getPage(stack.document, 'p1');
    expect(codesOf(stack.document)).toEqual([]);
    expect(after.nodes.i1?.type).toBe('frame');
    expect(after.nodes.i2?.type).toBe('instance');
    expect(after.nodes.v2).toMatchObject({ componentSetId: 'set1' });
    expect(stack.undo()).toBe(true);
    expect(structuredClone(stack.document)).toEqual(structuredClone(doc));
  });
});
