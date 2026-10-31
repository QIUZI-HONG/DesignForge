/**
 * 命令栈 fuzz 的共享生成器（基准文档 + 固定种子伪随机 + 随机操作）。
 *
 * 为什么抽成非测试模块：常规种子与长跑种子分属两个测试文件（vitest 按文件隔离环境，
 * 长跑的大量分配不应改变常规文件里性能用例进入时的堆相位——票 08 实测混排会让
 * 「历史条目持有命令」的内存用例在 8MB 噪声阈值上抖动）。
 *
 * 票 08 加固：修前生成器只用四类共有键 + 整数增量 + 单节点选区，钉不住三类缺陷——
 * 1. 跨类型补丁键（NodePatch 全类型联合，B5 的根因输入）；
 * 2. 跨父级多选（move 的各节点按各自父坐标系平移）；
 * 3. 小数增量（浮点相对量不可精确逆运算，(x+dx)-dx ≠ x）。
 */

import { groupNodesCommands } from '../commands/index';
import type { Command } from '../commands/types';
import { createIdFactory } from '../model/ids';
import {
  applicablePatchKeys,
  createComponent,
  createDocument,
  createFrame,
  createInstance,
  createPage,
  createRect,
  createText,
  type DesignDocument,
  defaultAutoLayout,
  defaultTextContent,
  dropShadow,
  type NodePatch,
  type PatchableKey,
  type SceneNode,
  solidPaint,
  strokeOf,
} from '../model/index';
import { getPage, insertNode, insertNodes } from '../scene/index';

/** 固定种子伪随机（mulberry32）——保证可复现。 */
export function mulberry32(seed: number): () => number {
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
export function scene(): DesignDocument {
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

export interface RandomOpResult {
  commands: Command[];
  label: string;
}

/** NodePatch 全类型联合键（含各类型特有键；跨类型由应用侧拒绝——B5 定案的机器检查）。 */
const UNION_PATCH_KEYS: readonly PatchableKey[] = [
  'name',
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'visible',
  'locked',
  'opacity',
  'blendMode',
  'fills',
  'strokes',
  'effects',
  'cornerRadius',
  'text',
  'clipsContent',
  'autoLayout',
  'variantProperties',
];

const BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten'] as const;
const PAINT_COLORS = ['#112233', '#AABBCC', '#445566EE', '#0D99FF'] as const;

/** 无放回抽样 n 个（保持调用方传入的池不被修改）。 */
function sampleWithoutReplacement<T>(rng: () => number, pool: readonly T[], n: number): T[] {
  const rest = [...pool];
  const out: T[] = [];
  for (let index = 0; index < n && rest.length > 0; index += 1) {
    const at = Math.floor(rng() * rest.length) as number;
    out.push(rest.splice(at, 1)[0] as T);
  }
  return out;
}

/** 一位小数（fuzz 的小数增量口径：足以暴露浮点逆运算漂移，又保持结果可复现）。 */
function oneDecimal(rng: () => number, low: number, high: number): number {
  return Math.round((low + rng() * (high - low)) * 10) / 10;
}

/** 按键的值域生成合法值（数值一律有限——NaN/±Infinity 有专门用例，不进 fuzz 主序列）。 */
function patchValueFor(key: PatchableKey, rng: () => number, seq: number): unknown {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rng() * list.length)] as T;
  switch (key) {
    case 'name':
      return `节点 ${seq}`;
    case 'x':
    case 'y':
      return oneDecimal(rng, -100, 400);
    case 'width':
    case 'height':
      return oneDecimal(rng, 5, 220);
    case 'rotation':
      return oneDecimal(rng, -360, 360);
    case 'visible':
    case 'locked':
      return rng() < 0.5;
    case 'opacity':
      return Number(rng().toFixed(3));
    case 'blendMode':
      return pick(BLEND_MODES);
    case 'fills':
      return [solidPaint(pick(PAINT_COLORS))];
    case 'strokes':
      return [
        strokeOf(
          solidPaint(pick(PAINT_COLORS)),
          oneDecimal(rng, 0.5, 6),
          pick(['inside', 'center', 'outside'] as const),
        ),
      ];
    case 'effects':
      return [
        dropShadow(
          '#00000088',
          oneDecimal(rng, -12, 12),
          oneDecimal(rng, -12, 12),
          oneDecimal(rng, 0, 24),
        ),
      ];
    case 'cornerRadius':
      return oneDecimal(rng, 0, 20);
    case 'text':
      return { ...defaultTextContent(), characters: `文 ${seq}` };
    case 'clipsContent':
      return rng() < 0.5;
    case 'autoLayout':
      return defaultAutoLayout(pick(['vertical', 'horizontal'] as const));
    case 'variantProperties':
      return { size: pick(['large', 'small']) };
  }
}

/**
 * 随机补丁：一半概率只从目标类型的适用集取（保证生效流覆盖类型特有键），
 * 一半从全联合取（跨类型组合 → 应用侧整块拒绝，撤销不变式不受扰动）。
 */
function randomPatch(type: SceneNode['type'], rng: () => number, seq: number): NodePatch {
  const applicable = [...applicablePatchKeys(type)];
  const pool = rng() < 0.5 ? applicable : [...UNION_PATCH_KEYS];
  const keys = sampleWithoutReplacement(
    rng,
    pool,
    1 + Math.floor(rng() * Math.min(3, pool.length)),
  );
  const patch: Record<string, unknown> = {};
  for (const key of keys) patch[key] = patchValueFor(key, rng, seq);
  return patch as NodePatch;
}

/** 用当前页面状态生成一条随机操作（可能返回无法施加的命令 → 由调用方宽容处理）。 */
export function randomOp(doc: DesignDocument, rng: () => number, seq: number): RandomOpResult {
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
    // 跨父级选区：1–3 个节点可来自不同父级，各自按其父坐标系平移；半数为小数增量
    const chosen = sampleWithoutReplacement(rng, allIds, 1 + Math.floor(rng() * 3));
    const fractional = rng() < 0.5;
    const dx = fractional ? oneDecimal(rng, -12, 12) : Math.floor(rng() * 21) - 10;
    const dy = fractional ? oneDecimal(rng, -12, 12) : Math.floor(rng() * 21) - 10;
    return {
      commands: [{ type: 'node.move', pageId, nodeIds: chosen, dx, dy }],
      label: `move ${chosen.join(',')}`,
    };
  }
  if (roll < 0.6) {
    return {
      commands: [
        { type: 'node.update', pageId, nodeId: target, patch: randomPatch(node.type, rng, seq) },
      ],
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
    // 覆盖补丁按主组件内子节点的真实类型取适用键（c1kid 缺席时按 rect 兜底）
    const childType = page.nodes.c1kid?.type ?? 'rect';
    return {
      commands: [
        {
          type: 'instance.setOverride',
          pageId,
          instanceId: target,
          path: ['c1kid'],
          patch: randomPatch(childType, rng, seq),
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
