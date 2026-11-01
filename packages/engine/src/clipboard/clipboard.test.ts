import { describe, expect, it } from 'vitest';
import { CommandStack } from '../commands/index';
import { worldBoundsOfNode } from '../geometry/index';
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

  it('跨页面粘贴：主组件既不在载荷也无 remap/页快照可证 → 降级为普通帧（票 17：不留悬空引用）', () => {
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
    // 旧口径「保留 c1 引用（P0）」会把悬空引用钉成期望行为——粘贴落页即文档结构非法（票 17）
    expect(pasted?.type).toBe('frame');
    expect(pasted).not.toHaveProperty('componentId');
    expect(pasted).not.toHaveProperty('overrides');
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

describe('clipboard · 跨父级选区（B4）', () => {
  /**
   * 场景（证据 §B4）：画板 f1@(100,100) 内节点 n1（画板局部 20,30）+ 页面顶层 t1@(500,60)。
   * 选中 [n1, t1] 复制/再制/粘贴——副本各归各父级、世界位置保持语义、不被画板裁剪吞掉。
   */
  function crossDoc(): DesignDocument {
    let document = createDocument({ id: 'd1', pages: [createPage({ id: 'p1' })] });
    document = insertNode(
      document,
      'p1',
      createFrame({ id: 'f1', x: 100, y: 100, width: 200, height: 200 }),
      null,
    );
    document = insertNode(
      document,
      'p1',
      createRect({ id: 'n1', x: 20, y: 30, width: 40, height: 20 }),
      'f1',
    );
    document = insertNode(
      document,
      'p1',
      createRect({ id: 't1', x: 500, y: 60, width: 30, height: 30 }),
      null,
    );
    return document;
  }

  it('再制（Cmd+D）：副本各归各父级、世界位置不变、层级紧随原节点', () => {
    const document = crossDoc();
    const page = getPage(document, 'p1');
    const stack = new CommandStack(document);
    stack.dispatch(duplicateCommands(page, 'p1', ['n1', 't1'], { ids: createIdFactory(600) }));

    const after = getPage(stack.document, 'p1');
    // 层级与原节点一致：n1 副本仍在画板内，t1 副本仍在页面顶层
    const f1 = requireNode(after, 'f1');
    if (f1.type !== 'frame') throw new Error('f1 不是画板');
    const n1CopyId = f1.children.find((id) => id !== 'n1');
    expect(n1CopyId).toBeDefined();
    const t1CopyId = after.rootIds.find((id) => id !== 'f1' && id !== 't1');
    expect(t1CopyId).toBeDefined();
    // 世界位置保持：n1 副本世界 (120,130)（画板内，可见）；
    // t1 副本世界 (500,60)——缺陷现场是它被塞进画板局部 (500,60)=世界 (600,160)，
    // 落在 clipsContent:true 的裁剪区外直接不可见。
    expect(worldBoundsOfNode(after, n1CopyId as string)).toMatchObject({ x: 120, y: 130 });
    expect(worldBoundsOfNode(after, t1CopyId as string)).toMatchObject({ x: 500, y: 60 });
    // 层级紧随原节点
    expect(f1.children).toEqual(['n1', n1CopyId]);
    expect(after.rootIds).toEqual(['f1', 't1', t1CopyId]);
  });

  it('粘贴（同文档）：restoreParents 让副本各归各父级、层级紧随原节点', () => {
    const document = crossDoc();
    const page = getPage(document, 'p1');
    const payload = copyNodes(page, 'p1', ['n1', 't1']);
    const stack = new CommandStack(document);
    stack.dispatch(
      pasteCommands(payload, {
        pageId: 'p1',
        page,
        restoreParents: true,
        ids: createIdFactory(610),
      }),
    );

    const after = getPage(stack.document, 'p1');
    const f1 = requireNode(after, 'f1');
    if (f1.type !== 'frame') throw new Error('f1 不是画板');
    const n1CopyId = f1.children.find((id) => id !== 'n1');
    const t1CopyId = after.rootIds.find((id) => id !== 'f1' && id !== 't1');
    expect(n1CopyId).toBeDefined();
    expect(t1CopyId).toBeDefined();
    // 世界位置保持 + 默认粘贴偏移 (10,10)：n1 副本世界 (130,140)，t1 副本世界 (510,70)
    expect(worldBoundsOfNode(after, n1CopyId as string)).toMatchObject({ x: 130, y: 140 });
    expect(worldBoundsOfNode(after, t1CopyId as string)).toMatchObject({ x: 510, y: 70 });
    // 层级与原节点一致：副本紧随各自原节点
    expect(f1.children).toEqual(['n1', n1CopyId]);
    expect(after.rootIds).toEqual(['f1', 't1', t1CopyId]);
  });

  it('粘贴（未开 restoreParents）：保持单目标旧行为（跨文档粘贴路径不受影响）', () => {
    const document = crossDoc();
    const page = getPage(document, 'p1');
    const payload = copyNodes(page, 'p1', ['n1', 't1']);
    const stack = new CommandStack(document);
    stack.dispatch(pasteCommands(payload, { pageId: 'p1', ids: createIdFactory(620) }));

    const after = getPage(stack.document, 'p1');
    // 全部落页面顶层：n1 副本坐标原样 + 偏移（画板局部 20,30 → 顶层 30,40）
    const newIds = after.rootIds.filter((id) => id !== 'f1' && id !== 't1');
    expect(newIds).toHaveLength(2);
    const positions = newIds.map((id) => worldBoundsOfNode(after, id));
    expect(positions).toContainEqual(expect.objectContaining({ x: 30, y: 40 }));
    expect(positions).toContainEqual(expect.objectContaining({ x: 510, y: 70 }));
  });

  it('粘贴（原父级已被删）：回退根经复制时坐标系快照换算，世界位置保持', () => {
    const document = crossDoc();
    const page = getPage(document, 'p1');
    const payload = copyNodes(page, 'p1', ['n1', 't1']);
    // 复制后删除画板（连 n1 一起删）：n1 的记录原父级 f1 不在了
    const stack = new CommandStack(document);
    stack.dispatch([{ type: 'node.remove', pageId: 'p1', nodeId: 'f1' }]);
    stack.dispatch(
      pasteCommands(payload, {
        pageId: 'p1',
        page: getPage(stack.document, 'p1'),
        restoreParents: true,
        ids: createIdFactory(630),
      }),
    );

    const after = getPage(stack.document, 'p1');
    // n1 副本回退到页面顶层，但世界位置按复制时快照换算：复制时世界 (120,130) + 偏移 (10,10)
    // （无换算的旧行为会把画板局部 (20,30) 原样落顶层 → 世界 (30,40)，整体平移一个父偏移）
    const newIds = after.rootIds.filter((id) => id !== 't1');
    expect(newIds).toHaveLength(2);
    const positions = newIds.map((id) => worldBoundsOfNode(after, id));
    expect(positions).toContainEqual(
      expect.objectContaining({ x: 130, y: 140, width: 40, height: 20 }),
    );
    expect(positions).toContainEqual(
      expect.objectContaining({ x: 510, y: 70, width: 30, height: 30 }),
    );
  });

  describe('旋转父级（坐标随父级语义换算）', () => {
    /** 场景：画板 f2@(100,100) 旋转 90°，内节点 n2（画板局部 20,30，40×20）+ 页面顶层 t2@(500,60)。 */
    function rotatedDoc(): DesignDocument {
      let document = createDocument({ id: 'd1', pages: [createPage({ id: 'p1' })] });
      document = insertNode(
        document,
        'p1',
        createFrame({ id: 'f2', x: 100, y: 100, width: 200, height: 200, rotation: 90 }),
        null,
      );
      document = insertNode(
        document,
        'p1',
        createRect({ id: 'n2', x: 20, y: 30, width: 40, height: 20 }),
        'f2',
      );
      document = insertNode(
        document,
        'p1',
        createRect({ id: 't2', x: 500, y: 60, width: 30, height: 30 }),
        null,
      );
      return document;
    }

    it('再制 + 世界偏移：副本世界位移 = 偏移本身（父级旋转不吞偏移）', () => {
      const document = rotatedDoc();
      const before = getPage(document, 'p1');
      const n2World = worldBoundsOfNode(before, 'n2');
      expect(n2World).not.toBeNull();
      const stack = new CommandStack(document);
      stack.dispatch(
        duplicateCommands(before, 'p1', ['n2', 't2'], {
          offset: { x: 10, y: 0 },
          ids: createIdFactory(640),
        }),
      );

      const after = getPage(stack.document, 'p1');
      const f2 = requireNode(after, 'f2');
      if (f2.type !== 'frame') throw new Error('f2 不是画板');
      const n2CopyId = f2.children.find((id) => id !== 'n2');
      expect(n2CopyId).toBeDefined();
      // 世界偏移 (10,0) 原样体现在世界位移上（若把偏移当画板局部量，世界位移会被转成 (0,10)）
      expect(worldBoundsOfNode(after, n2CopyId as string)).toMatchObject({
        x: (n2World as { x: number }).x + 10,
        y: (n2World as { y: number }).y,
      });
      // 页面顶层副本不受父级旋转影响
      const t2CopyId = after.rootIds.find((id) => id !== 'f2' && id !== 't2');
      expect(t2CopyId).toBeDefined();
      expect(worldBoundsOfNode(after, t2CopyId as string)).toMatchObject({ x: 510, y: 60 });
      // 层级与原节点一致
      expect(f2.children).toEqual(['n2', n2CopyId]);
      expect(after.rootIds).toEqual(['f2', 't2', t2CopyId]);
    });

    it('粘贴（原父级已被删）：世界位置与旋转一并保持（保世界坐标重挂同款数学）', () => {
      const document = rotatedDoc();
      const before = getPage(document, 'p1');
      const n2World = worldBoundsOfNode(before, 'n2');
      expect(n2World).not.toBeNull();
      const payload = copyNodes(before, 'p1', ['n2', 't2']);
      const stack = new CommandStack(document);
      stack.dispatch([{ type: 'node.remove', pageId: 'p1', nodeId: 'f2' }]);
      stack.dispatch(
        pasteCommands(payload, {
          pageId: 'p1',
          page: getPage(stack.document, 'p1'),
          restoreParents: true,
          ids: createIdFactory(650),
        }),
      );

      const after = getPage(stack.document, 'p1');
      const newIds = after.rootIds.filter((id) => id !== 't2');
      expect(newIds).toHaveLength(2);
      const n2CopyId = newIds.find((id) => {
        const node = after.nodes[id];
        return node !== undefined && node.width === 40 && node.height === 20;
      });
      expect(n2CopyId).toBeDefined();
      // 世界 AABB = 复制时世界 AABB + 默认偏移 (10,10)；父级旋转 90° 折进节点自身 rotation
      expect(worldBoundsOfNode(after, n2CopyId as string)).toMatchObject({
        x: (n2World as { x: number }).x + 10,
        y: (n2World as { y: number }).y + 10,
      });
      expect(after.nodes[n2CopyId as string]?.rotation).toBe(90);
    });
  });

  it('载荷自检：rootOrigins 形状/非有限数整包拒收（参与坐标换算的字段同口径）', () => {
    const page = getPage(doc(), 'p1');
    const payload = copyNodes(page, 'p1', ['cr1']);
    const badFrame = JSON.parse(serializeClipboard(payload));
    (badFrame.rootOrigins[0].frame as Record<string, unknown>).a = Number.NaN; // stringify 后为 null
    expect(() => parseClipboard(JSON.stringify(badFrame))).toThrow('不是有限数');
    const badShape = JSON.parse(serializeClipboard(payload));
    badShape.rootOrigins = 'nope';
    expect(() => parseClipboard(JSON.stringify(badShape))).toThrow('rootOrigins 不是数组');
  });

  it('旧载荷（无 rootOrigins）+ restoreParents：不崩、走单目标路径', () => {
    const document = doc();
    const page = getPage(document, 'p1');
    const payload = JSON.parse(serializeClipboard(copyNodes(page, 'p1', ['cr1'])));
    delete payload.rootOrigins;
    const stack = new CommandStack(document);
    stack.dispatch(
      pasteCommands(parseClipboard(JSON.stringify(payload)), {
        pageId: 'p1',
        page,
        restoreParents: true,
        ids: createIdFactory(660),
      }),
    );
    // 无原级记录 → 单目标旧行为：cr1 副本落页面顶层，坐标原样 + 偏移 (10,10)
    const after = getPage(stack.document, 'p1');
    const copyId = after.rootIds.find((id) => !['c1', 'top'].includes(id));
    expect(copyId).toBeDefined();
    expect(worldBoundsOfNode(after, copyId as string)).toMatchObject({ x: 20, y: 20 });
  });
});
