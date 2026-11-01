/**
 * 画布页正文守门回归（票 17 后续 · 复核 H2 = SE-1 / SE-3）。
 *
 * 本文件钉的是**现状口径**，不是理想口径。二轮实跑结论：
 * - `canvasPageReferenceIssues` 只镜像引擎 `validatePage` 13 个致命码里的 **2 个**
 *   （`missing-component` / `missing-component-set`）；其余 11 类（missing-root、missing-child、
 *   duplicate-child、multiple-parents、orphan-node、cycle、missing-page、duplicate-page、
 *   missing-field、non-finite-number、max-depth-exceeded）**daemon 不设防**，直连 HTTP/MCP/CLI
 *   的写入者照样能把它们写进盘上，由引擎**读侧**（web `parseDocument`/`validateDocument`）承担。
 *   补齐这 11 条属扩大覆盖面，**待人工决定**（见 .scratch/test-remediation-v2/issues/23-*.md
 *   「待人工决定 1」）；此处把边界钉住，将来扩范围必须显式改这些用例，不会静默漂移。
 * - 非 `dforge.canvas.page` 信封（含缺省 / 大小写不同 / 版本号不同 / `$format` 非字符串）
 *   一律返回 null（opaque 口径）。这条绕过**没有换来引用完整性锁定**：web 读回侧在
 *   `documents-client` 就先按「正文不是设界画布格式」拒收，走不到引擎引用校验，
 *   文档不会因此永久打不开。
 *
 * 缝（两层都测：承诺是对 **HTTP 写入者** 说的，不是对某个函数说的）：
 * 1. 纯函数：2 码命中、2 码之外放行、opaque 放行、恶意形状**不抛**（SE-1）；
 * 2. 路由：命中 2 码 → 422 且盘上零变化；恶意形状 → 4xx 且不回显内部信息；
 *    其余 11 码 → 明确钉住「当前 200 落盘」。
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { TestDaemon } from '../testing/harness.ts';
import { createTestDaemon, injectJson } from '../testing/harness.ts';
import { canvasPageReferenceIssues } from './canvas-integrity.ts';

/** 守门返回的问题串以 `码：详情` 起头——取码用于断言（与引擎 `DocumentIssue.code` 同名）。 */
function codesOf(issues: string[] | null): string[] {
  if (issues === null) return [];
  return issues.map((issue) => issue.split('：')[0] as string);
}

/** 节点最小合法形状（几何/外观字段齐备，与引擎节点必填集同集）。 */
function nodeOf(
  id: string,
  type: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    type,
    name: id,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    rotation: 0,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    fills: [],
    strokes: [],
    effects: [],
    cornerRadius: 0,
    ...extra,
  };
}

/**
 * 独立主组件（无组件集）。`componentSetId` 必须**显式为 null**：引擎与守门都用
 * 「`!== null` 才检查」的口径（scene/validate.ts:469 ↔ canvas-integrity.ts），
 * 缺键的正文在两层都算悬空，测试形状要贴真实落盘形状。
 */
function componentNode(id: string, setId: unknown = null): Record<string, unknown> {
  return nodeOf(id, 'component', { componentSetId: setId, children: [] });
}

/** 画布页正文（与 web 侧 `encodePageBody` 同形）。 */
function canvasBody(
  nodes: Record<string, unknown>,
  rootIds: unknown[],
  pageExtra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    $format: 'dforge.canvas.page',
    $version: 1,
    page: {
      id: 'page-1',
      name: '页面 1',
      rootIds,
      nodes,
      grid: { size: 100, visible: false },
      ...pageExtra,
    },
    tokens: { id: 'tokens', name: 'Tokens', groups: [] },
  };
}

/** 一份「引用合法」的基线正文（主组件 + 实例 + 组件集三件齐备）。 */
function validBody(): Record<string, unknown> {
  return canvasBody(
    {
      set1: nodeOf('set1', 'component_set', { children: ['c1'] }),
      c1: componentNode('c1', 'set1'),
      i1: nodeOf('i1', 'instance', { componentId: 'c1' }),
    },
    ['set1', 'i1'],
  );
}

