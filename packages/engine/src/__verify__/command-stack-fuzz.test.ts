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
 * 生成器（基准文档 / 伪随机 / 随机操作）在 `fuzz-generator.ts` 共享；
 * 长跑种子另立 `command-stack-fuzz-long.test.ts`（vitest 按文件隔离，
 * 长跑的分配量不改变本文件性能用例进入时的堆相位）。
 */

import { describe, expect, it } from 'vitest';

import { CommandError, CommandStack } from '../commands/index';
import type { Command } from '../commands/types';
import { createRect } from '../model/index';
import { getPage, validateDocument } from '../scene/index';
import { deepFreezeDocument } from '../scene/validate';
import { parseDocument, serializeDocument } from '../serialize/index';
import { mulberry32, randomOp, scene } from './fuzz-generator';

// ---------------------------------------------------------------------------
// 1) 往返恒等 fuzz
// ---------------------------------------------------------------------------

/** 随机穿插操作 → 全部撤销 → 全部重做，逐字段比对。 */
function fuzzRoundTrip(seed: number, steps: number, freeze: boolean): void {
  const rng = mulberry32(seed);
  const initial = freeze ? deepFreezeDocument(scene()) : scene();
  // 历史上限须容纳整段序列（默认 200）：票 08 的 400 步长序列曾因截断而「撤销不到初始」，
  // 那是夹具参数错误而非引擎缺陷（截断本身是历史栈的文档语义，深度栈表现测试单独钉住）。
  const stack = new CommandStack(initial, { freeze, historyLimit: steps + 1 });
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

  it('非法参数（NaN 尺寸）被命令层拒绝（invalid-argument），文档与历史不变', () => {
    const stack = new CommandStack(scene());
    let code: string | null = null;
    try {
      stack.dispatch({
        type: 'node.update',
        pageId: 'p1',
        nodeId: 'r1',
        patch: { width: Number.NaN },
      });
    } catch (error) {
      code = error instanceof CommandError ? error.code : null;
    }
    expect(code).toBe('invalid-argument');
    // NaN 不落文档（修前：透传 NaN 并在序列化时静默变 null）
    expect(getPage(stack.document, 'p1').nodes.r1?.width).toBe(60);
    expect(validateDocument(stack.document)).toEqual([]);
    expect(stack.history().undo).toHaveLength(0);
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

  it('命令对象在 dispatch 后被调用方改写不污染历史（入栈即深拷），redo 不漂移', () => {
    const stack = new CommandStack(scene());
    const command = { type: 'node.move', pageId: 'p1', nodeIds: ['r1'], dx: 10, dy: 0 } as Command;
    stack.dispatch(command);
    const afterDispatch = getPage(stack.document, 'p1').nodes.r1?.x as number;
    expect(afterDispatch).toBe(20);
    stack.undo();
    // 调用方在 dispatch 之后改写自己那份命令对象
    (command as { dx: number }).dx = 10000;
    (command as { nodeIds: string[] }).nodeIds.push('r2');
    stack.redo();
    const afterRedo = getPage(stack.document, 'p1').nodes.r1?.x as number;
    // 历史持有 dispatch 时刻的载荷快照 → redo 与首次施加逐字段一致（不再 10010 漂移）
    expect(afterRedo).toBe(afterDispatch);
    expect(getPage(stack.document, 'p1').nodes.r2?.x).toBe(90);
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
