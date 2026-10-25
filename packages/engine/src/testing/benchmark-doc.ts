/**
 * 确定性基准文档生成器（工单 14 · E-4 性能门禁的共用夹具）。
 *
 * 定位（对标报告 §4.1 原则 2 / §4.3）：性能度量必须基于**确定性文档**——
 * 同一生成参数在任何机器、任何时间生成都**比特一致**（跨机可比、跨轮可比），
 * 引擎微基准与单测共用同一份真源。verify-perf 门禁在真链路里动态 import 本模块
 * 生成 1k/5k/20k 文档后经 daemon 落盘、画布打开采集 M1-M7。
 *
 * **零运行时值导入**（硬约束，勿破坏）：本模块只允许 `import type`——
 * verify-perf 以普通 `node`（dev 机 ≥23.6 默认类型剥离）动态加载本文件，
 * 而引擎源码内部相对导入普遍无扩展名，普通 node 解析不了；只有「类型导入被剥离、
 * 无任何运行时值导入」的叶子模块才能同时被 vitest（包内测试）与门禁脚本（node 直载）消费。
 * 因此节点/页面/文档一律按 Design IR 形状直接构造纯数据对象（IR 本就是纯数据，
 * `model/` 构造函数只是薄糖；字段集与 `createRect`/`createPage`/`createDocument` 的默认值逐一对照）。
 *
 * 确定性来源（缺一不可，改动须三思）：
 *   - 几何全为**整数**（无浮点误差漂移）；布局公式固定（网格铺开，列数 = ceil(√n)）；
 *   - 调色板是**字面量数组**按 index 取模（无随机）；命名是纯字符串拼接（无 locale）；
 *   - id 全部来自**注入的 IdFactory**（`createIdFactory`，model/ids.ts）——本模块不自建默认工厂；
 *   - 对象键序 = 构造顺序（JS 语义固定），序列化走稳定键序（serialize/）后比特一致。
 */

import type { DesignDocument, ScenePage } from '../model/document';
import type { GridSettings } from '../model/grid';
import type { IdFactory } from '../model/ids';
import type { RectNode } from '../model/node';
import type { Paint } from '../model/paint';

/** 规模档（对标报告 §4.2：1k / 5k / 20k）。 */
export const BENCHMARK_DOC_SIZES = [1000, 5000, 20000] as const;

/** 单节点边长（世界 px；整数，保证跨机比特一致）。 */
export const BENCHMARK_NODE_SIZE_PX = 80;

/** 网格格距（世界 px；节点间留 40px 空隙，拖拽/框选有真实命中空间）。 */
export const BENCHMARK_CELL_PX = 120;

/** 字面调色板（5 色循环：无随机、无令牌解析——文档真值只存字面值）。 */
const PALETTE = ['#4C8DFF', '#34C77B', '#F5A623', '#E0533D', '#9B6DFF'] as const;

/** 生成选项。 */
export interface BenchmarkDocOptions {
  /** 节点总数（正整数；必须与 BENCHMARK_DOC_SIZES 之一或任意正整数，非法即抛错）。 */
  nodeCount: number;
  /** 注入的确定性 id 工厂（调用方持有，如 `createIdFactory(1)`）。 */
  ids: IdFactory;
  /** 文档 id（缺省 `doc_benchmark_<n>`；daemon 落盘时由 daemon 另行分配，此 id 仅入 IR）。 */
  documentId?: string;
  /** 文档名（缺省 `性能基准 <n> 节点`）。 */
  name?: string;
  /** 页面 id（缺省 `page-1`——对齐 daemon 的页面分配规则 `page-{N}`，门禁落盘即对位）。 */
  pageId?: string;
}

/**
 * 生成确定性基准文档：全部为顶层矩形（扁平、无嵌套——渲染逐节点访问，
 * 布局/命中开销最诚实的形态），按网格铺开使视口天然只覆盖一小部分（剔除率可观测）。
 *
 * @throws nodeCount 非正整数或 ids 缺失时抛错（不产半套夹具）。
 */
export function createBenchmarkDocument(options: BenchmarkDocOptions): DesignDocument {
  const { nodeCount, ids } = options;
  if (!Number.isInteger(nodeCount) || nodeCount <= 0) {
    throw new Error(`nodeCount 必须是正整数（实测 ${String(nodeCount)}）`);
  }
  if (ids === null || ids === undefined || typeof ids.next !== 'function') {
    throw new Error('必须注入 IdFactory（ids.next）——确定性 id 是比特一致的前提');
  }

  const cols = Math.ceil(Math.sqrt(nodeCount));
  const nodes: Record<string, RectNode> = {};
  const rootIds: string[] = [];

  for (let index = 0; index < nodeCount; index += 1) {
    const id = ids.next('n');
    // `?? PALETTE[0]` 只为满足 noUncheckedIndexedAccess 的类型收窄：取模结果恒在数组界内，
    // 回退分支永不触发（字面量回退同样是确定性的，不影响比特一致）。
    const color = PALETTE[index % PALETTE.length] ?? '#4C8DFF';
    const node: RectNode = {
      id,
      name: `矩形 ${index + 1}`,
      type: 'rect',
      x: (index % cols) * BENCHMARK_CELL_PX,
      y: Math.floor(index / cols) * BENCHMARK_CELL_PX,
      width: BENCHMARK_NODE_SIZE_PX,
      height: BENCHMARK_NODE_SIZE_PX,
      rotation: 0,
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      fills: [benchmarkPaint(color)],
      strokes: [],
      effects: [],
      cornerRadius: 0,
    };
    nodes[id] = node;
    rootIds.push(id);
  }

  const page: ScenePage = {
    id: options.pageId ?? 'page-1',
    name: '页面 1',
    nodes,
    rootIds,
    backgroundColor: '#F5F5F5',
    grid: benchmarkGrid(),
  };

  return {
    id: options.documentId ?? `doc_benchmark_${nodeCount}`,
    name: options.name ?? `性能基准 ${nodeCount} 节点`,
    pages: [page],
    tokens: {},
  };
}

/** 纯色填充（与 model/paint.ts `solidPaint` 的产出逐字段一致）。 */
function benchmarkPaint(color: string): Paint {
  return { type: 'solid', color, opacity: 1, visible: true };
}

/** 默认网格（与 model/grid.ts `defaultGridSettings` 的产出逐字段一致）。 */
function benchmarkGrid(): GridSettings {
  return { size: 10, visible: false, snapToGrid: false, style: 'grid' };
}