/**
 * 恶意可转形对象：JSON 可原样承载（`{"toString":1}`），解析后 `String(x)` 抛
 * `TypeError: Cannot convert object to primitive value`——SE-1 的实跑现场。
 */
function hostileConvertible(): Record<string, unknown> {
  return { toString: 1 };
}

/** 连 `toString` 自己都会抛的更极端形状：守门不得因此把请求打成 500。 */
function throwingToString(): Record<string, unknown> {
  return {
    toString: '这不是函数',
    valueOf: { nested: true },
  };
}

describe('画布页守门 · 当前范围＝引擎 13 个致命码里的 2 个（复核 H2 · 钉现状）', () => {
  it('引用合法的画布正文 → null（不误伤合法写入）', () => {
    expect(canvasPageReferenceIssues(validBody())).toBeNull();
  });

  it('悬空实例引用 → missing-component（票 17 既有强度不丢）', () => {
    const body = canvasBody(
      { c1: componentNode('c1'), i1: nodeOf('i1', 'instance', { componentId: '幽灵' }) },
      ['c1', 'i1'],
    );
    expect(codesOf(canvasPageReferenceIssues(body))).toEqual(['missing-component']);
  });

  it('悬空组件集引用 → missing-component-set（票 17 既有强度不丢）', () => {
    const body = canvasBody({ c1: nodeOf('c1', 'component', { componentSetId: '幽灵集' }) }, [
      'c1',
    ]);
    expect(codesOf(canvasPageReferenceIssues(body))).toEqual(['missing-component-set']);
  });

  it('两类悬空并存 → 逐条列出（清单不被折叠成一条）', () => {
    const body = canvasBody(
      {
        v1: nodeOf('v1', 'component', { componentSetId: '幽灵集' }),
        i1: nodeOf('i1', 'instance', { componentId: '幽灵' }),
      },
      ['v1', 'i1'],
    );
    expect(codesOf(canvasPageReferenceIssues(body)).sort()).toEqual(
      ['missing-component', 'missing-component-set'].sort(),
    );
  });

  it('问题串点名节点与目标：字符串 id 原样回显（工程可定位）', () => {
    const body = canvasBody({ i1: nodeOf('i1', 'instance', { componentId: '幽灵' }) }, ['i1']);
    const issues = canvasPageReferenceIssues(body) as string[];
    expect(issues[0]).toContain('i1');
    expect(issues[0]).toContain('幽灵');
  });

  /**
   * 现状钉子（不是期望）：以下 7 类正文形状都正当、引用都不悬空，守门**放行**。
   * 引擎读侧对它们各报一个致命码，因此「能 PUT 落盘」= 直连写入者可把文档写成不可重开。
   * 补齐属扩大覆盖面 → 待人工决定 1（票 23）。改这里等于改口径，必须显式。
   */
  const outOfScope: Array<[string, Record<string, unknown>]> = [
    [
      'missing-root（顶层列表指向不存在的节点）',
      canvasBody({ a: nodeOf('a', 'rect') }, ['a', '幽灵']),
    ],
    [
      'missing-child（容器子列表指向不存在的节点）',
      canvasBody({ f: nodeOf('f', 'frame', { children: ['幽灵'] }) }, ['f']),
    ],
    [
      'duplicate-child（同一父级下重复子节点）',
      canvasBody({ f: nodeOf('f', 'frame', { children: ['a', 'a'] }), a: nodeOf('a', 'rect') }, [
        'f',
      ]),
    ],
    [
      'multiple-parents（一个节点被两个父级引用）',
      canvasBody({ f: nodeOf('f', 'frame', { children: ['a'] }), a: nodeOf('a', 'rect') }, [
        'f',
        'a',
      ]),
    ],
    [
      'orphan-node（不可达节点）',
      canvasBody({ a: nodeOf('a', 'rect'), b: nodeOf('b', 'rect') }, ['a']),
    ],
    [
      'cycle（子列表成环）',
      canvasBody(
        {
          f1: nodeOf('f1', 'frame', { children: ['f2'] }),
          f2: nodeOf('f2', 'frame', { children: ['f1'] }),
        },
        ['f1'],
      ),
    ],
    [
      'missing-field（节点缺必填字段：x 为 null）',
      canvasBody({ a: { ...nodeOf('a', 'rect'), x: null } }, ['a']),
    ],
    [
      'non-finite-number（节点数值为 Infinity）',
      canvasBody({ a: nodeOf('a', 'rect', { x: Number.POSITIVE_INFINITY }) }, ['a']),
    ],
    [
      'max-depth-exceeded（513 层帧链）',
      (() => {
        const nodes: Record<string, unknown> = {};
        const depth = 513;
        for (let level = 1; level <= depth; level += 1) {
          const id = `n${String(level)}`;
          nodes[id] = nodeOf(id, 'frame', {
            children: level < depth ? [`n${String(level + 1)}`] : [],
          });
        }
        return canvasBody(nodes, ['n1']);
      })(),
    ],
  ];

  for (const [name, body] of outOfScope) {
    it(`${name} → 守门放行（null）：本守门只覆盖 2 码，其余由引擎读侧承担 [${name}]`, () => {
      expect(canvasPageReferenceIssues(body)).toBeNull();
    });
  }
});

