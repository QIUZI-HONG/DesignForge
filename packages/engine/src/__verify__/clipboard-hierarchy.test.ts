/**
 * [独立验证 · engine] 剪贴板 / 层级 / 编组。
 *
 * 覆盖：跨页复制粘贴、循环父子（把祖先塞进子孙 / 自嵌套）、编组后撤销、
 * 以及**不受信剪贴板载荷**（系统剪贴板是外部输入）能否注入畸形节点。
 */

import { describe, expect, it } from 'vitest';

import {
  CLIPBOARD_FORMAT,
  CLIPBOARD_VERSION,
  copyNodes,
  duplicateCommands,
  parseClipboard,
  pasteCommands,
  serializeClipboard,
} from '../clipboard/index';
import {
  CommandError,
  CommandStack,
  dissolveGroupCommands,
  groupNodesCommands,
} from '../commands/index';
import { createIdFactory } from '../model/ids';
import {
  createComponent,
  createDocument,
  createFrame,
  createInstance,
  createPage,
  createRect,
  createText,
  type DesignDocument,
  type SceneNode,
} from '../model/index';
import { isDomainError } from '../scene/errors';
import { getPage, insertNode, insertNodes, reparentNode, validateDocument } from '../scene/index';

/** 两页文档：p1 有画板 f1 ⊃ [r1,r2]，另有组件 c1 ⊃ kid、实例 i1；p2 有一个矩形 q1。 */
function twoPageDoc(): DesignDocument {
  let doc = createDocument({
    id: 'd',
    pages: [createPage({ id: 'p1' }), createPage({ id: 'p2' })],
  });
  doc = insertNode(doc, 'p1', createFrame({ id: 'f1', x: 0, y: 0, width: 300, height: 200 }), null);
  doc = insertNodes(
    doc,
    'p1',
    [
      createRect({ id: 'r1', x: 10, y: 10, width: 40, height: 40 }),
      createRect({ id: 'r2', x: 70, y: 10, width: 40, height: 40 }),
      createText({ id: 't1', x: 10, y: 100, width: 80, height: 20 }),
    ],
    'f1',
  );
  doc = insertNode(
    doc,
    'p1',
    createComponent({ id: 'c1', x: 400, y: 0, width: 100, height: 60 }),
    null,
  );
  doc = insertNode(doc, 'p1', createRect({ id: 'kid', x: 5, y: 5, width: 30, height: 20 }), 'c1');
  doc = insertNode(doc, 'p2', createRect({ id: 'q1', x: 0, y: 0, width: 50, height: 50 }), null);
  return doc;
}

