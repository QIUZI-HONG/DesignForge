import { describe, expect, it } from 'vitest';

import {
  childrenOf,
  createComponent,
  createDocument,
  createFrame,
  createGroup,
  createInstance,
  createPage,
  createRect,
  createText,
  type DesignDocument,
  isContainer,
} from '../model/index';
import {
  addPage,
  DomainError,
  deepFreezeDocument,
  getAncestors,
  getChildrenIds,
  getDescendantIds,
  getPage,
  getParentId,
  getSubtreeIds,
  getTopmostAncestor,
  insertNode,
  insertNodes,
  isDescendantOf,
  layerTree,
  moveNodes,
  removeNode,
  removeNodes,
  removePage,
  reorderNode,
  reparentNode,
  replacePage,
  requireNode,
  resolveInstanceTree,
  setNodeProps,
  setOverrideAt,
  updatePage,
  validateDocument,
  virtualNodeId,
} from './index';

/** 基础文档：f1(画板) ⊃ r1, r2；顶层 g1 ⊃ r3。 */
function baseDoc(): DesignDocument {
  let doc = createDocument({ id: 'd1', pages: [createPage({ id: 'p1' })] });
  doc = insertNode(doc, 'p1', createFrame({ id: 'f1', x: 0, y: 0, width: 200, height: 200 }), null);
  doc = insertNodes(
    doc,
    'p1',
    [
      createRect({ id: 'r1', x: 10, y: 10, width: 50, height: 50 }),
      createRect({ id: 'r2', x: 70, y: 10, width: 50, height: 50 }),
    ],
    'f1',
  );
  doc = insertNode(doc, 'p1', createGroup({ id: 'g1', x: 300, y: 0, width: 50, height: 50 }), null);
  doc = insertNode(doc, 'p1', createRect({ id: 'r3', x: 10, y: 10, width: 30, height: 30 }), 'g1');
  return doc;
}

describe('scene · 不可变更新', () => {
  it('写操作返回新文档，原文档与其子结构不被修改', () => {
    const doc = baseDoc();
    const snapshot = JSON.parse(JSON.stringify(doc)) as unknown;
    const next = setNodeProps(doc, 'p1', 'r1', { x: 99 });
    expect(next).not.toBe(doc);
    expect(getPage(next, 'p1').nodes.r1?.x).toBe(99);
    expect(getPage(doc, 'p1').nodes.r1?.x).toBe(10);
    expect(JSON.parse(JSON.stringify(doc))).toEqual(snapshot);
  });

  it('深冻结文档上的写操作仍然成立（不可变路径不依赖就地修改）', () => {
    const doc = deepFreezeDocument(baseDoc());
    const next = moveNodes(doc, 'p1', [{ id: 'r1', dx: 5, dy: 5 }]);
    expect(getPage(next, 'p1').nodes.r1?.x).toBe(15);
    expect(() => {
      (getPage(doc, 'p1').nodes.r1 as { x: number }).x = 1;
    }).toThrow();
  });
});

describe('scene · 节点插入/删除/移动', () => {
  it('插入时可指定位置，删除会带上整棵子树', () => {
    let doc = baseDoc();
    doc = insertNode(doc, 'p1', createRect({ id: 'n1' }), 'f1', 0);
    expect(childrenOf(requireNode(getPage(doc, 'p1'), 'f1'))).toEqual(['n1', 'r1', 'r2']);

    doc = removeNode(doc, 'p1', 'f1');
    const page = getPage(doc, 'p1');
    expect(page.nodes.f1).toBeUndefined();
    expect(page.nodes.r1).toBeUndefined();
    expect(page.nodes.r2).toBeUndefined();
    expect(page.nodes.n1).toBeUndefined();
    expect(page.rootIds).toEqual(['g1']);
  });

  it('批量删除时父子同时给出不报错', () => {
    let doc = baseDoc();
    doc = removeNodes(doc, 'p1', ['f1', 'r1']);
    expect(getPage(doc, 'p1').nodes.f1).toBeUndefined();
    expect(getPage(doc, 'p1').nodes.r2).toBeUndefined();
  });

  it('移动按父坐标系累加', () => {
    const doc = moveNodes(baseDoc(), 'p1', [
      { id: 'r1', dx: 10, dy: -5 },
      { id: 'r2', dx: 3, dy: 4 },
    ]);
    const page = getPage(doc, 'p1');
    expect(page.nodes.r1).toMatchObject({ x: 20, y: 5 });
    expect(page.nodes.r2).toMatchObject({ x: 73, y: 14 });
  });

  it('错误：重复 id / 父级非容器 / 放进自身子树 / 删最后一页', () => {
    const doc = insertNode(
      baseDoc(),
      'p1',
      createFrame({ id: 'inner', x: 0, y: 0, width: 50, height: 50 }),
      'f1',
    );
    expect(() => insertNode(doc, 'p1', createRect({ id: 'r1' }), null)).toThrow(DomainError);
    expect(() => insertNode(doc, 'p1', createRect({ id: 'n9' }), 'r1')).toThrow('不是容器');
    expect(() => reparentNode(doc, 'p1', 'f1', 'f1')).toThrow('自身');
    expect(() => reparentNode(doc, 'p1', 'f1', 'inner')).toThrow('自己的子树');
    expect(() => removePage(doc, 'p1')).toThrow('至少需要一个页面');
  });
});