describe('画布页守门 · 非信封正文的 opaque 口径（钉现状）', () => {
  /** 非本信封的正文一律放行：daemon 总体仍是 opaque JSON 存储。 */
  const foreign: Array<[string, unknown]> = [
    ['无 $format', { marker: '不是画布正文' }],
    ['$format 大小写不同', { $format: 'DForge.Canvas.Page', page: { nodes: {} } }],
    ['$format 是别的版本', { $format: 'dforge.canvas.page.v2', page: { nodes: {} } }],
    ['$format 非字符串', { $format: 1, page: { nodes: {} } }],
    ['正文不是对象', '一段字符串'],
    ['正文为 null', null],
  ];

  for (const [name, body] of foreign) {
    it(`${name} → 守门放行（null），不把外来格式拖进本守门口径`, () => {
      expect(canvasPageReferenceIssues(body)).toBeNull();
    });
  }

  it('信封在但 page/nodes 形状畸形 → 不抛，只按 2 码口径放行或报问题（全函数）', () => {
    expect(() =>
      canvasPageReferenceIssues({ $format: 'dforge.canvas.page', $version: 1 }),
    ).not.toThrow();
    expect(canvasPageReferenceIssues({ $format: 'dforge.canvas.page', page: 'x' })).toBeNull();
    expect(
      canvasPageReferenceIssues({ $format: 'dforge.canvas.page', page: { nodes: 'x' } }),
    ).toBeNull();
    expect(
      canvasPageReferenceIssues({
        $format: 'dforge.canvas.page',
        page: { rootIds: 'f', nodes: { f: nodeOf('f', 'frame') } },
      }),
    ).toBeNull();
  });
});

