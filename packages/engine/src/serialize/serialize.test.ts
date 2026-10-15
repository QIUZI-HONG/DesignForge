import { describe, expect, it } from 'vitest';
import { CommandStack } from '../commands/index';
import {
  createComponent,
  createDocument,
  createFrame,
  createInstance,
  createPage,
  createRect,
  type DesignDocument,
  solidPaint,
} from '../model/index';
import { getPage, insertNode, insertNodes } from '../scene/index';
import {
  cloneDocument,
  DESIGN_IR_FORMAT,
  DESIGN_IR_VERSION,
  documentStats,
  parseDocument,
  roundTripDocument,
  serializeDocument,
  serializePage,
  stableStringify,
} from './index';

/** 覆盖多数节点形态的夹具文档。 */
function fixture(): DesignDocument {
  let doc = createDocument({
    id: 'doc_fixture',
    name: '序列化夹具',
    pages: [createPage({ id: 'p1', name: '主页面' })],
  });
  doc = insertNode(doc, 'p1', createFrame({ id: 'f1', x: 0, y: 0, width: 300, height: 200 }), null);
  doc = insertNodes(
    doc,
    'p1',
    [
      createRect({
        id: 'r1',
        x: 10,
        y: 10,
        width: 50,
        height: 50,
        rotation: 15,
        fills: [solidPaint('#0D99FF')],
      }),
      createRect({ id: 'r2', x: 80, y: 10, width: 50, height: 50 }),
    ],
    'f1',
  );
  doc = insertNode(
    doc,
    'p1',
    createComponent({ id: 'c1', x: 400, y: 0, width: 100, height: 60 }),
    null,
  );
  doc = insertNode(doc, 'p1', createRect({ id: 'cc1', x: 5, y: 5, width: 40, height: 20 }), 'c1');
  doc = insertNode(
    doc,
    'p1',
    createInstance({
      id: 'i1',
      componentId: 'c1',
      x: 400,
      y: 120,
      overrides: { cc1: { width: 90 } },
    }),
    null,
  );
  return doc;
}

describe('serialize · 稳定键序', () => {
  it('键按字典序输出，不受构造顺序影响', () => {
    expect(stableStringify({ b: 1, a: { d: 1, c: 2 } })).toBe(
      ['{', '  "a": {', '    "c": 2,', '    "d": 1', '  },', '  "b": 1', '}'].join('\n'),
    );
    const first = serializeDocument(fixture());
    const shuffled: DesignDocument = {
      tokens: fixture().tokens,
      pages: fixture().pages,
      name: fixture().name,
      id: fixture().id,
    };
    expect(serializeDocument(shuffled)).toBe(first);
  });

  it('同一文档两次序列化逐字节一致（幂等）', () => {
    const doc = fixture();
    expect(serializeDocument(doc)).toBe(serializeDocument(doc));
  });
});

describe('serialize · 往返', () => {
  it('parse(serialize(doc)) 与原文逐字段相等', () => {
    const doc = fixture();
    const parsed = parseDocument(serializeDocument(doc));
    expect(parsed.version).toBe(DESIGN_IR_VERSION);
    expect(parsed.enveloped).toBe(true);
    expect(parsed.document).toEqual(doc);
  });

  it('二次往返仍然逐字节一致（幂等往返）', () => {
    const doc = fixture();
    const once = serializeDocument(doc);
    const twice = serializeDocument(parseDocument(once).document);
    expect(twice).toBe(once);
    expect(roundTripDocument(doc)).toEqual(doc);
  });

  it('接受裸文档（无信封）', () => {
    const doc = fixture();
    const parsed = parseDocument(JSON.stringify(doc));
    expect(parsed.enveloped).toBe(false);
    expect(parsed.document).toEqual(doc);
  });

  it('非法输入：非 JSON / 缺页面 / 结构损坏（悬空引用）', () => {
    expect(() => parseDocument('{oops')).toThrow('不是合法 JSON');
    expect(() =>
      parseDocument(JSON.stringify({ $format: DESIGN_IR_FORMAT, document: { pages: [] } })),
    ).toThrow('缺少页面');
    const broken = cloneDocument(fixture());
    const page = getPage(broken, 'p1');
    const frame = page.nodes.f1;
    if (frame?.type !== 'frame') throw new Error('夹具错误');
    const corrupted = JSON.stringify({
      $format: DESIGN_IR_FORMAT,
      $version: 1,
      document: {
        ...broken,
        pages: [{ ...page, nodes: { ...page.nodes, f1: { ...frame, children: ['ghost'] } } }],
      },
    });
    expect(() => parseDocument(corrupted)).toThrow('文档结构非法');
  });

  it('未知格式标识被拒绝', () => {
    expect(() => parseDocument(JSON.stringify({ $format: 'other.format', document: {} }))).toThrow(
      '未知的文档格式',
    );
  });

  it('单页序列化便于分享/审阅', () => {
    const json = serializePage(fixture(), 'p1');
    expect(json).toContain('"page"');
    expect(() => serializePage(fixture(), 'missing')).toThrow('页面不存在');
  });
});

describe('serialize · 辅助', () => {
  it('cloneDocument 深拷贝（改副本不影响原文档）', () => {
    const doc = fixture();
    const copy = cloneDocument(doc);
    const page = getPage(copy, 'p1');
    const node = page.nodes.r1 as { x: number };
    node.x = 999;
    expect(getPage(doc, 'p1').nodes.r1?.x).toBe(10);
  });

  it('documentStats 统计页面/节点/组件/实例', () => {
    expect(documentStats(fixture())).toEqual({ pages: 1, nodes: 6, components: 1, instances: 1 });
  });

  it('序列化后的文档仍可进入命令栈（往返不损失可编辑性）', () => {
    const roundTripped = roundTripDocument(fixture());
    const stack = new CommandStack(roundTripped);
    stack.dispatch({ type: 'node.update', pageId: 'p1', nodeId: 'r1', patch: { x: 42 } });
    expect(getPage(stack.document, 'p1').nodes.r1?.x).toBe(42);
  });
});
