/**
 * [独立验证 · engine] 命令栈对抗测试。
 *
 * 覆盖风险点：
 * 1. 撤销/重做往返恒等 —— 固定种子伪随机 100 步操作序列（fuzz）；
 * 2. 事务失败回滚 —— 混合合法/非法命令的事务；
 * 3. 「写操作唯一入口」能否被绕过 —— 深冻结快照、外部对象别名、命令对象可变性；
 * 4. 深度撤销栈的时间/内存表现。
 *
 * 每个用例都断言**外部可观测行为**，不依赖实现细节。
 */

import { describe, expect, it } from 'vitest';

import { CommandError, CommandStack, groupNodesCommands } from '../commands/index';
import type { Command } from '../commands/types';
import { createIdFactory } from '../model/ids';
import {
  createComponent,
  createDocument,
  createFrame,
  createInstance,
  createPage,
  createRect,
  createText,
  type DesignDocument,
  type SceneNode,
} from '../model/index';
import { getPage, insertNode, insertNodes, validateDocument } from '../scene/index';
import { deepFreezeDocument } from '../scene/validate';
import { parseDocument, serializeDocument } from '../serialize/index';

// ---------------------------------------------------------------------------
// 固定种子伪随机（mulberry32）——保证可复现
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 基准文档：两页、画板 + 形状 + 文本 + 主组件 + 实例。 */
function scene(): DesignDocument {
  let doc = createDocument({
    id: 'd1',
    pages: [createPage({ id: 'p1' }), createPage({ id: 'p2' })],
  });
  doc = insertNode(doc, 'p1', createFrame({ id: 'f1', x: 0, y: 0, width: 400, height: 300 }), null);
  doc = insertNodes(
    doc,
    'p1',
    [
      createRect({ id: 'r1', x: 10, y: 10, width: 60, height: 40 }),
      createRect({ id: 'r2', x: 90, y: 10, width: 60, height: 40 }),
      createRect({ id: 'r3', x: 170, y: 10, width: 60, height: 40 }),
      createText({ id: 't1', x: 10, y: 100, width: 120, height: 24 }),
    ],
    'f1',
  );
  doc = insertNode(
    doc,
    'p1',
    createComponent({ id: 'c1', x: 500, y: 0, width: 100, height: 60 }),
    null,
  );
  doc = insertNode(doc, 'p1', createRect({ id: 'c1kid', x: 5, y: 5, width: 40, height: 20 }), 'c1');
  doc = insertNode(
    doc,
    'p1',
    createInstance({ id: 'i1', componentId: 'c1', x: 500, y: 120 }),
    null,
  );
  doc = insertNode(doc, 'p2', createRect({ id: 'q1', x: 0, y: 0, width: 50, height: 50 }), null);
  return doc;
}

// ---------------------------------------------------------------------------
// 随机操作生成器（一律针对「当前文档」生成合法命令）
// ---------------------------------------------------------------------------

interface RandomOpResult {
  commands: Command[];
  label: string;
}

