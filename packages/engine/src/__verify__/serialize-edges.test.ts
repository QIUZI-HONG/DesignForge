/**
 * [独立验证 · engine] 序列化往返与畸形输入。
 *
 * 覆盖：往返幂等（含未知字段 / NaN / 超长字符串 / Unicode 代理对）、稳定键序、
 * 版本字段缺失与未来版本、深嵌套（显式深度上限 512：超限抛领域错误含节点路径）、
 * 原型污染（自有 `__proto__` 键同口径丢弃）。
 */

import { describe, expect, it } from 'vitest';

import { CommandStack, isCommandError } from '../commands/index';
import {
  createDocument,
  createFrame,
  createPage,
  createRect,
  type DesignDocument,
} from '../model/index';
import { type DomainError, isDomainError } from '../scene/errors';
import { getPage, insertNode, validateDocument } from '../scene/index';
import {
  cloneDocument,
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

describe('[verify] 序列化 · NaN / Infinity 拒绝（修后口径）', () => {
  it('NaN / Infinity 尺寸被命令层拒绝（invalid-argument），文档与历史都不被污染', () => {
    const stack = new CommandStack(baseDoc());
    let code: string | null = null;
    try {
      stack.dispatch({
        type: 'node.update',
        pageId: 'p1',
        nodeId: 'r',
        patch: { width: Number.NaN, x: Number.POSITIVE_INFINITY },
      });
    } catch (error) {
      code = isCommandError(error) ? error.code : null;
    }
    expect(code).toBe('invalid-argument');
    // 事务原子：非法数值不落文档、不留历史
    expect(getPage(stack.document, 'p1').nodes.r?.width).toBe(20);
    expect(validateDocument(stack.document)).toEqual([]);
    expect(stack.canUndo).toBe(false);
  });

  it('绕过命令栈构造的 NaN 文档：validateDocument 报错（含路径），序列化前校验拒绝', () => {
    const page = getPage(baseDoc(), 'p1');
    const poisonedNode = {
      ...(page.nodes.r as unknown as Record<string, unknown>),
      width: Number.NaN,
      x: Number.POSITIVE_INFINITY,
    };
    const poisoned: DesignDocument = {
      ...baseDoc(),
      pages: [
        { ...page, nodes: { ...page.nodes, r: poisonedNode } as unknown as typeof page.nodes },
      ],
    };
    const issues = validateDocument(poisoned);
    expect(issues.map((issue) => issue.code)).toContain('non-finite-number');
    const paths = issues.map((issue) => issue.path ?? '');
    expect(paths).toContain('pages[0].nodes.r.width');
    expect(paths).toContain('pages[0].nodes.r.x');
    // 序列化静默变 null（类型漂移）不再发生：序列化前校验直接拒绝
    expect(() => serializeDocument(poisoned)).toThrowError();
    expect(() => serializeDocument(poisoned)).toThrowError(/width/);
    // 已经漂移成 null 的 JSON 在导入侧被拒（类型漂移不能静默通过）
    const drifted = serializeDocument(baseDoc()).replace('"width": 20', '"width": null');
    expect(drifted).not.toBe(serializeDocument(baseDoc()));
    expect(() => parseDocument(drifted)).toThrowError();
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

describe('[verify] 序列化 · 深嵌套（导入守门：显式深度上限 512）', () => {
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

  it('上限（512 层）以内：校验无 issue，序列化与导入往返正常', () => {
    const doc = deepDoc(512);
    expect(validateDocument(doc)).toEqual([]);
    const json = serializeDocument(doc);
    expect(parseDocument(json).document.pages.length).toBe(1);
  });

  it('超过上限（513 层）：validateDocument 报 max-depth-exceeded（含节点路径），不再递归到底', () => {
    const issues = validateDocument(deepDoc(513));
    // 只报深度这一条：越界后的子树不再参与其余检查（否则会刷出上千条「孤立节点」噪声）
    expect(issues.map((issue) => issue.code)).toEqual(['max-depth-exceeded']);
    const issue = issues[0];
    expect(issue?.nodeId).toBe('f512');
    expect(issue?.path).toBe('pages[0].nodes.f512');
    expect(issue?.message).toContain('超过上限 512');
    expect(issue?.message).toContain('f0'); // 链首：根节点，便于定位越界分支
  });

  it('序列化前校验：超深文档抛 DomainError（含节点路径），不再原生 TypeError/RangeError', () => {
    for (const depth of [513, 2000, 24000]) {
      let error: unknown = null;
      try {
        serializeDocument(deepDoc(depth));
      } catch (caught) {
        error = caught;
      }
      expect(isDomainError(error)).toBe(true);
      expect((error as DomainError).code).toBe('invalid-argument');
      expect((error as Error).message).toContain('超过上限 512');
      expect((error as Error).message).toContain('f512'); // 越界节点出现在路径里
      expect((error as Error).message).not.toContain('Maximum call stack');
    }
  });

  it('导入守门：超深 JSON 字符串与已解析对象两条输入都抛领域错误（含节点路径）', () => {
    // 旧缺陷原貌：parseDocument 抛原生错误（TypeError: undefined is not a function / RangeError）
    const json = JSON.stringify(deepDoc(2000));
    let fromString: unknown = null;
    try {
      parseDocument(json);
    } catch (caught) {
      fromString = caught;
    }
    expect(isDomainError(fromString)).toBe(true);
    expect((fromString as DomainError).code).toBe('invalid-argument');
    expect((fromString as Error).message).toContain('超过上限 512');
    expect((fromString as Error).message).toContain('f512');

    let fromObject: unknown = null;
    try {
      parseDocument(deepDoc(2000));
    } catch (caught) {
      fromObject = caught;
    }
    expect(isDomainError(fromObject)).toBe(true);
    expect((fromObject as Error).message).toContain('f512');
  });

  it('任意深度都不再出现原生错误（扫描 2000–24000：校验只报 issue、序列化只抛领域错误）', {
    timeout: 60000,
  }, () => {
    for (const depth of [2000, 4000, 8000, 16000, 24000]) {
      const doc = deepDoc(depth);
      const issues = validateDocument(doc); // 不抛原生错误
      expect(issues.some((issue) => issue.code === 'max-depth-exceeded')).toBe(true);
      let error: unknown = null;
      try {
        serializeDocument(doc);
      } catch (caught) {
        error = caught;
      }
      expect(isDomainError(error)).toBe(true); // 契约：领域错误
    }
  });

  it('未知字段的对象嵌套超过结构深度上限同样被拒（含路径）', () => {
    const doc = baseDoc();
    const node = getPage(doc, 'p1').nodes.r as unknown as Record<string, unknown>;
    let nested: unknown = 1;
    for (let index = 0; index < 2100; index += 1) nested = { nested };
    node.futureDeep = nested;
    // 节点链深度合法（对象嵌套不属于节点链语义）→ 校验问题列表里没有深度问题
    expect(validateDocument(doc).map((issue) => issue.code)).not.toContain('max-depth-exceeded');
    let error: unknown = null;
    try {
      serializeDocument(doc);
    } catch (caught) {
      error = caught;
    }
    expect(isDomainError(error)).toBe(true);
    expect((error as Error).message).toContain('超过上限 2048');
    expect((error as Error).message).toContain('pages[0].nodes.r.futureDeep');
    // 导入侧同样拒绝（字符串与对象两条入口）
    expect(() => parseDocument(JSON.stringify(doc))).toThrowError();
    expect(() => parseDocument(doc)).toThrowError();
  });
});

describe('[verify] 序列化 · 原型污染（同口径：自有 __proto__ 键一律丢弃）', () => {
  it('导入 JSON 里的自有 __proto__ 键：解析即丢弃，不进载荷也不改写原型', () => {
    const doc = baseDoc();
    const once = serializeDocument(doc);
    // 只在 rect 节点上注入（"id": "r" 在文档中唯一）
    const injected = once.replace('"id": "r"', '"id": "r", "__proto__": { "polluted": "yes" }');
    expect(injected).not.toBe(once);

    const parsed = parseDocument(injected).document;
    const node = parsed.pages[0]?.nodes.r as unknown as Record<string, unknown>;
    // 旧缺陷：JSON.parse 留下自有 __proto__ 键 → 再序列化被静默丢字段（半保留半丢弃）
    expect(Object.hasOwn(node, '__proto__')).toBe(false);
    expect(Object.getPrototypeOf(node)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    // 丢弃是唯一差异：再序列化与注入前逐字节一致
    expect(serializeDocument(parsed)).toBe(once);
  });

  it('sortKeysDeep / cloneDocument / parseDocument 三处同口径：丢弃且绝不改写原型', () => {
    const polluted = JSON.parse('{"__proto__": {"marker": 1}, "ok": 2}') as Record<string, unknown>;
    const sorted = sortKeysDeep(polluted) as Record<string, unknown>;
    expect(Object.hasOwn(sorted, '__proto__')).toBe(false);
    // 旧缺陷：out['__proto__'] = … 走到原型 setter → 出参对象原型被改写（marker 可继承读到）
    expect(Object.getPrototypeOf(sorted)).toBe(Object.prototype);
    expect((Object.getPrototypeOf(sorted) as Record<string, unknown>).marker).toBeUndefined();
    expect(sorted.ok).toBe(2);
    expect(({} as Record<string, unknown>).marker).toBeUndefined();

    // 克隆入口：JSON 往返会把自有 __proto__ 键原样带回来 → 克隆体里同样丢弃
    const doc = baseDoc();
    const node = getPage(doc, 'p1').nodes.r as unknown as Record<string, unknown>;
    Object.defineProperty(node, '__proto__', {
      value: { marker: 1 },
      enumerable: true,
      configurable: true,
      writable: true,
    });
    const copy = cloneDocument(doc);
    const copied = getPage(copy, 'p1').nodes.r as unknown as Record<string, unknown>;
    expect(Object.hasOwn(copied, '__proto__')).toBe(false);
    expect(Object.getPrototypeOf(copied)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).marker).toBeUndefined();
    // 序列化入口（键排序）同样丢弃：载荷里不含原型污染语义
    expect(serializeDocument(doc)).not.toContain('__proto__');
  });
});
