import { describe, expect, it } from 'vitest';
import { CommandStack } from '../commands/index';
import { createIdFactory } from '../model/ids';
import {
  createComponent,
  createDocument,
  createFrame,
  createInstance,
  createPage,
  createRect,
  type DesignDocument,
} from '../model/index';
import { addPage, getChildrenIds, getPage, insertNode, requireNode } from '../scene/index';
import {
  clipboardIds,
  copyNodes,
  duplicateCommands,
  parseClipboard,
  pasteCommands,
  serializeClipboard,
} from './index';

/** 场景：组件 c1 ⊃ [cr1, inner(内含 cr3)]；页面顶层另有 top。 */
function doc(): DesignDocument {
  let document = createDocument({ id: 'd1', pages: [createPage({ id: 'p1' })] });
  document = insertNode(
    document,
    'p1',
    createComponent({ id: 'c1', x: 0, y: 0, width: 100, height: 100 }),
    null,
  );
  document = insertNode(
    document,
    'p1',
    createRect({ id: 'cr1', x: 10, y: 10, width: 20, height: 20 }),
    'c1',
  );
  document = insertNode(
    document,
    'p1',
    createFrame({ id: 'layer', x: 40, y: 40, width: 50, height: 50 }),
    'c1',
  );
  document = insertNode(
    document,
    'p1',
    createRect({ id: 'cr3', x: 5, y: 5, width: 10, height: 10 }),
    'layer',
  );
  document = insertNode(
    document,
    'p1',
    createRect({ id: 'top', x: 500, y: 0, width: 30, height: 30 }),
    null,
  );
  return document;
}

describe('clipboard · 复制载荷', () => {
  it('复制子树为自包含载荷（层层嵌套一并收集）', () => {
    const page = getPage(doc(), 'p1');
    const payload = copyNodes(page, 'p1', ['c1']);
    expect(payload.$format).toBe('dforge.clipboard');
    expect(payload.rootIds).toEqual(['c1']);
    expect(clipboardIds(payload)).toEqual(['c1', 'cr1', 'layer', 'cr3']);
  });

  it('重复选择父子节点时不重复收集', () => {
    const page = getPage(doc(), 'p1');
    const payload = copyNodes(page, 'p1', ['c1', 'cr1']);
    expect(payload.rootIds).toEqual(['c1']);
    expect(clipboardIds(payload)).toHaveLength(4);
  });

  it('序列化 → 解析往返保持载荷；非法输入抛错', () => {
    const page = getPage(doc(), 'p1');
    const payload = copyNodes(page, 'p1', ['cr1']);
    expect(parseClipboard(serializeClipboard(payload))).toEqual(payload);
    expect(() => parseClipboard('{"$format":"other"}')).toThrow('格式不合法');
    expect(() => parseClipboard('not json')).toThrow('不是合法 JSON');
  });
});

describe('clipboard · 粘贴（id 重映射）', () => {
  it('粘贴生成全新 id 且结构保持（含父内相对坐标），一次撤销回退', () => {
    const document = doc();
    const page = getPage(document, 'p1');
    const payload = copyNodes(page, 'p1', ['c1']);
    const stack = new CommandStack(document);
    stack.dispatch(
      pasteCommands(payload, { pageId: 'p1', parentId: null, ids: createIdFactory(100) }),
    );

    const after = getPage(stack.document, 'p1');
    const newRoot = after.rootIds[after.rootIds.length - 1] as string;
    expect(newRoot).not.toBe('c1');
    expect(after.nodes[newRoot]?.type).toBe('component');
    const newChildren = getChildrenIds(after, newRoot);
    expect(newChildren).not.toContain('cr1');
    expect(requireNode(after, newChildren[0] as string)).toMatchObject({
      x: 10,
      y: 10,
      width: 20,
      height: 20,
    });
    // 嵌套结构（layer ⊃ cr3）同样被重建
    const layer = requireNode(after, newChildren[1] as string);
    expect(getChildrenIds(after, layer.id)).toHaveLength(1);
    // 粘贴默认偏移 (10,10)
    expect(after.nodes[newRoot]).toMatchObject({ x: 10, y: 10 });

    stack.undo();
    expect(getPage(stack.document, 'p1').nodes[newRoot]).toBeUndefined();
  });

  it('同一载荷粘贴两次得到互不相同的 id', () => {
    const document = doc();
    const page = getPage(document, 'p1');
    const payload = copyNodes(page, 'p1', ['cr1']);
    const stack = new CommandStack(document);
    stack.dispatch(pasteCommands(payload, { pageId: 'p1' }));
    stack.dispatch(pasteCommands(payload, { pageId: 'p1' }));
    const ids = Object.keys(getPage(stack.document, 'p1').nodes);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('跨页面粘贴：实例保留对主组件的引用（P0 口径：主组件仍在原页面）', () => {
    let document = doc();
    document = insertNode(
      document,
      'p1',
      createInstance({ id: 'i1', componentId: 'c1', x: 300, y: 0 }),
      null,
    );
    document = addPage(document, createPage({ id: 'p2', name: '第二页' }));
    const page = getPage(document, 'p1');
    const payload = copyNodes(page, 'p1', ['i1']);
    const stack = new CommandStack(document);
    stack.dispatch(pasteCommands(payload, { pageId: 'p2' }));
    const after = getPage(stack.document, 'p2');
    const pasted = Object.values(after.nodes)[0];
    expect(pasted?.type).toBe('instance');
    if (pasted?.type !== 'instance') return;
    expect(pasted.componentId).toBe('c1');
  });

  it('副本（Cmd+D）：留在同父级、紧随原节点、可撤销', () => {
    const document = doc();
    const page = getPage(document, 'p1');
    const stack = new CommandStack(document);
    stack.dispatch(duplicateCommands(page, 'p1', ['top'], { ids: createIdFactory(500) }));
    const after = getPage(stack.document, 'p1');
    expect(after.rootIds).toHaveLength(3);
    const duplicated = after.rootIds[2] as string;
    expect(duplicated).not.toBe('top');
    expect(after.nodes[duplicated]).toMatchObject({ x: 500, y: 0, width: 30, height: 30 });
    stack.undo();
    expect(getPage(stack.document, 'p1').rootIds).toEqual(['c1', 'top']);
  });

  it('实例覆盖路径随主组件 id 一并重映射', () => {
    let document = doc();
    document = insertNode(
      document,
      'p1',
      createInstance({
        id: 'i1',
        componentId: 'c1',
        x: 300,
        y: 0,
        overrides: { cr1: { width: 99 }, layer: { x: 1 } },
      }),
      null,
    );
    const page = getPage(document, 'p1');
    const payload = copyNodes(page, 'p1', ['c1', 'i1']);
    const stack = new CommandStack(document);
    stack.dispatch(pasteCommands(payload, { pageId: 'p1', ids: createIdFactory(700) }));

    const after = getPage(stack.document, 'p1');
    const instances = Object.values(after.nodes).filter((node) => node.type === 'instance');
    expect(instances).toHaveLength(2);
    const pasted = instances.find((node) => node.id !== 'i1');
    if (pasted?.type !== 'instance') throw new Error('未找到粘贴出的实例');
    // 主组件与路径都被重映射：新路径应指向新主组件的子节点
    expect(pasted.componentId).not.toBe('c1');
    const copiedComponentChildren = getChildrenIds(after, pasted.componentId);
    const overridePaths = Object.keys(pasted.overrides);
    expect(overridePaths).toHaveLength(2);
    for (const path of overridePaths) {
      const first = path.split('/')[0] as string;
      expect(copiedComponentChildren).toContain(first);
    }
  });
});