/** 用当前页面状态生成一条随机操作（可能返回无法施加的命令 → 由调用方宽容处理）。 */
function randomOp(doc: DesignDocument, rng: () => number, seq: number): RandomOpResult {
  const pageId = doc.pages[rng() < 0.5 ? 0 : 1]?.id ?? 'p1';
  const page = getPage(doc, pageId);
  const allIds = Object.keys(page.nodes);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rng() * list.length)] as T;
  const roll = rng();

  if (allIds.length === 0 || roll < 0.3) {
    // 插入新节点
    const id = `n_${seq}`;
    const node: SceneNode = createRect({
      id,
      x: Math.floor(rng() * 200),
      y: Math.floor(rng() * 200),
      width: 10 + Math.floor(rng() * 90),
      height: 10 + Math.floor(rng() * 90),
    });
    const containerIds = allIds.filter((id2) => {
      const node2 = page.nodes[id2];
      return node2 !== undefined && (node2.type === 'frame' || node2.type === 'group');
    });
    const parentId = rng() < 0.5 || containerIds.length === 0 ? null : pick(containerIds);
    return {
      commands: [{ type: 'node.insert', pageId, node, parentId }],
      label: `insert ${id}`,
    };
  }

  const target = pick(allIds);
  const node = page.nodes[target] as SceneNode;

  if (roll < 0.45) {
    return {
      commands: [
        {
          type: 'node.move',
          pageId,
          nodeIds: [target],
          dx: Math.floor(rng() * 21) - 10,
          dy: Math.floor(rng() * 21) - 10,
        },
      ],
      label: `move ${target}`,
    };
  }
  if (roll < 0.6) {
    const patchRoll = rng();
    const patch =
      patchRoll < 0.3
        ? { x: Math.floor(rng() * 500) - 100 }
        : patchRoll < 0.5
          ? { rotation: Math.floor(rng() * 360) }
          : patchRoll < 0.7
            ? { opacity: Number(rng().toFixed(3)) }
            : patchRoll < 0.85
              ? { visible: rng() < 0.5 }
              : { name: `名字 ${seq}` };
    return {
      commands: [{ type: 'node.update', pageId, nodeId: target, patch }],
      label: `update ${target}`,
    };
  }
  if (roll < 0.68) {
    return {
      commands: [
        {
          type: 'node.reorder',
          pageId,
          nodeId: target,
          op: pick(['front', 'back', 'forward', 'backward'] as const),
        },
      ],
      label: `reorder ${target}`,
    };
  }
  if (roll < 0.76) {
    const parentId = pick(allIds.filter((id2) => id2 !== target));
    return {
      commands: [
        { type: 'node.reparent', pageId, nodeId: target, parentId, index: Math.floor(rng() * 3) },
      ],
      label: `reparent ${target}`,
    };
  }
  if (roll < 0.84) {
    return {
      commands: [{ type: 'node.remove', pageId, nodeId: target }],
      label: `remove ${target}`,
    };
  }
  if (roll < 0.88) {
    // 编组（同父兄弟）：失败（跨父级）时由调用方吞掉
    const siblings = page.rootIds.length > 1 ? page.rootIds : allIds;
    const chosen = siblings.slice(0, 2);
    return {
      commands: groupNodesCommands(page, pageId, chosen, { ids: createIdFactory(seq * 100) }),
      label: `group ${chosen.join(',')}`,
    };
  }
  if (roll < 0.92 && node.type === 'instance') {
    return {
      commands: [
        {
          type: 'instance.setOverride',
          pageId,
          instanceId: target,
          path: ['c1kid'],
          patch: { width: 10 + Math.floor(rng() * 40) },
        },
      ],
      label: `override ${target}`,
    };
  }
  if (roll < 0.96) {
    return {
      commands: [{ type: 'document.rename', name: `文档 ${seq}` }],
      label: 'rename',
    };
  }
  return {
    commands: [{ type: 'page.update', pageId, patch: { name: `页 ${seq}` } }],
    label: 'page.update',
  };
}

// ---------------------------------------------------------------------------
// 1) 往返恒等 fuzz
// ---------------------------------------------------------------------------

/** 随机穿插操作 → 全部撤销 → 全部重做，逐字段比对。 */
function fuzzRoundTrip(seed: number, steps: number, freeze: boolean): void {
  const rng = mulberry32(seed);
  const initial: DesignDocument = freeze ? deepFreezeDocument(scene()) : scene();
  const stack = new CommandStack(initial, { freeze });
  const start = JSON.parse(JSON.stringify(stack.document)) as unknown;
  const applied: number[] = [];
  const rejected: string[] = [];

  for (let step = 0; step < steps; step += 1) {
    const op = randomOp(stack.document, rng, step);
    if (op.commands.length === 0) continue;
    try {
      stack.dispatch(op.commands, { label: op.label });
      applied.push(step);
      // 每次成功写入后结构必须自洽
      const issues = validateDocument(stack.document);
      if (issues.length > 0) {
        throw new Error(`step ${step} (${op.label}) 后文档不自洽：${JSON.stringify(issues)}`);
      }
    } catch (error) {
      expect(error).toBeInstanceOf(CommandError);
      rejected.push(`${step}:${op.label}:${(error as CommandError).code}`);
    }
  }

  expect(applied.length).toBeGreaterThan(0);
  const finalJson = JSON.parse(JSON.stringify(stack.document)) as unknown;

  // 逐条撤销 → 回到初始（逐字段相等）
  let guard = 0;
  while (stack.undo()) {
    guard += 1;
    expect(guard).toBeLessThanOrEqual(applied.length + 1);
  }
  expect(JSON.parse(JSON.stringify(stack.document))).toEqual(start);

  // 逐条重做 → 回到终态（逐字段相等）
  let guardRedo = 0;
  while (stack.redo()) {
    guardRedo += 1;
    expect(guardRedo).toBeLessThanOrEqual(applied.length + 1);
  }
  expect(JSON.parse(JSON.stringify(stack.document))).toEqual(finalJson);
  expect(validateDocument(stack.document)).toEqual([]);

  // 序列化往返（同一状态两次序列化逐字节一致）
  const once = serializeDocument(stack.document);
  expect(serializeDocument(parseDocument(once).document)).toBe(once);
}

