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
import {
  getPage,
  insertNode,
  insertNodes,
  MAX_NESTING_DEPTH,
  MAX_VALUE_DEPTH,
  validateDocument,
} from '../scene/index';
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

describe('serialize · 深度上限（A1：显式上限 + 领域错误）', () => {
  it('上限取值是契约：节点链 512 层、结构 2048 层', () => {
    expect(MAX_NESTING_DEPTH).toBe(512);
    expect(MAX_VALUE_DEPTH).toBe(2048);
  });

  it('边界：512 层可往返；513 层在校验/序列化/导入三处一致被拒（含节点路径）', () => {
    const atLimit = deepChain(MAX_NESTING_DEPTH);
    expect(validateDocument(atLimit)).toEqual([]);
    const json = serializeDocument(atLimit);
    expect(parseDocument(json).document.pages.length).toBe(1);

    const over = deepChain(MAX_NESTING_DEPTH + 1);
    const issues = validateDocument(over);
    expect(issues.map((issue) => issue.code)).toContain('max-depth-exceeded');
    // 三处入口同口径：都是领域错误、都带越界节点路径
    expect(() => serializeDocument(over)).toThrowError(/超过上限 512/);
    expect(() => serializeDocument(over)).toThrowError(/f512/);
    expect(() => parseDocument(over)).toThrowError(/超过上限 512/);
    expect(() => parseDocument(JSON.stringify(over))).toThrowError(/f512/);
    expect(() => roundTripDocument(over)).toThrowError(/超过上限 512/);
  });

  it('上限以内深链的稳定序列化结果可导入（导出与导入同口径）', () => {
    const json = serializeDocument(deepChain(400));
    expect(() => parseDocument(json)).not.toThrowError();
  });
});

/** 直接装配 depth 层节点链（O(n)，避免 insertNode 的 O(n²) 拷贝）。 */
function deepChain(depth: number): DesignDocument {
  const nodes: Record<string, unknown> = {};
  for (let index = 0; index < depth; index += 1) {
    nodes[`f${index}`] = createFrame({
      id: `f${index}`,
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      children: index + 1 < depth ? [`f${index + 1}`] : [],
    });
  }
  return {
    id: 'deep',
    name: '深链',
    tokens: createDocument({ id: 'tokens' }).tokens,
    pages: [{ ...createPage({ id: 'p1' }), nodes: nodes as never, rootIds: ['f0'] }],
  };
}

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
