import { describe, expect, it } from 'vitest';
import { CommandStack, groupNodesCommands } from '../commands/index';
import {
  childrenOf,
  createComponent,
  createComponentSet,
  createDocument,
  createPage,
  createRect,
  type DesignDocument,
} from '../model/index';
import { getPage, insertNode, requireNode } from '../scene/index';
import { resolveInstanceTree } from '../scene/instance';
import {
  countInstancesOf,
  createComponentCommands,
  findVariant,
  instanceOverrides,
  instantiateComponentCommands,
  isDetached,
  listComponentSets,
  listComponents,
  mainComponentOf,
  overrideKeysOf,
  resetOverrideCommands,
  switchVariantCommands,
  variantIndex,
  variantKey,
} from './index';

/** 基础文档：两个矩形 sel1/sel2 + 组件集 set1 下的两个变体。 */
function doc(): DesignDocument {
  let document = createDocument({ id: 'd1', pages: [createPage({ id: 'p1' })] });
  document = insertNode(
    document,
    'p1',
    createRect({ id: 'sel1', x: 0, y: 0, width: 40, height: 20 }),
    null,
  );
  document = insertNode(
    document,
    'p1',
    createRect({ id: 'sel2', x: 60, y: 0, width: 40, height: 20 }),
    null,
  );
  document = insertNode(
    document,
    'p1',
    createComponentSet({ id: 'set1', x: 0, y: 200, width: 200, height: 100 }),
    null,
  );
  document = insertNode(
    document,
    'p1',
    createComponent({
      id: 'v1',
      x: 0,
      y: 200,
      width: 80,
      height: 40,
      variantProperties: { size: 's' },
      componentSetId: 'set1',
    }),
    'set1',
  );
  document = insertNode(
    document,
    'p1',
    createComponent({
      id: 'v2',
      x: 100,
      y: 200,
      width: 80,
      height: 60,
      variantProperties: { size: 'l' },
      componentSetId: 'set1',
    }),
    'set1',
  );
  return document;
}

describe('components · 组件清单（C4 资产面板）', () => {
  it('列出主组件与组件集，统计实例数', () => {
    let document = doc();
    document = insertNode(document, 'p1', { ...instanceOf('i1', 'v1'), x: 400 }, null);
    const page = getPage(document, 'p1');
    const components = listComponents(page);
    expect(components.map((entry) => entry.id)).toEqual(['v1', 'v2']);
    expect(components[0]?.instanceCount).toBe(1);
    expect(countInstancesOf(page, 'v2')).toBe(0);
    expect(listComponentSets(page).map((set) => set.id)).toEqual(['set1']);
  });
});

describe('components · 创建组件与实例（C17）', () => {
  it('把选中节点提升为主组件：世界形状不变、子节点归入组件', () => {
    const document = doc();
    const page = getPage(document, 'p1');
    const stack = new CommandStack(document);
    stack.dispatch(
      createComponentCommands(page, 'p1', ['sel1', 'sel2'], { componentId: 'comp1', name: '按钮' }),
    );

    const after = getPage(stack.document, 'p1');
    const component = requireNode(after, 'comp1');
    expect(component.type).toBe('component');
    expect(component.name).toBe('按钮');
    expect([component.x, component.y, component.width, component.height]).toEqual([0, 0, 100, 20]);
    expect(childrenOf(component)).toEqual(['sel1', 'sel2']);
    expect(requireNode(after, 'sel1')).toMatchObject({ x: 0, y: 0 }); // 世界形状不变（组内相对）
    stack.undo();
    expect(getPage(stack.document, 'p1').nodes.comp1).toBeUndefined();
  });

  it('实例化：不复制子树，解析出的子节点来自主组件', () => {
    let document = doc();
    document = insertNode(
      document,
      'p1',
      createRect({ id: 'vc1', x: 10, y: 10, width: 30, height: 10 }),
      'v1',
    );
    const page = getPage(document, 'p1');
    const stack = new CommandStack(document);
    stack.dispatch(
      instantiateComponentCommands(page, 'p1', 'v1', { instanceId: 'inst1', x: 500, y: 0 }),
    );
    const after = getPage(stack.document, 'p1');
    const instance = requireNode(after, 'inst1');
    expect(instance.type).toBe('instance');
    expect(Object.hasOwn(instance, 'children')).toBe(false);
    const tree = resolveInstanceTree(after, 'inst1');
    expect(tree?.children.map((child) => child.realId)).toEqual(['vc1']);
    expect(mainComponentOf(after, 'inst1')?.id).toBe('v1');
    expect(isDetached(after, 'inst1')).toBe(false);
  });

  it('主组件缺失时判为「缺失主组件」', () => {
    let document = doc();
    document = insertNode(document, 'p1', instanceOf('i1', 'v1'), null);
    document = {
      ...document,
      pages: document.pages.map((page) => ({ ...page, nodes: withoutNodes(page.nodes, ['v1']) })),
    };
    const page = getPage(document, 'p1');
    expect(isDetached(page, 'i1')).toBe(true);
    expect(mainComponentOf(page, 'i1')).toBeNull();
  });
});