describe('[verify] 命令栈 · 随机序列往返恒等（固定种子）', () => {
  for (const seed of [1, 7, 20261015]) {
    it(`种子 ${seed}：100 步随机操作 → 全撤销 → 全重做`, () => {
      fuzzRoundTrip(seed, 100, false);
    });
  }

  it('种子 42：冻结模式（freeze:true）下同样往返恒等', () => {
    fuzzRoundTrip(42, 60, true);
  });
});

// ---------------------------------------------------------------------------
// 2) 事务失败回滚
// ---------------------------------------------------------------------------

describe('[verify] 命令栈 · 事务失败回滚', () => {
  it('事务中间失败：文档逐字段不变、历史不增长、可重试', () => {
    const stack = new CommandStack(scene());
    stack.dispatch({ type: 'node.move', pageId: 'p1', nodeIds: ['r1'], dx: 3, dy: 3 });
    const before = JSON.parse(JSON.stringify(stack.document));
    const historyBefore = stack.history();

    expect(() =>
      stack.dispatch([
        { type: 'node.move', pageId: 'p1', nodeIds: ['r2'], dx: 50, dy: 0 },
        { type: 'node.update', pageId: 'p1', nodeId: 'r3', patch: { x: 1 } },
        { type: 'node.update', pageId: 'p1', nodeId: '不存在的节点', patch: { x: 1 } },
      ]),
    ).toThrowError(CommandError);

    expect(JSON.parse(JSON.stringify(stack.document))).toEqual(before);
    expect(stack.history()).toEqual(historyBefore);

    // 失败事务不污染后续：修正后重试应当生效并恰好产生一条历史
    stack.dispatch([
      { type: 'node.move', pageId: 'p1', nodeIds: ['r2'], dx: 50, dy: 0 },
      { type: 'node.update', pageId: 'p1', nodeId: 'r3', patch: { x: 1 } },
    ]);
    expect(stack.history().undo).toHaveLength(historyBefore.undo.length + 1);
    stack.undo();
    expect(JSON.parse(JSON.stringify(stack.document))).toEqual(before);
  });

  it('整条事务因未知命令类型失败时，错误为 transaction-failed 且文档不变', () => {
    const stack = new CommandStack(scene());
    const before = JSON.parse(JSON.stringify(stack.document));
    let code: string | null = null;
    try {
      stack.dispatch([{ type: '完全不存在的类型' } as unknown as Command]);
    } catch (error) {
      code = error instanceof CommandError ? error.code : null;
    }
    expect(code).toBe('transaction-failed');
    expect(JSON.parse(JSON.stringify(stack.document))).toEqual(before);
  });

  it('非法参数（NaN 尺寸）当前不被拒绝 —— 记录实际行为', () => {
    const stack = new CommandStack(scene());
    // NaN 会污染节点尺寸并进入历史；这是发现的「校验缺口」，此用例钉住现状供报告引用
    let threw = false;
    try {
      stack.dispatch({
        type: 'node.update',
        pageId: 'p1',
        nodeId: 'r1',
        patch: { width: Number.NaN },
      });
    } catch {
      threw = true;
    }
    const width = getPage(stack.document, 'p1').nodes.r1?.width;
    // 断言「不抛错」= 暴露缺口；若未来修复为拒绝，本用例会红（提醒更新报告）
    expect(threw).toBe(false);
    expect(Number.isNaN(width as number)).toBe(true);
    // 序列化会把 NaN 变成 null，往返后类型漂移（结构上仍是「合法」文档）
    const roundTripped = parseDocument(serializeDocument(stack.document)).document;
    expect(getPage(roundTripped, 'p1').nodes.r1?.width).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// 3) 唯一入口与深冻结
// ---------------------------------------------------------------------------

describe('[verify] 命令栈 · 写操作唯一入口', () => {
  it('freeze:true：对快照任意深度的就地写入都被拦截', () => {
    const stack = new CommandStack(scene(), { freeze: true });
    const doc = stack.document;
    const page = getPage(doc, 'p1');
    const attempts: Array<() => void> = [
      () => {
        (doc as { name: string }).name = 'x';
      },
      () => {
        (page as { name: string }).name = 'x';
      },
      () => {
        (page.nodes.r1 as { x: number }).x = 999;
      },
      () => {
        (page.nodes.r1 as unknown as { fills: object[] }).fills.push({});
      },
      () => {
        (page.rootIds as unknown[]).push('fake');
      },
      () => {
        ((page.nodes.f1 as { children: string[] }).children as string[]).push('fake');
      },
      () => {
        (doc.pages as unknown[]).push({});
      },
      () => {
        (
          (page.nodes.t1 as { text: { characters: string } }).text as { characters: string }
        ).characters = '篡改';
      },
    ];
    for (const attempt of attempts) expect(attempt).toThrow(TypeError);
    expect(validateDocument(stack.document)).toEqual([]);
  });

  it('freeze:false（默认）：调用方持有引用的节点对象可在栈外被改写 → 文档被绕过命令栈修改', () => {
    const stack = new CommandStack(scene());
    const external = createRect({ id: 'ext', x: 0, y: 0, width: 10, height: 10 });
    stack.dispatch({ type: 'node.insert', pageId: 'p1', node: external, parentId: null });
    const seen = getPage(stack.document, 'p1').nodes.ext as { width: number };
    expect(seen.width).toBe(10);
    // 栈外改写：没有经过命令栈（无历史、不触发 subscribe）
    external.width = 999;
    const after = getPage(stack.document, 'p1').nodes.ext as { width: number };
    expect(after.width).toBe(999);
    expect(stack.history().undo).toHaveLength(1); // 历史里没有这次修改
    stack.undo(); // 撤销后 external 已不在文档中（唯一入口被绕过的实证）
    expect(getPage(stack.document, 'p1').nodes.ext).toBeUndefined();
  });

  it('命令对象在 dispatch 后被调用方改写 → redo 结果漂移（历史别名缺陷，已复现）', () => {
    const stack = new CommandStack(scene());
    const command = { type: 'node.move', pageId: 'p1', nodeIds: ['r1'], dx: 10, dy: 0 } as Command;
    stack.dispatch(command);
    const afterDispatch = getPage(stack.document, 'p1').nodes.r1?.x as number;
    expect(afterDispatch).toBe(20);
    stack.undo();
    // 调用方在 dispatch 之后改写了它自己持有的命令对象
    (command as { dx: number }).dx = 10000;
    stack.redo();
    const afterRedo = getPage(stack.document, 'p1').nodes.r1?.x as number;
    // 缺陷证据：redo 施加的是被外部改写的 dx（10010 = 10 + 10000），而不是 dispatch 时的 dx
    expect(afterRedo).toBe(10010);
    expect(afterRedo).not.toBe(afterDispatch);
  });

  it('subscribe 仅在经命令栈写入时触发（栈外改写不触发）', () => {
    const stack = new CommandStack(scene());
    let calls = 0;
    const unsubscribe = stack.subscribe(() => {
      calls += 1;
    });
    stack.dispatch({ type: 'node.move', pageId: 'p1', nodeIds: ['r1'], dx: 1, dy: 0 });
    expect(calls).toBe(1);
    const node = getPage(stack.document, 'p1').nodes.r2 as { x: number };
    node.x = 12345; // 栈外直接改写
    expect(calls).toBe(1); // 监听者不会知道 → 消费侧渲染会与文档真值脱节
    stack.undo();
    expect(calls).toBe(2);
    unsubscribe();
    stack.redo();
    expect(calls).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 4) 深度撤销栈的时间/内存
// ---------------------------------------------------------------------------

describe('[verify] 命令栈 · 深度撤销栈表现', () => {
  it('20000 次写入 + 全量撤销：耗时有界且历史被 limit 截断', () => {
    const stack = new CommandStack(scene(), { historyLimit: 200 });
    const ops = 20000;
    const t0 = performance.now();
    for (let index = 0; index < ops; index += 1) {
      stack.dispatch({ type: 'node.move', pageId: 'p1', nodeIds: ['r1'], dx: 1, dy: 1 });
    }
    const tWrite = performance.now() - t0;
    expect(stack.history().undo.length).toBeLessThanOrEqual(200);

    const t1 = performance.now();
    let undone = 0;
    while (stack.undo()) undone += 1;
    const tUndo = performance.now() - t1;
    expect(undone).toBeLessThanOrEqual(200);

    // 证据（宽松上界，避免 CI 抖动）：20000 次写入应远低于 15s
    expect(tWrite).toBeLessThan(15000);
    expect(tUndo).toBeLessThan(5000);
    // 200 条已截断的历史：撤销只能回退 200 步
    const x = getPage(stack.document, 'p1').nodes.r1?.x as number;
    expect(x).toBe(10 + (ops - undone));
  });

  it('历史条目持有命令而非文档快照（内存不随写入次数线性增长）', () => {
    const stack = new CommandStack(scene(), { historyLimit: 50 });
    if (typeof global.gc === 'function') global.gc();
    const before = process.memoryUsage().heapUsed;
    for (let index = 0; index < 5000; index += 1) {
      stack.dispatch({ type: 'node.move', pageId: 'p1', nodeIds: ['r1'], dx: 0.001, dy: 0 });
    }
    if (typeof global.gc === 'function') global.gc();
    const delta = process.memoryUsage().heapUsed - before;
    // 证据性断言：增量应远小于「每步一份文档」的量级（文档 JSON ≈ 数 KB × 5000）
    expect(delta).toBeLessThan(8 * 1024 * 1024);
  });

  it('document.replace 进历史会持有整份文档（快照式历史的量级验证）', () => {
    const stack = new CommandStack(scene(), { historyLimit: 200 });
    const snapshot = parseDocument(serializeDocument(stack.document)).document;
    for (let index = 0; index < 100; index += 1) {
      stack.dispatch({ type: 'document.replace', document: snapshot });
    }
    expect(stack.history().undo).toHaveLength(100);
    expect(stack.undo()).toBe(true);
    expect(validateDocument(stack.document)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5) 微任务结算（enqueue）与混用
// ---------------------------------------------------------------------------

describe('[verify] 命令栈 · enqueue 结算', () => {
  it('enqueue 与同步 dispatch 混用：顺序与原子性保持', async () => {
    const stack = new CommandStack(scene());
    stack.enqueue({ type: 'node.move', pageId: 'p1', nodeIds: ['r1'], dx: 5, dy: 0 });
    stack.dispatch({ type: 'node.move', pageId: 'p1', nodeIds: ['r1'], dx: 5, dy: 0 });
    // 同步 dispatch 先于微任务结算 → 当前 r1 只加了一次 5
    expect(getPage(stack.document, 'p1').nodes.r1?.x).toBe(15);
    await Promise.resolve();
    expect(getPage(stack.document, 'p1').nodes.r1?.x).toBe(20);
    expect(stack.pendingCount).toBe(0);
  });

  it('enqueue 失败的事务被吞掉并写入 lastError，文档不变', async () => {
    const errors: unknown[] = [];
    const stack = new CommandStack(scene(), { onError: (error) => errors.push(error) });
    const before = JSON.parse(JSON.stringify(stack.document));
    stack.enqueue([
      { type: 'node.move', pageId: 'p1', nodeIds: ['r1'], dx: 7, dy: 0 },
      { type: 'node.update', pageId: 'p1', nodeId: '幽灵', patch: { x: 0 } },
    ]);
    await Promise.resolve();
    expect(errors).toHaveLength(1);
    expect(stack.lastError).toBeInstanceOf(CommandError);
    expect(JSON.parse(JSON.stringify(stack.document))).toEqual(before);
    expect(stack.history().undo).toHaveLength(0);
  });
});
