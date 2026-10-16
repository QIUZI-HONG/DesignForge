/**
 * [独立验证 · engine] 序列化往返与畸形输入。
 *
 * 覆盖：往返幂等（含未知字段 / NaN / 超长字符串 / Unicode 代理对）、稳定键序、
 * 版本字段缺失与未来版本、深嵌套。
 */

import { describe, expect, it } from 'vitest';

import { CommandStack } from '../commands/index';
import {
  createDocument,
  createFrame,
  createPage,
  createRect,
  type DesignDocument,
} from '../model/index';
import { isDomainError } from '../scene/errors';
import { getPage, insertNode, validateDocument } from '../scene/index';
import {
  DESIGN_IR_FORMAT,
  DESIGN_IR_VERSION,
  parseDocument,
  serializeDocument,
  sortKeysDeep,
  stableStringify,
} from '../serialize/index';

function baseDoc(): DesignDocument {
  let doc = createDocument({ id: 'd', pages: [createPage({ id: 'p1' })] });
  doc = insertNode(doc, 'p1', createFrame({ id: 'f', x: 0, y: 0, width: 200, height: 100 }), null);
  doc = insertNode(doc, 'p1', createRect({ id: 'r', x: 10, y: 10, width: 20, height: 20 }), 'f');
  return doc;
}

describe('[verify] 序列化 · 往返幂等与稳定键序', () => {
  it('serialize → parse → serialize 逐字节一致（含节点表顺序无关性）', () => {
    const once = serializeDocument(baseDoc());
    const parsed = parseDocument(once);
    expect(parsed.version).toBe(DESIGN_IR_VERSION);
    expect(parsed.enveloped).toBe(true);
    expect(serializeDocument(parsed.document)).toBe(once);
  });

  it('节点表的键插入顺序不影响字节输出（稳定键序）', () => {
    const page = getPage(baseDoc(), 'p1');
    const nodeIds = Object.keys(page.nodes).sort();
    const shuffled = [...nodeIds].reverse();
    const reordered: DesignDocument = {
      ...baseDoc(),
      pages: [
        {
          ...page,
          nodes: Object.fromEntries(
            shuffled.map((id) => [id, page.nodes[id]]),
          ) as typeof page.nodes,
        },
      ],
    };
    expect(serializeDocument(reordered)).toBe(serializeDocument(baseDoc()));
    expect(Object.keys(sortKeysDeep(page) as object).length).toBeGreaterThan(0);
  });

  it('未知字段（前向兼容）原样往返保留', () => {
    const doc = baseDoc();
    const page = getPage(doc, 'p1');
    const node = page.nodes.r as unknown as Record<string, unknown>;
    node.futureProp = { nested: ['a', 1, true] };
    node.anotherFuture = 'x';
    const once = serializeDocument(doc);
    const parsed = parseDocument(once).document;
    const parsedNode = parsed.pages[0]?.nodes.r as unknown as Record<string, unknown>;
    expect(parsedNode.futureProp).toEqual({ nested: ['a', 1, true] });
    expect(parsedNode.anotherFuture).toBe('x');
    expect(serializeDocument(parsed)).toBe(once);
  });

  it('超长字符串（10 万字符）与 Unicode 代理对往返无损', () => {
    const doc = baseDoc();
    const astral = '设界𝕏👨‍👩‍👧‍👦\u{20000}';
    const long = '长'.repeat(100_000);
    const stack = new CommandStack(doc);
    stack.dispatch({ type: 'document.rename', name: `${astral}${long}` });
    stack.dispatch({ type: 'node.update', pageId: 'p1', nodeId: 'r', patch: { name: astral } });
    const once = serializeDocument(stack.document);
    const parsed = parseDocument(once).document;
    expect(parsed.name).toBe(`${astral}${long}`);
    expect(parsed.pages[0]?.nodes.r?.name).toBe(astral);
    expect(serializeDocument(parsed)).toBe(once);
  });

  it('孤立代理项（lone surrogate）也能安全往返（JSON 转义为 \\ud800）', () => {
    const lone = 'x\uD800y';
    const json = stableStringify({ name: lone });
    expect(json).toContain('\\ud800');
    const round = JSON.parse(json) as { name: string };
    expect(round.name).toBe(lone);
  });

  it('金额/坐标级精度不丢失（-0、极小值、极大值）', () => {
    const json = stableStringify({ zero: -0, tiny: 1e-9, big: 1e21, exact: 0.1 + 0.2 });
    const parsed = JSON.parse(json) as Record<string, number>;
    expect(Object.is(parsed.zero, -0)).toBe(false); // JSON 把 -0 写成 0（往返损失符号）
    expect(parsed.zero).toBe(0);
    expect(parsed.tiny).toBe(1e-9);
    expect(parsed.big).toBe(1e21);
    expect(parsed.exact).toBe(0.30000000000000004);
  });
});

