/**
 * [独立验证 · engine] 命令栈 fuzz 长跑（票 08 加长跑测）。
 *
 * 为什么另立文件：400 步 × 2 种子的分配量远超常规种子，与性能用例同文件跑会改变
 * 其进入时的堆相位（vitest 同文件共用一个环境），「历史条目持有命令」的内存断言
 * 在 8MB 噪声阈值上抖动——按文件隔离后互不影响。
 *
 * 不变式与常规 fuzz 相同：全撤销回到初始文档（逐字段）、全重做回到终态、
 * 每步写入后文档自洽、序列化幂等往返。生成器覆盖票 08 的三类盲区：
 * 全类型联合补丁键 / 跨父级选区 / 小数增量。
 */

import { describe, expect, it } from 'vitest';

import { CommandError, CommandStack } from '../commands/index';
import { validateDocument } from '../scene/index';
import { parseDocument, serializeDocument } from '../serialize/index';
import { mulberry32, randomOp, scene } from './fuzz-generator';

/** 随机穿插操作 → 全部撤销 → 全部重做，逐字段比对（与常规 fuzz 同一不变式组）。 */
function fuzzRoundTrip(seed: number, steps: number): void {
  const rng = mulberry32(seed);
  // 历史上限须容纳整段序列（默认 200）——截断会让「撤销到初始」不可达
  const stack = new CommandStack(scene(), { historyLimit: steps + 1 });
  const start = JSON.parse(JSON.stringify(stack.document)) as unknown;
  const applied: number[] = [];

  for (let step = 0; step < steps; step += 1) {
    const op = randomOp(stack.document, rng, step);
    if (op.commands.length === 0) continue;
    try {
      stack.dispatch(op.commands, { label: op.label });
      applied.push(step);
      const issues = validateDocument(stack.document);
      if (issues.length > 0) {
        throw new Error(`step ${step} (${op.label}) 后文档不自洽：${JSON.stringify(issues)}`);
      }
    } catch (error) {
      expect(error).toBeInstanceOf(CommandError);
    }
  }

  expect(applied.length).toBeGreaterThan(0);
  const finalJson = JSON.parse(JSON.stringify(stack.document)) as unknown;

  let guard = 0;
  while (stack.undo()) {
    guard += 1;
    expect(guard).toBeLessThanOrEqual(applied.length + 1);
  }
  expect(JSON.parse(JSON.stringify(stack.document))).toEqual(start);

  let guardRedo = 0;
  while (stack.redo()) {
    guardRedo += 1;
    expect(guardRedo).toBeLessThanOrEqual(applied.length + 1);
  }
  expect(JSON.parse(JSON.stringify(stack.document))).toEqual(finalJson);
  expect(validateDocument(stack.document)).toEqual([]);

  const once = serializeDocument(stack.document);
  expect(serializeDocument(parseDocument(once).document)).toBe(once);
}

describe('[verify] 命令栈 · 长跑随机序列往返恒等（票 08）', () => {
  for (const seed of [2027, 31337]) {
    it(`种子 ${seed}：400 步长序列随机操作 → 全撤销 → 全重做`, () => {
      fuzzRoundTrip(seed, 400);
    });
  }
});