describe('画布页守门 · 只看自有键，且「不抛」的承诺只覆盖解析域（三轮 SEC-B/SEC-C）', () => {
  /** 走一遍真实来源的形状：正文是 JSON.parse 的产物，不是手搭的对象。 */
  const parsed = (json: string): unknown => JSON.parse(json) as unknown;
  const canvasJson = (nodes: string, rootIds: string): string =>
    `{"$format":"dforge.canvas.page","$version":1,"page":{"rootIds":[${rootIds}],"nodes":{${nodes}}}}`;

  it('解析域内的极端键（__proto__/constructor/toString）当引用目标 → 不抛，按缺失拒绝', () => {
    // 实例把主组件指向 '__proto__' / 'constructor'：Object.prototype 上的东西不是本页节点，
    // 引擎读侧按 hasOwn 判缺失 → 守门必须同判（放行=能写不可读，正是本文件要堵的那类锁定路径）
    const body = parsed(
      canvasJson(
        '"i1":{"id":"i1","type":"instance","componentId":"__proto__"},' +
          '"i2":{"id":"i2","type":"instance","componentId":"constructor"},' +
          '"i3":{"id":"i3","type":"instance","componentId":"toString"}',
        '"i1","i2","i3"',
      ),
    );
    expect(() => canvasPageReferenceIssues(body)).not.toThrow();
    expect(codesOf(canvasPageReferenceIssues(body))).toEqual([
      'missing-component',
      'missing-component',
      'missing-component',
    ]);
  });

  it('原型链上的同名节点不算「在主件在位」：只认自有键（与引擎 hasOwn 同码同强度）', () => {
    // 手搭一个 nodes：`component` 只挂在原型上（JSON.parse 造不出这形状，但守门与引擎的
    // 判定口径必须一致——引擎 validate.ts 全程 Object.hasOwn，这里跟进同一口径）
    const host = { i1: { ...nodeOf('i1', 'instance'), componentId: 'c1' } };
    Object.setPrototypeOf(host, { c1: componentNode('c1') });
    const body = {
      $format: 'dforge.canvas.page',
      $version: 1,
      page: { rootIds: ['i1'], nodes: host },
    };
    expect(Object.hasOwn(host, 'c1'), '夹具前提：c1 只在原型上').toBe(false);
    expect(codesOf(canvasPageReferenceIssues(body))).toEqual(['missing-component']);
  });

  it('nodes 自身带 __proto__ 自有键（JSON.parse 造得出）→ 不抛，按自有键口径逐条判', () => {
    const body = parsed(
      '{"$format":"dforge.canvas.page","$version":1,' +
        '"page":{"rootIds":["i1"],"nodes":{"__proto__":{"type":"component"},"i1":{"id":"i1","type":"instance","componentId":"nope"}}}}',
    );
    expect(() => canvasPageReferenceIssues(body)).not.toThrow();
    // `__proto__` 在这里是 JSON.parse 造出的**自有**数据键，守门按普通节点逐条判：
    // 它自称 component 却没有组件集 → missing-component-set；i1 指向不存在的 'nope' → missing-component。
    // 关键不是码数，而是「原型 pollution 的名字进不来判定」——这条与上一条合起来钉住 hasOwn 口径。
    expect(codesOf(canvasPageReferenceIssues(body))).toEqual([
      'missing-component-set',
      'missing-component',
    ]);
  });
});

describe('画布页守门 · 恶意节点形状不得抛进通用错误面（SE-1）', () => {
  it('实例 id 为可转形恶意对象 → 不抛，按 missing-component 带类型拒绝', () => {
    const body = canvasBody(
      {
        c1: componentNode('c1'),
        i1: { ...nodeOf('i1', 'instance'), id: hostileConvertible(), componentId: '幽灵' },
      },
      ['c1', 'i1'],
    );
    expect(() => canvasPageReferenceIssues(body)).not.toThrow();
    expect(codesOf(canvasPageReferenceIssues(body))).toEqual(['missing-component']);
  });

  it('实例 componentId 为可转形恶意对象 → 不抛、不回显值，只给类型', () => {
    const body = canvasBody(
      {
        c1: componentNode('c1'),
        i1: nodeOf('i1', 'instance', { componentId: hostileConvertible() }),
      },
      ['c1', 'i1'],
    );
    const issues = canvasPageReferenceIssues(body) as string[];
    expect(codesOf(issues)).toEqual(['missing-component']);
    // 内部信息不回显：既不打印对象内容，也不带 TypeError 的原始报错文案
    expect(issues[0]).not.toContain('Cannot convert');
    expect(issues[0]).not.toContain('[object Object]');
    expect(issues[0]).toContain('非字符串');
  });

  it('组件 componentSetId 为可转形恶意对象 → 不抛，按 missing-component-set 带类型拒绝', () => {
    const body = canvasBody(
      { c1: nodeOf('c1', 'component', { componentSetId: hostileConvertible() }) },
      ['c1'],
    );
    expect(() => canvasPageReferenceIssues(body)).not.toThrow();
    expect(codesOf(canvasPageReferenceIssues(body))).toEqual(['missing-component-set']);
  });

  it('toString 自身会抛的更极端形状 → 仍然不抛（守门绝不触值）', () => {
    const body = canvasBody({ i1: nodeOf('i1', 'instance', { componentId: throwingToString() }) }, [
      'i1',
    ]);
    expect(() => canvasPageReferenceIssues(body)).not.toThrow();
    expect(codesOf(canvasPageReferenceIssues(body))).toEqual(['missing-component']);
  });

  it('非字符串 id 的其他类型（数字 / 布尔 / 数组 / null）→ 一律带类型拒绝，不抛', () => {
    for (const bad of [7, true, ['x'], null, undefined]) {
      const body = canvasBody(
        {
          c1: componentNode('c1'),
          i1: { ...nodeOf('i1', 'instance'), id: 'i1', componentId: bad },
        },
        ['c1', 'i1'],
      );
      expect(() => canvasPageReferenceIssues(body)).not.toThrow();
      expect(codesOf(canvasPageReferenceIssues(body))).toEqual(['missing-component']);
    }
  });

  it('引用本就合法时，恶意 id 不凭空造出问题（只在不合法时才需要落名字）', () => {
    const body = canvasBody(
      {
        c1: componentNode('c1'),
        i1: {
          ...nodeOf('i1', 'instance', { componentId: 'c1' }),
          id: hostileConvertible(),
        },
      },
      ['c1', 'i1'],
    );
    expect(() => canvasPageReferenceIssues(body)).not.toThrow();
    expect(canvasPageReferenceIssues(body)).toBeNull();
  });
});