describe('scene · 层级与重排', () => {
  it('置顶/置底/上移/下移按同级列表调整顺序', () => {
    let doc = baseDoc();
    doc = insertNode(doc, 'p1', createRect({ id: 'top' }), null);
    expect(getPage(doc, 'p1').rootIds).toEqual(['f1', 'g1', 'top']);
    doc = reorderNode(doc, 'p1', 'top', 'back');
    expect(getPage(doc, 'p1').rootIds).toEqual(['top', 'f1', 'g1']);
    doc = reorderNode(doc, 'p1', 'top', 'forward');
    expect(getPage(doc, 'p1').rootIds).toEqual(['f1', 'top', 'g1']);
    doc = reorderNode(doc, 'p1', 'top', 'front');
    expect(getPage(doc, 'p1').rootIds).toEqual(['f1', 'g1', 'top']);
    doc = reorderNode(doc, 'p1', 'r1', 'backward');
    expect(childrenOf(requireNode(getPage(doc, 'p1'), 'f1'))).toEqual(['r1', 'r2']);
  });

  it('改变父级保留在列表中的相对顺序', () => {
    const doc = reparentNode(baseDoc(), 'p1', 'r2', 'g1', 0);
    const page = getPage(doc, 'p1');
    expect(childrenOf(requireNode(page, 'f1'))).toEqual(['r1']);
    expect(childrenOf(requireNode(page, 'g1'))).toEqual(['r2', 'r3']);
    expect(getPage(doc, 'p1').nodes.r2 && getParentId(page, 'r2')).toBe('g1');
  });
});

describe('scene · 查询', () => {
  it('祖先链、后代与顶层祖先', () => {
    const page = getPage(baseDoc(), 'p1');
    expect(getAncestors(page, 'r3')).toEqual(['g1']);
    expect(getAncestors(page, 'r1')).toEqual(['f1']);
    expect(getDescendantIds(page, 'f1')).toEqual(['r1', 'r2']);
    expect(getTopmostAncestor(page, 'r1')).toBe('f1');
    expect(isDescendantOf(page, 'r1', 'f1')).toBe(true);
    expect(getParentId(page, 'r1')).toBe('f1');
    expect(getParentId(page, 'f1')).toBeNull();
  });

  it('层级树与绘制顺序一致，并能报告覆盖键', () => {
    const page = getPage(baseDoc(), 'p1');
    const tree = layerTree(page);
    expect(tree.map((node) => node.id)).toEqual(['f1', 'g1']);
    expect(tree[0]?.children.map((node) => node.id)).toEqual(['r1', 'r2']);
  });

  it('页面设置可更新（背景/网格）', () => {
    const doc = updatePage(baseDoc(), 'p1', { backgroundColor: '#1E1E1E' });
    expect(getPage(doc, 'p1').backgroundColor).toBe('#1E1E1E');
    const doc2 = addPage(doc, createPage({ id: 'p2', name: '第二页' }));
    expect(doc2.pages.map((page) => page.id)).toEqual(['p1', 'p2']);
    expect(() => replacePage(doc2, createPage({ id: 'missing' }))).toThrow('页面不存在');
  });
});