describe('[verify] 剪贴板 · 跨页复制粘贴', () => {
  it('p1 的画板子树复制到 p2：id 全部换新、内部引用重写、结构自洽', () => {
    const doc = twoPageDoc();
    const stack = new CommandStack(doc);
    const payload = copyNodes(getPage(doc, 'p1'), 'p1', ['f1']);
    expect(payload.rootIds).toEqual(['f1']);
    // 自包含：载荷含 f1 及其三个子节点
    expect(payload.nodes.map((node) => node.id).sort()).toEqual(['f1', 'r1', 'r2', 't1']);

    const after = new CommandStack(doc);
    after.dispatch(pasteCommands(payload, { pageId: 'p2', ids: createIdFactory(100) }));
    const page2 = getPage(after.document, 'p2');
    expect(validateDocument(after.document)).toEqual([]);
    // 原页面不受影响
    expect(getPage(after.document, 'p1').nodes.f1).toBeDefined();
    // 新根：偏移 (10,10) 且挂在 p2 顶层
    const newRoots = page2.rootIds.filter((id) => id !== 'q1');
    expect(newRoots).toHaveLength(1);
    const pasted = page2.nodes[newRoots[0] as string];
    expect(pasted).toMatchObject({ x: 10, y: 10, width: 300, height: 200 });
    // 子节点数量与父引用重写正确
    expect((pasted as { children: string[] }).children).toHaveLength(3);
    void stack;
  });

  it('跨页粘贴到指定父级与下标：只影响目标页面', () => {
    const doc = twoPageDoc();
    const stack = new CommandStack(doc);
    const payload = copyNodes(getPage(doc, 'p1'), 'p1', ['r1', 'r2']);
    stack.dispatch(
      pasteCommands(payload, { pageId: 'p2', parentId: null, index: 0, ids: createIdFactory(200) }),
    );
    const page2 = getPage(stack.document, 'p2');
    // 两个副本插到顶层开头（q1 之前）
    expect(page2.rootIds[2]).toBe('q1');
    expect(validateDocument(stack.document)).toEqual([]);
    stack.undo();
    expect(validateDocument(stack.document)).toEqual([]);
    expect(getPage(stack.document, 'p2').rootIds).toEqual(['q1']);
  });

  it('复制实例：外部主组件引用跨页保留（componentRemap 可替换）', () => {
    const doc = twoPageDoc();
    const withInstance = insertNode(
      doc,
      'p1',
      createInstance({ id: 'i1', componentId: 'c1', x: 400, y: 120 }),
      null,
    );
    const stack = new CommandStack(withInstance);
    const payload = copyNodes(getPage(withInstance, 'p1'), 'p1', ['i1']);
    stack.dispatch(pasteCommands(payload, { pageId: 'p2', ids: createIdFactory(300) }));
    const page2 = getPage(stack.document, 'p2');
    const pastedInstance = Object.values(page2.nodes).find((node) => node.type === 'instance');
    expect(pastedInstance?.type).toBe('instance');
    // 载荷外的引用（主组件 c1 在 p1）保持原值 → p2 上的实例指向 p1 的组件
    expect((pastedInstance as { componentId: string }).componentId).toBe('c1');
    // 结构校验会如实报出「主组件不在本页」
    const issues = validateDocument(stack.document);
    expect(issues.map((issue) => issue.code)).toContain('missing-component');
  });

  it('副本（duplicate）：紧随原节点、偏移可为 0、id 不冲突', () => {
    const doc = twoPageDoc();
    const stack = new CommandStack(doc);
    stack.dispatch(
      duplicateCommands(getPage(doc, 'p1'), 'p1', ['r1'], { ids: createIdFactory(400) }),
    );
    const page = getPage(stack.document, 'p1');
    const kids = (page.nodes.f1 as { children: string[] }).children;
    expect(kids[0]).toBe('r1');
    expect(kids[1]).not.toBe('r1');
    expect(kids[1]).not.toBe(kids[2]);
    expect(validateDocument(stack.document)).toEqual([]);
  });
});

describe('[verify] 层级 · 循环父子', () => {
  it('把祖先塞进子孙：命令层抛 cycle，文档不变', () => {
    const doc = twoPageDoc();
    const stack = new CommandStack(doc);
    const before = JSON.parse(JSON.stringify(stack.document));
    let code: string | null = null;
    try {
      stack.dispatch({ type: 'node.reparent', pageId: 'p1', nodeId: 'f1', parentId: 'r1' });
    } catch (error) {
      code = error instanceof CommandError ? error.code : null;
    }
    // r1 是 f1 的子节点 → 把 f1 放进 r1 构成环，且 r1 不是容器
    expect(code).toBe('not-a-container');
    expect(JSON.parse(JSON.stringify(stack.document))).toEqual(before);

    // 容器型子孙：f2 ⊃ r3，把 f2 塞进 r3 的父容器 f2 自身的子孙
    let deeper = doc;
    deeper = insertNode(
      deeper,
      'p1',
      createFrame({ id: 'f2', x: 0, y: 0, width: 50, height: 50 }),
      null,
    );
    deeper = insertNode(
      deeper,
      'p1',
      createFrame({ id: 'f3', x: 0, y: 0, width: 20, height: 20 }),
      'f2',
    );
    const stack2 = new CommandStack(deeper);
    let code2: string | null = null;
    try {
      stack2.dispatch({ type: 'node.reparent', pageId: 'p1', nodeId: 'f2', parentId: 'f3' });
    } catch (error) {
      code2 = error instanceof CommandError ? error.code : null;
    }
    expect(code2).toBe('cycle');
    expect(validateDocument(stack2.document)).toEqual([]);
  });

  it('自嵌套：nodeId === parentId 抛 cycle；场景函数层同样拒绝', () => {
    const doc = twoPageDoc();
    const stack = new CommandStack(doc);
    let code: string | null = null;
    try {
      stack.dispatch({ type: 'node.reparent', pageId: 'p1', nodeId: 'r1', parentId: 'r1' });
    } catch (error) {
      code = error instanceof CommandError ? error.code : null;
    }
    expect(code).toBe('cycle');
    expect(() => reparentNode(doc, 'p1', 'r1', 'r1')).toThrowError(/自身|进/);
  });

  it('非容器作为父级被拒绝（not-a-container），实例同理', () => {
    const doc = twoPageDoc();
    const stack = new CommandStack(doc);
    for (const parentId of ['r1', 't1']) {
      let code: string | null = null;
      try {
        stack.dispatch({ type: 'node.reparent', pageId: 'p1', nodeId: 'r2', parentId });
      } catch (error) {
        code = error instanceof CommandError ? error.code : null;
      }
      expect(code).toBe('not-a-container');
    }
    expect(validateDocument(stack.document)).toEqual([]);
  });

  it('重复 id 插入被拒绝（duplicate-id），不会产生多父结构', () => {
    const doc = twoPageDoc();
    const stack = new CommandStack(doc);
    let code: string | null = null;
    try {
      stack.dispatch({
        type: 'node.insert',
        pageId: 'p1',
        node: createRect({ id: 'r1', width: 10, height: 10 }),
        parentId: null,
      });
    } catch (error) {
      code = error instanceof CommandError ? error.code : null;
    }
    expect(code).toBe('duplicate-id');
    expect(validateDocument(stack.document)).toEqual([]);
  });
});

