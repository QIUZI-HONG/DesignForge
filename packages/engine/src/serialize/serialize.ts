/**
 * 序列化：Design IR ⇄ JSON（**稳定键序**、幂等往返）。
 *
 * 为什么需要稳定键序：文档要能进 Git（本地优先 → 可 diff），同一文档在任何环境、
 * 任何写入顺序下都应产出**逐字节相同**的 JSON；键排序后 diff 只反映真实变更。
 *
 * 信封（envelope）：`{ $format, $version, document }`——版本号让导入端能识别旧文件并迁移；
 * `parseDocument` 同时接受带信封与裸文档两种输入（夹具书写更省事）。
 *
 * 入口守门（修复批次 3 · A1）：序列化与导入都在**递归之前**跑同一组显式上限检查
 * （节点链深度 → 结构深度 → 非有限数），超限抛 `DomainError('invalid-argument')` 并带路径。
 * 为什么序列化也要守：`sortKeysDeep` 是递归实现，超深载荷同样会以原生栈溢出击穿调用方；
 * 且导出与导入必须同口径——否则引擎自己导出的文档会导不回来。
 *
 * 原型污染同口径（修复批次 3 · A2）：解析（`parseDocument`）、克隆（`cloneDocument`）与
 * 键排序（`sortKeysDeep`）三处一律**丢弃**自有 `__proto__` 键——与命令栈入栈深拷
 * （`commands/stack.ts` 的 `cloneCommand`）一致。为什么丢弃而不转义：Design IR 没有该字段，
 * 而 `obj[key] = v` 形态的任何赋值路径都会退化成原型改写，载荷里保留它只有风险没有语义。
 */

import type { DesignDocument } from '../model/index';
import { domainError } from '../scene/errors';
import {
  assertNodeDepthWithinLimit,
  assertPageNodeDepthWithinLimit,
  assertValidDocument,
  assertValueDepthWithinLimit,
  collectNonFiniteNumbers,
  dropProtoKeys,
  validateDocument,
} from '../scene/validate';

/** 格式标识。 */
export const DESIGN_IR_FORMAT = 'dforge.designir' as const;

/** 当前版本（递增即表示有破坏性变更）。 */
export const DESIGN_IR_VERSION = 1;

/** 序列化信封。 */
export interface DesignIrEnvelope {
  $format: typeof DESIGN_IR_FORMAT;
  $version: number;
  document: DesignDocument;
}

/** 递归按键名排序（数组顺序保持）。自有 `__proto__` 键直接丢弃（见模块头：原型污染同口径）。 */
export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortKeysDeep(item));
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      // 为什么跳过（而不是赋值后再删）：out['__proto__'] = v 会走到 Object.prototype 的
      // 原型 setter，把出参对象的原型改写掉——键没进载荷，原型却被污染（旧缺陷）。
      if (key === '__proto__') continue;
      const item = source[key];
      if (item === undefined) continue; // JSON 语义：undefined 不落盘
      out[key] = sortKeysDeep(item);
    }
    return out;
  }
  return value;
}

/** 稳定 JSON 字符串（键序稳定、2 空格缩进）。 */
export function stableStringify(value: unknown, space = 2): string {
  return JSON.stringify(sortKeysDeep(value), null, space);
}

/** 文档 → 信封对象。 */
export function documentEnvelope(doc: DesignDocument): DesignIrEnvelope {
  return { $format: DESIGN_IR_FORMAT, $version: DESIGN_IR_VERSION, document: doc };
}

/**
 * 序列化前守门：非有限数（NaN/±Infinity）会被 JSON **静默**折成 null，
 * 文档从此类型漂移、校验无感、下游把 null 当 0 参与布局（B2）。一律拒绝并给出路径。
 */
export function assertSerializableNumbers(value: unknown, label: string): void {
  const bad = collectNonFiniteNumbers(value);
  if (bad.length === 0) return;
  throw domainError(
    'invalid-argument',
    `${label}含非有限数值（NaN/±Infinity），拒绝序列化：${bad
      .map((item) => `${item.path}=${String(item.value)}`)
      .join('、')}`,
  );
}
/** 序列化文档（稳定键序 + 信封）。 */
export function serializeDocument(doc: DesignDocument): string {
  assertNodeDepthWithinLimit(doc, '文档');
  assertValueDepthWithinLimit(doc, '文档');
  assertSerializableNumbers(doc, '文档');
  return stableStringify(documentEnvelope(doc));
}

/** 序列化单页（导出/分享片段用）。 */
export function serializePage(doc: DesignDocument, pageId: string): string {
  const page = doc.pages.find((candidate) => candidate.id === pageId);
  if (!page) throw domainError('page-not-found', `页面不存在：${pageId}`);
  assertPageNodeDepthWithinLimit(page, '页面');
  assertValueDepthWithinLimit(page, '页面');
  assertSerializableNumbers(page, '页面');
  return stableStringify({ $format: DESIGN_IR_FORMAT, $version: DESIGN_IR_VERSION, page });
}