describe('scene · 实例解析（主组件 → 虚节点）', () => {
  function docWithInstance(): DesignDocument {
    let doc = createDocument({ id: 'd1', pages: [createPage({ id: 'p1' })] });
    doc = insertNode(
      doc,
      'p1',
      createComponent({ id: 'c1', x: 0, y: 0, width: 100, height: 100 }),
      null,
    );
    doc = insertNodes(
      doc,
      'p1',
      [
        createRect({ id: 'cr1', x: 10, y: 10, width: 20, height: 20 }),
        createText({ id: 'ct1', x: 40, y: 40, width: 50, height: 20 }),
      ],
      'c1',
    );
    doc = insertNode(
      doc,
      'p1',
      createInstance({ id: 'i1', componentId: 'c1', x: 500, y: 0 }),
      null,
    );
    return doc;
  }

  it('实例的子节点为虚 id，坐标取自主组件局部空间', () => {
    const page = getPage(docWithInstance(), 'p1');
    const children = getChildrenIds(page, 'i1');
    expect(children).toEqual([virtualNodeId('i1', ['cr1']), virtualNodeId('i1', ['ct1'])]);
    const tree = resolveInstanceTree(page, 'i1');
    expect(tree?.children.map((child) => child.node.id)).toEqual(['cr1', 'ct1']);
    expect(tree?.children[0]?.path).toEqual(['cr1']);
  });

  it('覆盖表按键路径应用，虚节点视图带覆盖值', () => {
    let doc = docWithInstance();
    const page0 = getPage(doc, 'p1');
    const instance0 = page0.nodes.i1;
    expect(instance0?.type).toBe('instance');
    if (instance0?.type === 'instance') {
      doc = replacePage(doc, {
        ...page0,
        nodes: {
          ...page0.nodes,
          i1: {
            ...instance0,
            overrides: setOverrideAt(instance0.overrides, ['cr1'], { x: 0, width: 80 }),
          },
        },
      });
    }
    const page = getPage(doc, 'p1');
    const tree = resolveInstanceTree(page, 'i1');
    const first = tree?.children[0];
    expect(first?.node.width).toBe(80);
    expect(first?.overriddenKeys).toEqual(['x', 'width']);
    expect(tree?.children[1]?.overriddenKeys).toEqual([]);
  });

  it('主组件缺失时实例解析返回 null（图层显示「缺失主组件」）', () => {
    let doc = docWithInstance();
    doc = removeNode(doc, 'p1', 'c1');
    const page = getPage(doc, 'p1');
    expect(resolveInstanceTree(page, 'i1')).toBeNull();
    expect(getChildrenIds(page, 'i1')).toEqual([]);
  });

  it('子树遍历包含实例虚节点', () => {
    const page = getPage(docWithInstance(), 'p1');
    expect(getSubtreeIds(page, 'i1')).toEqual(['i1', 'i1::cr1', 'i1::ct1']);
  });
});

describe('scene · 结构校验', () => {
  it('合法文档无问题', () => {
    expect(validateDocument(baseDoc())).toEqual([]);
  });

  it('检出悬空子引用、多父引用', () => {
    const page = getPage(baseDoc(), 'p1');
    const f1 = requireNode(page, 'f1');
    const g1 = requireNode(page, 'g1');
    if (!isContainer(f1) || !isContainer(g1)) throw new Error('夹具错误：f1/g1 应为容器');
    // 构造损坏文档：f1 多出一个不存在的子节点 ghost；r2 同时挂在 f1 与 g1 下
    const broken = replacePage(createDocument({ id: 'd2', pages: [page] }), {
      ...page,
      nodes: {
        ...page.nodes,
        f1: { ...f1, children: ['r1', 'r2', 'ghost'] },
        g1: { ...g1, children: ['r2', 'r3'] },
      },
    });
    const codes = validateDocument(broken).map((issue) => issue.code);
    expect(codes).toContain('missing-child');
    expect(codes).toContain('multiple-parents');
  });

  it('检出孤立节点', () => {
    const page = getPage(baseDoc(), 'p1');
    const doc = { ...createDocument({ id: 'd3', pages: [page] }) };
    const orphaned = replacePage(doc, {
      ...page,
      nodes: { ...page.nodes, ghost: createRect({ id: 'ghost' }) },
    });
    expect(validateDocument(orphaned).map((issue) => issue.code)).toContain('orphan-node');
  });
});