describe('[verify] 编组 · 撤销与还原', () => {
  it('编组 → 撤销：逐字段回到编组前（含世界形状）', () => {
    const doc = twoPageDoc();
    const stack = new CommandStack(doc);
    const before = JSON.parse(JSON.stringify(stack.document));
    stack.dispatch(
      groupNodesCommands(getPage(stack.document, 'p1'), 'p1', ['r1', 'r2'], {
        groupId: 'g1',
        ids: createIdFactory(500),
      }),
    );
    const grouped = getPage(stack.document, 'p1');
    expect(grouped.nodes.g1).toBeDefined();
    expect((grouped.nodes.f1 as { children: string[] }).children).toEqual(['g1', 't1']);

    expect(stack.undo()).toBe(true);
    expect(JSON.parse(JSON.stringify(stack.document))).toEqual(before);
    expect(stack.redo()).toBe(true);
    expect(getPage(stack.document, 'p1').nodes.g1).toBeDefined();
    expect(validateDocument(stack.document)).toEqual([]);
  });

  it('编组 + 解组往返：坐标与层级完全还原（undo/redo 双向往返）', () => {
    const doc = twoPageDoc();
    const stack = new CommandStack(doc);
    const initial = JSON.parse(JSON.stringify(stack.document));
    stack.dispatch(
      groupNodesCommands(getPage(stack.document, 'p1'), 'p1', ['r1', 'r2'], {
        groupId: 'g1',
        ids: createIdFactory(600),
      }),
    );
    const afterGroup = JSON.parse(JSON.stringify(stack.document));
    stack.dispatch(dissolveGroupCommands(getPage(stack.document, 'p1'), 'p1', 'g1'));
    // 解组后 f1 的子列表恢复为 r1,r2,t1（顺序按组内顺序 + 原下标）
    const children = (getPage(stack.document, 'p1').nodes.f1 as { children: string[] }).children;
    expect(children).toEqual(['r1', 'r2', 't1']);
    expect(getPage(stack.document, 'p1').nodes.r1).toMatchObject({ x: 10, y: 10 });
    stack.undo();
    expect(JSON.parse(JSON.stringify(stack.document))).toEqual(afterGroup);
    stack.undo();
    expect(JSON.parse(JSON.stringify(stack.document))).toEqual(initial);
    expect(validateDocument(stack.document)).toEqual([]);
  });

  it('跨父级编组被拒绝（invalid-argument）且文档不变', () => {
    const doc = twoPageDoc();
    const stack = new CommandStack(doc);
    const before = JSON.parse(JSON.stringify(stack.document));
    // r1 在 f1 内、c1 在顶层 → 不同父级；helper 在构造命令阶段就抛领域错误
    let threw: unknown = null;
    try {
      const commands = groupNodesCommands(getPage(stack.document, 'p1'), 'p1', ['r1', 'c1'], {
        groupId: 'gx',
        ids: createIdFactory(700),
      });
      stack.dispatch(commands);
    } catch (error) {
      threw = error;
    }
    expect(threw).not.toBeNull();
    expect(isDomainError(threw)).toBe(true);
    expect((threw as { code: string }).code).toBe('invalid-argument');
    expect(JSON.parse(JSON.stringify(stack.document))).toEqual(before);
  });

  it('编组后删除整组再撤销：恢复子树与顺序', () => {
    const doc = twoPageDoc();
    const stack = new CommandStack(doc);
    stack.dispatch(
      groupNodesCommands(getPage(stack.document, 'p1'), 'p1', ['r1', 'r2'], {
        groupId: 'g1',
        ids: createIdFactory(800),
      }),
    );
    const grouped = JSON.parse(JSON.stringify(stack.document));
    stack.dispatch({ type: 'node.remove', pageId: 'p1', nodeId: 'g1' });
    expect(getPage(stack.document, 'p1').nodes.g1).toBeUndefined();
    expect(getPage(stack.document, 'p1').nodes.r1).toBeUndefined();
    expect(stack.undo()).toBe(true);
    expect(JSON.parse(JSON.stringify(stack.document))).toEqual(grouped);
    expect(validateDocument(stack.document)).toEqual([]);
  });
});