describe('components · 覆盖与重置（C17）', () => {
  function withInstance(): { document: DesignDocument; stack: CommandStack } {
    let document = doc();
    document = insertNode(
      document,
      'p1',
      createRect({ id: 'vc1', x: 10, y: 10, width: 30, height: 10 }),
      'v1',
    );
    document = insertNode(document, 'p1', instanceOf('i1', 'v1'), null);
    return { document, stack: new CommandStack(document) };
  }

  it('覆盖写入 → 解析结果可见 → 重置后回到主组件值', () => {
    const { stack } = withInstance();
    stack.dispatch({
      type: 'instance.setOverride',
      pageId: 'p1',
      instanceId: 'i1',
      path: ['vc1'],
      patch: { width: 90 },
    });
    let page = getPage(stack.document, 'p1');
    expect(resolveInstanceTree(page, 'i1')?.children[0]?.node.width).toBe(90);
    expect(overrideKeysOf(page, 'i1::vc1')).toEqual(['width']);
    expect(instanceOverrides(page, 'i1')).toEqual({ vc1: { width: 90 } });

    stack.dispatch(resetOverrideCommands('p1', 'i1', [['vc1']]));
    page = getPage(stack.document, 'p1');
    expect(resolveInstanceTree(page, 'i1')?.children[0]?.node.width).toBe(30);
    expect(instanceOverrides(page, 'i1')).toEqual({});
    stack.undo();
    expect(instanceOverrides(getPage(stack.document, 'p1'), 'i1')).toEqual({ vc1: { width: 90 } });
  });
});

describe('components · 变体', () => {
  it('变体索引与按属性查找（含部分匹配退化）', () => {
    const page = getPage(doc(), 'p1');
    const index = variantIndex(page, 'set1');
    expect(index[variantKey({ size: 's' })]).toBe('v1');
    expect(findVariant(page, 'set1', { size: 'l' })).toBe('v2');
    expect(findVariant(page, 'set1', { size: 'missing' })).toBeNull();
  });

  it('切换变体：实例指向新主组件且保留覆盖', () => {
    let document = doc();
    document = insertNode(
      document,
      'p1',
      createRect({ id: 'vc1', x: 10, y: 10, width: 30, height: 10 }),
      'v1',
    );
    document = insertNode(document, 'p1', instanceOf('i1', 'v1'), null);
    document = insertNode(
      document,
      'p1',
      createRect({ id: 'vc2', x: 10, y: 10, width: 50, height: 10 }),
      'v2',
    );
    const stack = new CommandStack(document);
    stack.dispatch({
      type: 'instance.setOverride',
      pageId: 'p1',
      instanceId: 'i1',
      path: ['vc1'],
      patch: { width: 77 },
    });
    const page = getPage(stack.document, 'p1');
    stack.dispatch(switchVariantCommands(page, 'p1', 'i1', 'set1', { size: 'l' }));
    const after = getPage(stack.document, 'p1');
    const instance = requireNode(after, 'i1');
    expect(instance.type === 'instance' && instance.componentId).toBe('v2');
    expect(instance.type === 'instance' && instance.overrides).toEqual({ vc1: { width: 77 } });
    expect(resolveInstanceTree(after, 'i1')?.children[0]?.node.width).toBe(50); // 覆盖键不匹配新变体子节点
    stack.undo();
    const back = requireNode(getPage(stack.document, 'p1'), 'i1');
    expect(back.type === 'instance' && back.componentId).toBe('v1');
  });

  it('变体查找失败时抛错（不产生半成品）', () => {
    const page = getPage(doc(), 'p1');
    expect(() => switchVariantCommands(page, 'p1', 'i1', 'set1', { size: 'x' })).toThrow(
      '没有匹配的变体',
    );
  });
});

/** 便捷构造实例节点。 */
function instanceOf(id: string, componentId: string) {
  return {
    id,
    name: '实例',
    x: 300,
    y: 0,
    width: 80,
    height: 40,
    rotation: 0,
    visible: true,
    locked: false,
    opacity: 1,
    fills: [],
    strokes: [],
    effects: [],
    cornerRadius: 0,
    type: 'instance' as const,
    componentId,
    overrides: {},
  };
}

/** 从节点表剔除若干 id（构造「主组件缺失」场景）。 */
function withoutNodes(
  nodes: Record<string, unknown>,
  ids: readonly string[],
): Record<string, never> {
  const out: Record<string, never> = {};
  for (const [id, node] of Object.entries(nodes)) {
    if (!ids.includes(id)) (out as Record<string, unknown>)[id] = node;
  }
  return out;
}

void groupNodesCommands;