describe('[verify] 序列化 · NaN / Infinity 污染（缺陷，已复现）', () => {
  it('NaN / Infinity 尺寸可进入文档，序列化后静默变 null（类型漂移）', () => {
    const stack = new CommandStack(baseDoc());
    stack.dispatch({
      type: 'node.update',
      pageId: 'p1',
      nodeId: 'r',
      patch: { width: Number.NaN, x: Number.POSITIVE_INFINITY },
    });
    // 文档内仍是 NaN / Infinity，校验器不报错
    expect(validateDocument(stack.document)).toEqual([]);
    const once = serializeDocument(stack.document);
    const parsed = parseDocument(once).document;
    const node = parsed.pages[0]?.nodes.r as unknown as Record<string, unknown>;
    expect(node.width).toBe(null);
    expect(node.x).toBe(null);
    // 字节幂等成立（第二次序列化不再变化），但语义已漂移：宽度/坐标变成 null（类型漂移）
    expect(serializeDocument(parsed)).toBe(once);
    expect(typeof node.width).not.toBe('number');
    // 下游几何运算不再报错，而是把 null 当 0 参与布局（静默错误而非硬失败）
    const after = parseDocument(once).document;
    expect(getPage(after, 'p1').nodes.r?.width).toBe(null);
    expect(validateDocument(after)).toEqual([]); // 校验器对它无感
  });
});

describe('[verify] 序列化 · 版本字段', () => {
  it('裸文档（无信封）接受，version 回退当前版本', () => {
    const bare = JSON.parse(serializeDocument(baseDoc())) as { document: unknown };
    const parsed = parseDocument(bare.document);
    expect(parsed.enveloped).toBe(false);
    expect(parsed.version).toBe(DESIGN_IR_VERSION);
  });

  it('未知 $format 被拒绝（DomainError invalid-argument）', () => {
    let code: string | null = null;
    try {
      parseDocument({ $format: 'other.format', $version: 1, document: {} });
    } catch (error) {
      code = isDomainError(error) ? error.code : null;
    }
    expect(code).toBe('invalid-argument');
  });

  it('未来版本 $version: 999 被静默接受（无迁移/拒绝分支）', () => {
    const envelope = JSON.parse(serializeDocument(baseDoc())) as {
      $format: string;
      $version: number;
      document: unknown;
    };
    envelope.$version = 999;
    const parsed = parseDocument(envelope);
    expect(parsed.version).toBe(999);
    // 未知版本不触发任何告警/降级，直接当当前版本使用 → 潜在误读
    expect(parsed.document.pages.length).toBe(1);
  });

  it('信封缺 document / 页面为空 / 结构非法均抛 DomainError', () => {
    const bad: unknown[] = [
      { $format: DESIGN_IR_FORMAT, $version: 1 },
      {
        $format: DESIGN_IR_FORMAT,
        $version: 1,
        document: { id: 'd', name: 'x', pages: [], tokens: {} },
      },
      {
        $format: DESIGN_IR_FORMAT,
        $version: 1,
        document: {
          id: 'd',
          name: 'x',
          tokens: {},
          pages: [
            {
              id: 'p',
              name: 'p',
              nodes: {},
              rootIds: ['ghost'],
              backgroundColor: '#fff',
              grid: {},
            },
          ],
        },
      },
    ];
    for (const input of bad) {
      expect(() => parseDocument(input)).toThrowError();
      try {
        parseDocument(input);
      } catch (error) {
        expect(isDomainError(error)).toBe(true);
      }
    }
  });
});

