/**
 * 确定性基准文档生成器（工单 14 · verify:perf 共用夹具）的行为测试。
 *
 * 断言口径：
 *   1. **确定性**——同一参数两次生成的文档经稳定序列化后 sha256 相等（跨机比特一致的地基：
 *      只用整数几何 + 字面调色板 + 注入 id，无随机/时钟/浮点运算）；
 *   2. **合法性**——产出必须通过 `parseDocument` 的结构校验（悬空引用/多父/环都会被打回），
 *      且序列化幂等往返；门禁与引擎微基准/单测共用同一份真源；
 *   3. **形状**——节点数与规模档严格一致、布局公式可复核、id 完全由注入的 IdFactory 决定。
 *
 * 用法：`pnpm --filter @dforge/engine test`。
 */

import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { DesignDocument, ScenePage } from '../model/document';
import { createIdFactory, type NodeId } from '../model/ids';
import type { RectNode } from '../model/node';
import { parseDocument, serializeDocument } from '../serialize/serialize';
import {
  BENCHMARK_CELL_PX,
  BENCHMARK_DOC_SIZES,
  BENCHMARK_NODE_SIZE_PX,
  createBenchmarkDocument,
} from './benchmark-doc';

/** 稳定哈希（与 verify-engine 的快照复核同口径：先稳定序列化再 sha256）。 */
function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** 取首页（noUncheckedIndexedAccess：生成器契约保证恰有一页，缺页即测试夹具坏了）。 */
function firstPage(doc: DesignDocument): ScenePage {
  const page = doc.pages[0];
  if (page === undefined) throw new Error('生成文档没有页面');
  return page;
}

/** 取第 index 个 rootId（noUncheckedIndexedAccess：缺位即夹具坏了，显式失败不静默比较）。 */
function rootIdAt(page: ScenePage, index: number): NodeId {
  const id = page.rootIds[index];
  if (id === undefined) throw new Error(`rootIds 缺位：${String(index)}`);
  return id;
}

/** 按 id 取顶层 rect 节点（缺节点/类型漂移一律显式失败，不静默比较 undefined）。 */
function rectOf(page: ScenePage, id: NodeId): RectNode {
  const node = page.nodes[id];
  if (node === undefined) throw new Error(`节点缺失：${id}`);
  if (node.type !== 'rect') throw new Error(`节点类型漂移：${id}（实测 ${node.type}）`);
  return node;
}

/** 几何 + 外观投影（与 id/name 无关的部分；「换 id 不换几何」断言的独立真值来源）。 */
function shapeOf(node: RectNode): Record<string, unknown> {
  return {
    type: node.type,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    rotation: node.rotation,
    visible: node.visible,
    locked: node.locked,
    opacity: node.opacity,
    blendMode: node.blendMode,
    fills: node.fills,
    strokes: node.strokes,
    effects: node.effects,
    cornerRadius: node.cornerRadius,
  };
}

describe('确定性基准文档生成器（工单 14）', () => {
  it('同一参数两次生成的文档比特一致（稳定序列化 sha256 相等）', () => {
    const first = createBenchmarkDocument({ nodeCount: 5000, ids: createIdFactory(1) });
    const second = createBenchmarkDocument({ nodeCount: 5000, ids: createIdFactory(1) });
    const firstText = serializeDocument(first);
    const secondText = serializeDocument(second);
    expect(sha256(firstText)).toBe(sha256(secondText));
    expect(sha256(firstText)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('1k/5k/20k 三档全部比特一致（同一参数跨次调用）', () => {
    for (const nodeCount of BENCHMARK_DOC_SIZES) {
      const first = serializeDocument(
        createBenchmarkDocument({ nodeCount, ids: createIdFactory(1) }),
      );
      const second = serializeDocument(
        createBenchmarkDocument({ nodeCount, ids: createIdFactory(1) }),
      );
      expect(sha256(first), `nodeCount=${String(nodeCount)}`).toBe(sha256(second));
    }
  });

  it('产出是合法 Design IR：结构校验通过且幂等往返', () => {
    const doc = createBenchmarkDocument({ nodeCount: 1000, ids: createIdFactory(1) });
    const roundTripped = parseDocument(serializeDocument(doc));
    expect(roundTripped.document).toEqual(doc);
  });

  it('节点数与规模档严格一致，rootIds 覆盖全部节点且无重复', () => {
    for (const nodeCount of BENCHMARK_DOC_SIZES) {
      const page = firstPage(createBenchmarkDocument({ nodeCount, ids: createIdFactory(1) }));
      expect(Object.keys(page.nodes), `nodeCount=${String(nodeCount)}`).toHaveLength(nodeCount);
      expect(page.rootIds).toHaveLength(nodeCount);
      expect(new Set(page.rootIds).size).toBe(nodeCount);
    }
  });

  it('布局公式可复核：网格铺开（列数 = ceil(√n)，格距 120、节点 80）', () => {
    const nodeCount = 101; // 非完全平方数：强制 ceil(sqrt(n)) = 11 列，尾行不满
    const page = firstPage(createBenchmarkDocument({ nodeCount, ids: createIdFactory(1) }));
    const cols = Math.ceil(Math.sqrt(nodeCount));
    const first = rectOf(page, rootIdAt(page, 0));
    const last = rectOf(page, rootIdAt(page, nodeCount - 1));
    expect(first).toMatchObject({ x: 0, y: 0, width: BENCHMARK_NODE_SIZE_PX });
    expect(last).toMatchObject({
      x: ((nodeCount - 1) % cols) * BENCHMARK_CELL_PX,
      y: Math.floor((nodeCount - 1) / cols) * BENCHMARK_CELL_PX,
      width: BENCHMARK_NODE_SIZE_PX,
      height: BENCHMARK_NODE_SIZE_PX,
    });
    // 同行内相邻节点 x 严格递增一个格距（公式生成的确定性网格）
    const second = rectOf(page, rootIdAt(page, 1));
    expect(second.x - first.x).toBe(BENCHMARK_CELL_PX);
    expect(second.y).toBe(first.y);
  });

  it('id 完全由注入的 IdFactory 决定：换种子 → id 变，几何与外观不变', () => {
    const base = createBenchmarkDocument({ nodeCount: 12, ids: createIdFactory(1) });
    const shifted = createBenchmarkDocument({ nodeCount: 12, ids: createIdFactory(7) });
    const basePage = firstPage(base);
    const shiftedPage = firstPage(shifted);
    expect(shiftedPage.rootIds[0]).not.toBe(basePage.rootIds[0]);
    expect(shiftedPage.rootIds[0]).toBe('n_7');
    expect(shapeOf(rectOf(shiftedPage, rootIdAt(shiftedPage, 0)))).toEqual(
      shapeOf(rectOf(basePage, rootIdAt(basePage, 0))),
    );
  });

  it('nodeCount 非法（0 / 负数 / 非整数）→ 拒绝生成（不产半套夹具）', () => {
    expect(() => createBenchmarkDocument({ nodeCount: 0, ids: createIdFactory(1) })).toThrow();
    expect(() => createBenchmarkDocument({ nodeCount: -5, ids: createIdFactory(1) })).toThrow();
    expect(() => createBenchmarkDocument({ nodeCount: 10.5, ids: createIdFactory(1) })).toThrow();
  });
});