describe('画布页守门 · 路由缝（HTTP 写入者视角）', () => {
  async function createDocument(daemon: TestDaemon, name: string): Promise<string> {
    const created = await injectJson(daemon.app, {
      method: 'POST',
      url: '/documents',
      payload: { name },
    });
    expect(created.statusCode).toBe(201);
    return (created.payload as { result: { document: { id: string } } }).result.document.id;
  }

  /** 先落一份合法正文，返回其盘上路径与内容（用于断言「拒了就没动盘」）。 */
  async function seedValidPage(
    daemon: TestDaemon,
    documentId: string,
  ): Promise<{ pagePath: string; bodyBefore: string }> {
    const url = `/documents/${encodeURIComponent(documentId)}/pages/page-1`;
    expect(
      (await injectJson(daemon.app, { method: 'PUT', url, payload: { body: validBody() } }))
        .statusCode,
    ).toBe(200);
    return {
      pagePath: join(daemon.workspaceDir, `${documentId}.dfg`, 'pages', 'page-1.json'),
      bodyBefore: await readFile(
        join(daemon.workspaceDir, `${documentId}.dfg`, 'pages', 'page-1.json'),
        'utf8',
      ),
    };
  }

  it('悬空引用 → 422 doc_invalid_structure，盘上正文分毫未动（票 17 强度）', async () => {
    const daemon = await createTestDaemon();
    try {
      const id = await createDocument(daemon, '守门悬空');
      const { pagePath, bodyBefore } = await seedValidPage(daemon, id);
      const poisoned = canvasBody(
        { c1: componentNode('c1'), i1: nodeOf('i1', 'instance', { componentId: '幽灵' }) },
        ['c1', 'i1'],
      );
      const rejected = await injectJson(daemon.app, {
        method: 'PUT',
        url: `/documents/${encodeURIComponent(id)}/pages/page-1`,
        payload: { body: poisoned },
      });
      expect(rejected.statusCode).toBe(422);
      expect((rejected.payload as { error: { code: string } }).error.code).toBe(
        'doc_invalid_structure',
      );
      expect(await readFile(pagePath, 'utf8')).toBe(bodyBefore);
    } finally {
      await daemon.cleanup();
    }
  });

  it('恶意形状（{"toString":1}）走 HTTP → 4xx 而非 500，且不回显内部错误文案，盘上未动（SE-1）', async () => {
    const daemon = await createTestDaemon();
    try {
      const id = await createDocument(daemon, '守门恶意形状');
      const { pagePath, bodyBefore } = await seedValidPage(daemon, id);
      // 原样拼 JSON：注入的 id/componentId 必须是「可转形恶意对象」，
      // 经 JSON.stringify 的普通对象会被丢字段，故这里手写 payload。
      const rawBody =
        '{"$format":"dforge.canvas.page","$version":1,' +
        '"page":{"id":"page-1","name":"页面 1","rootIds":["c1","i1"],' +
        `"nodes":{"c1":${JSON.stringify(componentNode('c1'))},` +
        '"i1":{"id":"i1","type":"instance","componentId":{"toString":1}}}},' +
        '"tokens":{"id":"tokens","name":"Tokens","groups":[]}}';
      const rejected = await daemon.app.inject({
        method: 'PUT',
        url: `/documents/${encodeURIComponent(id)}/pages/page-1`,
        headers: { 'content-type': 'application/json' },
        payload: `{"body":${rawBody}}`,
      });
      // 旧实现：守门 String(node.componentId) 抛 TypeError → 通用错误面 500，
      // details.reason 回显 "Cannot convert object to primitive value"。
      expect(rejected.statusCode).toBeLessThan(500);
      expect(rejected.statusCode).toBe(422);
      expect(rejected.payload).not.toContain('Cannot convert object to primitive value');
      expect(rejected.payload).toContain('missing-component');
      expect(await readFile(pagePath, 'utf8')).toBe(bodyBefore);
    } finally {
      await daemon.cleanup();
    }
  });

  /**
   * 现状钉子：形状正当但命中其余 11 类引擎码的正文，daemon 当前**照样 200 落盘**，
   * 盘上就是投毒内容——web 读回时才硬失败。补齐要动的是守门范围本身（待人工决定 1）。
   */
  it('其余致命码（环 / 孤儿 / 缺子 / 多父 / 顶层缺节点）当前 200 落盘：钉住「daemon 不设防」的现状', async () => {
    const daemon = await createTestDaemon();
    try {
      const id = await createDocument(daemon, '守门范围外');
      const url = `/documents/${encodeURIComponent(id)}/pages/page-1`;
      const pagePath = join(daemon.workspaceDir, `${id}.dfg`, 'pages', 'page-1.json');
      const cases: Array<Record<string, unknown>> = [
        canvasBody(
          {
            f1: nodeOf('f1', 'frame', { children: ['f2'] }),
            f2: nodeOf('f2', 'frame', { children: ['f1'] }),
          },
          ['f1'],
        ),
        canvasBody({ a: nodeOf('a', 'rect'), b: nodeOf('b', 'rect') }, ['a']),
        canvasBody({ f: nodeOf('f', 'frame', { children: ['幽灵'] }) }, ['f']),
        canvasBody({ f: nodeOf('f', 'frame', { children: ['a'] }), a: nodeOf('a', 'rect') }, [
          'f',
          'a',
        ]),
        canvasBody({ a: nodeOf('a', 'rect') }, ['幽灵']),
      ];
      for (const body of cases) {
        const accepted = await injectJson(daemon.app, { method: 'PUT', url, payload: { body } });
        expect(accepted.statusCode).toBe(200);
      }
      // 最后一条真落了盘：守门没拦，读者只能靠引擎读侧自保
      expect(await readFile(pagePath, 'utf8')).toContain('幽灵');
    } finally {
      await daemon.cleanup();
    }
  });

  it('非有限数（1e400 原样 JSON）当前 200 落盘：守门不查数值，钉住现状', async () => {
    const daemon = await createTestDaemon();
    try {
      const id = await createDocument(daemon, '守门非有限数');
      const rawBody = JSON.stringify(canvasBody({ a: nodeOf('a', 'rect') }, ['a'])).replace(
        '"x":0',
        '"x":1e400',
      );
      const accepted = await daemon.app.inject({
        method: 'PUT',
        url: `/documents/${encodeURIComponent(id)}/pages/page-1`,
        headers: { 'content-type': 'application/json' },
        payload: `{"body":${rawBody}}`,
      });
      expect(accepted.statusCode).toBe(200);
    } finally {
      await daemon.cleanup();
    }
  });

  it('非信封正文 → 200 且原样读回（opaque 口径）；这条绕过不产生引用完整性锁定', async () => {
    const daemon = await createTestDaemon();
    try {
      const id = await createDocument(daemon, '守门外来');
      const url = `/documents/${encodeURIComponent(id)}/pages/page-1`;
      const opaque = { marker: '不是画布正文' };
      expect(
        (await injectJson(daemon.app, { method: 'PUT', url, payload: { body: opaque } }))
          .statusCode,
      ).toBe(200);
      const read = await injectJson(daemon.app, { method: 'GET', url });
      expect((read.payload as { result: { body: unknown } }).result.body).toEqual(opaque);
    } finally {
      await daemon.cleanup();
    }
  });
});