describe('[verify] 序列化 · 深嵌套（导入守门崩溃）', () => {
  /** O(n) 直接装配深链（避免 insertNode 的 O(n²) 拷贝）。 */
  function deepDoc(depth: number): DesignDocument {
    const nodes: Record<string, unknown> = {};
    for (let index = 0; index < depth; index += 1) {
      nodes[`f${index}`] = createFrame({
        id: `f${index}`,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        children: index + 1 < depth ? [`f${index + 1}`] : [],
      });
    }
    return {
      id: 'd',
      name: 'deep',
      tokens: createDocument({ id: 't' }).tokens,
      pages: [{ ...createPage({ id: 'p1' }), nodes: nodes as never, rootIds: ['f0'] }],
    };
  }

  it('2000 层嵌套：校验与序列化正常', () => {
    const doc = deepDoc(2000);
    expect(validateDocument(doc)).toEqual([]);
    const json = serializeDocument(doc);
    expect(parseDocument(json).document.pages.length).toBe(1);
  });

  it('递归校验存在深度上限：总有一档深度会原生报错（而非返回 issues 列表）', {
    timeout: 60000,
  }, () => {
    let thrownAt: number | null = null;
    let error: unknown = null;
    for (const depth of [2000, 4000, 8000, 16000, 24000]) {
      const doc = deepDoc(depth);
      try {
        validateDocument(doc);
      } catch (caught) {
        thrownAt = depth;
        error = caught;
        break;
      }
    }
    expect(thrownAt).not.toBeNull();
    // 证据：栈溢出在 V8 中可能以 RangeError 或 TypeError 形式出现
    expect(['RangeError', 'TypeError']).toContain((error as Error).name);
    // eslint-disable-next-line no-console
    console.log(
      `[证据] validateDocument 首次原生报错深度=${String(thrownAt)} 错误=${(error as Error).name}: ${(error as Error).message}`,
    );
  });

  it('[证据] 深嵌套导入：parseDocument 抛出的错误不是契约内的 DomainError', {
    timeout: 60000,
  }, () => {
    let error: unknown = null;
    let depth = 2000;
    for (const candidate of [2000, 4000, 8000, 16000, 24000]) {
      const doc = deepDoc(candidate);
      try {
        serializeDocument(doc);
      } catch (caught) {
        error = caught;
        depth = candidate;
        break;
      }
    }
    // 若序列化本身在更浅的深度就溢出，则直接以该错误为准
    if (error === null) {
      for (const candidate of [2000, 4000, 8000, 16000, 24000]) {
        const doc = deepDoc(candidate);
        try {
          parseDocument(serializeDocument(doc));
        } catch (caught) {
          error = caught;
          depth = candidate;
          break;
        }
      }
    }
    expect(error).not.toBeNull();
    // 契约：非法输入 → DomainError('invalid-argument')；实际：栈溢出（RangeError）或其它原生错误
    expect(isDomainError(error)).toBe(false);
    expect(['RangeError', 'TypeError', 'Error']).toContain((error as Error).name);
    expect(depth).toBeGreaterThan(0);
  });
});

describe('[verify] 序列化 · 原型污染', () => {
  it('导入 JSON 中节点的自有 __proto__ 键：不污染全局，但再序列化会丢字段', () => {
    const doc = baseDoc();
    const once = serializeDocument(doc);
    // 只在 rect 节点上注入（"id": "r" 在文档中唯一）
    const injected = once.replace('"id": "r"', '"id": "r", "__proto__": { "polluted": "yes" }');
    expect(injected).not.toBe(once);
    const parsed = parseDocument(injected).document;
    const node = parsed.pages[0]?.nodes.r as unknown as Record<string, unknown>;
    // JSON.parse 把 __proto__ 解析为**自有属性**（不改原型），全局 Object.prototype 未被污染
    expect(Object.hasOwn(node, '__proto__')).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(
      (Object.getPrototypeOf(node) as Record<string, unknown> | null)?.polluted,
    ).toBeUndefined();
    // 但稳定序列化时 sortKeysDeep 用 obj['__proto__'] = 赋值 → 键静默丢失
    const reserialized = serializeDocument(parsed);
    expect(reserialized).not.toContain('__proto__');
  });

  it('sortKeysDeep 对 __proto__ 键的赋值会改写出参对象原型（局部影响，已复现）', () => {
    const polluted = JSON.parse('{"__proto__": {"marker": 1}, "ok": 2}') as Record<string, unknown>;
    const sorted = sortKeysDeep(polluted) as Record<string, unknown>;
    expect(Object.hasOwn(sorted, '__proto__')).toBe(false);
    // 出参对象的原型被 "__proto__" 的值改写（marker 可继承读到）
    expect((Object.getPrototypeOf(sorted) as Record<string, unknown> | null)?.marker).toBe(1);
    // 全局未被污染
    expect(({} as Record<string, unknown>).marker).toBeUndefined();
  });
});