/** 解析结果。 */
export interface ParsedDocument {
  document: DesignDocument;
  version: number;
  /** 是否带信封（裸文档解析时为 false）。 */
  enveloped: boolean;
}

/**
 * 解析文档：接受信封 JSON、裸文档 JSON 或已解析对象。
 * 结构非法（悬空引用/多父/环等）时抛 `DomainError('invalid-argument')`。
 */
export function parseDocument(input: string | unknown): ParsedDocument {
  let raw: unknown = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch {
      throw domainError('invalid-argument', '文档内容不是合法 JSON');
    }
  }
  if (raw === null || typeof raw !== 'object') {
    throw domainError('invalid-argument', '文档内容不是对象');
  }
  const record = raw as Record<string, unknown>;
  const enveloped = record.$format === DESIGN_IR_FORMAT;
  if (record.$format !== undefined && !enveloped) {
    throw domainError('invalid-argument', `未知的文档格式：${String(record.$format)}`);
  }
  const version = typeof record.$version === 'number' ? record.$version : DESIGN_IR_VERSION;
  const rawDocument = (enveloped ? record.document : record) as DesignDocument | undefined;
  if (!rawDocument || typeof rawDocument !== 'object') {
    throw domainError('invalid-argument', '信封缺少 document 字段');
  }
  if (!Array.isArray(rawDocument.pages) || rawDocument.pages.length === 0) {
    throw domainError('invalid-argument', '文档缺少页面');
  }
  // 深度守门：与序列化同一组上限（见模块头）——超限在这里就拒绝，绝不落到 validateDocument
  // 的递归结构检查或后续 sortKeysDeep 上（旧缺陷：导入超深文档抛原生 TypeError/RangeError）。
  assertNodeDepthWithinLimit(rawDocument, '文档');
  assertValueDepthWithinLimit(rawDocument, '文档');
  // 原型污染同口径：自有 __proto__ 键在解析处即丢弃（深拷重建，先过上面的结构深度守门）。
  //
  // 为什么**静默**丢弃是安全且确定的（修复批次 3 A2 收口 · code-review #6 选 (ii)，不计数）：
  //   1) 判据确定：只命中键名恰为 `__proto__` 的**自有可枚举**键——`Object.entries` 只列自有
  //      可枚举属性，`JSON.parse` 产出的 `__proto__` 是普通自有数据属性（不走 setter），
  //      判定与输入顺序、深度、平台、时钟全无关；同一载荷每次结果逐字节相同（用例已锁定）。
  //   2) 不产生未判定态：丢弃点排在 `assertValueDepthWithinLimit` **之后**，超深载荷先被
  //      领域错误拒绝，不存在「丢弃过程本身栈溢出」的灰区。
  //   3) 不改变任何调用方决策：Design IR 的类型（`DesignDocument`）没有任何 `__proto__`
  //      字段，合法文档不可能携带它；携带它的只能是外部注入/畸形载荷，其处置与「未知字段」
  //      同一裁决——导入的两态出口（成功 + 结构校验 / 领域错误）不因「丢了几个键」而变
  //      （`obj['__proto__'] = v` 形态的「还原」本身就会退化成原型改写，即不可消费）。
  //   4) 因此计数只服务于审计留痕，而引擎当前没有校验证据通道；为它新开
  //      engine → contracts → daemon → web 的跨包证据链，收益不抵本批范围（详见票面报告）。
  // 语义等价声明：丢弃后 `validateDocument` 的结论与「载荷本就不含该键」完全一致。
  const document = dropProtoKeys(rawDocument);
  const issues = validateDocument(document);
  if (issues.length > 0) {
    throw domainError(
      'invalid-argument',
      `文档结构非法：${issues.map((issue) => `${issue.code}(${issue.message})`).join('；')}`,
    );
  }
  return { document, version, enveloped };
}

/** 往返：`parseDocument(serializeDocument(doc))` 的便捷包装（含结构断言）。 */
export function roundTripDocument(doc: DesignDocument): DesignDocument {
  const parsed = parseDocument(serializeDocument(doc));
  assertValidDocument(parsed.document);
  return parsed.document;
}

/**
 * 深拷贝文档（结构共享的不可变路径之外的场景：导出快照/对比）。
 * JSON 往返后按统一步调丢弃自有 `__proto__` 键（JSON 往返会把它原样带回来）；
 * 静默丢弃的安全性与确定性论证见 `parseDocument` 丢弃点（同一处裁决，不重复声明）。
 */
export function cloneDocument(doc: DesignDocument): DesignDocument {
  return dropProtoKeys(JSON.parse(JSON.stringify(doc)) as DesignDocument);
}

/** 文档统计（状态栏/看板：页面数、节点数）。 */
export function documentStats(doc: DesignDocument): {
  pages: number;
  nodes: number;
  components: number;
  instances: number;
} {
  let nodes = 0;
  let components = 0;
  let instances = 0;
  for (const page of doc.pages) {
    for (const node of Object.values(page.nodes)) {
      nodes += 1;
      if (node.type === 'component') components += 1;
      if (node.type === 'instance') instances += 1;
    }
  }
  return { pages: doc.pages.length, nodes, components, instances };
}