describe('[verify] 剪贴板 · 不受信载荷（系统剪贴板是外部输入）', () => {
  it('载荷缺少节点字段时 parseClipboard 拒绝（invalid-argument，含字段路径），不产出畸形节点', () => {
    const crafted = JSON.stringify({
      $format: CLIPBOARD_FORMAT,
      $version: CLIPBOARD_VERSION,
      sourcePageId: 'evil',
      rootIds: ['x'],
      nodes: [{ id: 'x', type: 'rect', name: '偷袭', x: 0, y: 0 }],
    });
    let code: string | null = null;
    let message = '';
    try {
      parseClipboard(crafted);
    } catch (error) {
      code = isDomainError(error) ? error.code : null;
      message = error instanceof Error ? error.message : '';
    }
    expect(code).toBe('invalid-argument');
    // 与文档校验同口径：指出问题码 + 字段路径（缺 width/height 的节点不许进文档）
    expect(message).toContain('missing-field');
    expect(message).toContain('nodes[0].width');
    expect(message).toContain('nodes[0].height');
  });

  it('载荷节点数值非法（NaN/Infinity）、id 悬空、有不可达节点时均被拒绝', () => {
    const doc = twoPageDoc();
    const payload = copyNodes(getPage(doc, 'p1'), 'p1', ['r1']);
    const first = payload.nodes[0] as SceneNode;

    // 数值非法（JSON 无法表达 NaN，但对象入口可直达）
    expect(() =>
      parseClipboard({
        ...payload,
        nodes: [{ ...first, width: Number.NaN }],
      }),
    ).toThrowError(/width/);
    // 顶层引用悬空
    expect(() => parseClipboard({ ...payload, rootIds: ['幽灵'] })).toThrowError(/幽灵/);
    // 不在 rootIds 之下的节点：粘贴时会被静默插成顶层 → 拒绝（走私节点）
    const smuggledNode = createRect({ id: 'ghost', x: 0, y: 0, width: 10, height: 10 });
    expect(() =>
      parseClipboard({ ...payload, nodes: [...payload.nodes, smuggledNode] }),
    ).toThrowError(/ghost/);
  });

  it('信封不合法（缺 format / 非法 JSON）被 DomainError 拒绝', () => {
    expect(() => parseClipboard('not json')).toThrowError(/JSON/);
    expect(() =>
      parseClipboard({ $format: 'other', $version: 1, rootIds: [], nodes: [] }),
    ).toThrowError();
    expect(() =>
      parseClipboard({ $format: CLIPBOARD_FORMAT, $version: '1', rootIds: [], nodes: [] }),
    ).toThrowError();
  });

  it('序列化-解析往返：载荷 JSON 无损往返', () => {
    const doc = twoPageDoc();
    const payload = copyNodes(getPage(doc, 'p1'), 'p1', ['f1']);
    const round = parseClipboard(serializeClipboard(payload));
    expect(round).toEqual(payload);
  });
});
