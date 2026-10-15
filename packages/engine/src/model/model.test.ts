import { describe, expect, it } from 'vitest';

import {
  createComponent,
  createDocument,
  createFrame,
  createIdFactory,
  createInstance,
  createRect,
  createText,
  defaultAutoLayout,
  defaultTextContent,
  deleteTextRange,
  isContainer,
  isDesignToken,
  isHittable,
  parseAliasReference,
  pickPatch,
  replaceTextRange,
  type SceneNode,
  solidPaint,
} from './index';

describe('model · 标识符生成', () => {
  it('确定性工厂按前缀递增，适合夹具与快照回归', () => {
    const ids = createIdFactory(3);
    expect(ids.next('n')).toBe('n_3');
    expect(ids.next('n')).toBe('n_4');
    expect(ids.next('page')).toBe('page_5');
  });
});

describe('model · 节点构造', () => {
  it('矩形带 Figma 默认灰填充与默认名', () => {
    const rect = createRect({ id: 'r1', x: 10, y: 20, width: 30, height: 40 });
    expect(rect.type).toBe('rect');
    expect(rect.name).toBe('矩形');
    expect(rect.fills[0]).toEqual(solidPaint('#D9D9D9'));
    expect([rect.x, rect.y, rect.width, rect.height]).toEqual([10, 20, 30, 40]);
    expect(rect.rotation).toBe(0);
    expect(rect.visible).toBe(true);
  });

  it('画板默认白色填充、裁剪、无自动布局', () => {
    const frame = createFrame({ id: 'f1', width: 200, height: 100 });
    expect(frame.clipsContent).toBe(true);
    expect(frame.autoLayout).toBeNull();
    expect(frame.fills[0]).toEqual(solidPaint('#FFFFFF'));
  });

  it('实例只持有 componentId 与覆盖表，不复制子树', () => {
    const instance = createInstance({ id: 'i1', componentId: 'c1' });
    expect(instance.overrides).toEqual({});
    expect(instance).not.toHaveProperty('children');
  });

  it('容器与命中判定：编组不是容器？——是容器但不可命中', () => {
    const frame = createFrame({ id: 'f1' });
    expect(isContainer(frame)).toBe(true);
    expect(isHittable(frame)).toBe(true);
    const group = { ...frame, id: 'g1', type: 'group' as const };
    expect(isHittable(group)).toBe(false);
  });

  it('文本节点携带默认排版（字体族为 Noto Sans SC，符合离线捆绑口径）', () => {
    const text = createText({ id: 't1' });
    expect(text.text).toEqual(defaultTextContent());
    expect(text.text.fontFamily).toBe('Noto Sans SC');
  });

  it('自动布局默认值：垂直、间距 10、内边距 10、高度包裹', () => {
    const layout = defaultAutoLayout();
    expect(layout.direction).toBe('vertical');
    expect(layout.spacing).toBe(10);
    expect(layout.padding).toEqual({ top: 10, right: 10, bottom: 10, left: 10 });
    expect(layout.heightSizing).toBe('hug');
  });
});

describe('model · 文档构造', () => {
  it('新建文档默认带一个页面且不许空页面序列', () => {
    const doc = createDocument({ id: 'doc1' });
    expect(doc.pages).toHaveLength(1);
    expect(doc.pages[0]?.rootIds).toEqual([]);
    expect(() => createDocument({ id: 'doc2', pages: [] })).toThrow('至少需要一个页面');
  });
});

describe('model · 文本编辑操作', () => {
  it('在选区处替换文本（半开区间语义与 DOM Selection 一致）', () => {
    const content = defaultTextContent('设计工具');
    const next = replaceTextRange(content, { start: 2, end: 4 }, '即设界');
    expect(next.characters).toBe('设计即设界');
    expect(content.characters).toBe('设计工具'); // 原内容不被修改
  });

  it('折叠选区时 Backspace 删除前一个字符', () => {
    const content = defaultTextContent('abc');
    const { content: next, selection } = deleteTextRange(content, { start: 2, end: 2 });
    expect(next.characters).toBe('ac');
    expect(selection).toEqual({ start: 1, end: 1 });
  });
});

describe('model · 补丁提取（撤销的旧值来源）', () => {
  it('只提取请求的键，缺失键不入补丁', () => {
    const rect: SceneNode = createRect({ id: 'r1', x: 5, y: 6 });
    const patch = pickPatch(rect, ['x', 'text']);
    expect(patch).toEqual({ x: 5 });
  });
});

describe('model · 令牌形状', () => {
  it('DTCG 别名语法可解析，普通值返回 null', () => {
    expect(parseAliasReference('{color.brand.primary}')).toBe('color.brand.primary');
    expect(parseAliasReference('#0D99FF')).toBeNull();
    expect(isDesignToken({ $value: '#0D99FF' })).toBe(true);
    expect(isDesignToken({ nested: true })).toBe(false);
  });

  it('组件节点可持有变体属性与组件集归属', () => {
    const variant = createComponent({
      id: 'c1',
      variantProperties: { size: 'large' },
      componentSetId: 'set1',
    });
    expect(variant.variantProperties).toEqual({ size: 'large' });
    expect(variant.componentSetId).toBe('set1');
  });
});
