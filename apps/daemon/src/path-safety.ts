/**
 * @dforge/daemon · 路径安全（单一真源；Q1 路径穿越修复的基座）。
 *
 * 威胁模型：文档 id / 页 id 既来自路由 params（可 `%2F` 解码出分隔符），
 * 也来自**不可信输入**——Git 克隆来的 `<id>.dfg/manifest.json` 里的 `pages[].id`。
 * 一旦把它们直接 `join` 进文件路径，即可读写/递归删除数据根之外的任意 `.json`（阻断级）。
 *
 * 纪律（缺一不可，与 `docs` 的对抗验证报告 Q1 对齐）：
 * 1. **所有**文件读写/删除（含 `.dfg` 递归删）都必须经 `resolveWithin` 取路径，
 *    任何模块不得自行 `join` 用户输入；
 * 2. `resolveWithin` 做三层校验：`..`/绝对路径/`%00`/NFC 的词法校验 → 规范化前缀校验 →
 *    软链（`realpath`）前缀校验；任一层越界即拒（返回 `null`，不抛异常）；
 * 3. 标识符白名单在**进入路径之前**把关：页 id 严格 `[A-Za-z0-9._-]{1,64}`；
 *    文档 id 按契约「中文保留」口径加固（无分隔符/控制字符/前导点/超长/非 NFC）；
 * 4. 错误形状统一（`doc_invalid_id` 等）+ 4xx，消息与 details 不含绝对路径。
 */

import { realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

/** 标识符长度上限（与 `DOCUMENT_NAME_MAX_LENGTH` 同口径：避免超长目录名）。 */
export const ID_MAX_LENGTH = 64;

/** 页 id 严格白名单（daemon 自生成 `page-N`——外部输入一律不放行）。 */
const ASCII_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

/** 跨平台文件系统保留字符（路径分隔符与 Windows 保留字符一并拒绝）。 */
const RESERVED_CHARS = /[\\/:*?"<>|]/;

/** 是否含控制字符（含 DEL；逐码点判，避免正则里的控制字符字面量）。 */
function hasControlChar(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * 页 id 白名单：`[A-Za-z0-9._-]{1,64}`，且显式拒绝 `.` / `..`。
 * 页面 id 由 daemon 分配（`page-N`），不存在合法外部输入 → 一律从严。
 */
export function isValidPageId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > ID_MAX_LENGTH) return false;
  if (value === '.' || value === '..') return false;
  return ASCII_ID_PATTERN.test(value);
}

/**
 * 文档 id 白名单（路由 params / 目录名口径）。
 *
 * 说明：契约层 `documentIdFromName` 明确「中文保留——本地优先、中文优先」，
 * 因此文档 id **不能**收窄成纯 ASCII（会破坏既有中文文档名与既有用例）；
 * 这里用「既有的更严口径」= 文档名口径（`isValidDocumentName`）+ 标识符加固：
 * 非空、≤64、不以 `.` 开头（含 `.`/`..`）、无路径分隔符/控制字符/NUL、
 * 且必须是 NFC（拒绝 NFD 变体，避免 macOS 撞名与同形不同目录）。
 * 真正兜底的越界防线是 `resolveWithin`（词法 + `realpath` 双前缀校验）。
 */
export function isValidDocumentId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > ID_MAX_LENGTH) return false;
  if (value.startsWith('.')) return false;
  if (value.includes('\u0000')) return false;
  if (RESERVED_CHARS.test(value)) return false;
  if (hasControlChar(value)) return false;
  if (value.normalize('NFC') !== value) return false;
  return true;
}

/** 校验单个路径段（拒绝空段、绝对路径、NUL、非 NFC、以及 `.`/`..` 段）。 */
function isSafeSegment(segment: string): boolean {
  if (typeof segment !== 'string' || segment.length === 0) return false;
  if (segment.includes('\u0000')) return false;
  if (isAbsolute(segment)) return false;
  if (segment.normalize('NFC') !== segment) return false;
  for (const part of segment.split('/')) {
    if (part === '' || part === '.' || part === '..') return false;
  }
  return true;
}

/** `candidate` 是否落在 `root` 之内（含等于；`..` 逃逸与绝对路径均判越界）。 */
function isWithin(root: string, candidate: string): boolean {
  if (candidate === root) return true;
  const prefix = root.endsWith('/') ? root : `${root}/`;
  return candidate.startsWith(prefix);
}

/**
 * 取「最近的已存在祖先」的真实路径（软链已解析）。
 * 目标自身不存在（新文件）时，用已存在祖先的 realpath + 剩余词法部分拼回——
 * 这样新建文件的父目录若是软链，也会被如实解析出真实落点。
 */
async function realpathOfNearest(target: string): Promise<string> {
  let current = target;
  const tail: string[] = [];
  for (;;) {
    try {
      const real = await realpath(current);
      return tail.length === 0 ? real : join(real, ...tail.slice().reverse());
    } catch {
      const parent = dirname(current);
      if (parent === current) return target; // 连根都不存在（极端）：退回词法值
      tail.push(basename(current));
      current = parent;
    }
  }
}

/**
 * 单一安全路径解析器：把 `segments` 接到 `root` 下，越界即返回 `null`。
 *
 * 校验顺序：
 * 1. 逐段词法校验（空段 / 绝对路径 / NUL / 非 NFC / `.`/`..` 段 → 拒）；
 * 2. 规范化（`path.resolve`）后做前缀校验，必须仍在 `root` 内；
 * 3. 软链校验：`realpath(最近存在祖先)` 仍须落在 `realpath(root)` 内（防软链写穿）；
 * 4. 目标不得等于 `root` 本身（数据根不是任何写/删操作的合法目标）。
 *
 * @param root 数据根（如 `<dataRoot>/workspace`）
 * @param segments 相对段（末尾省略时表示「数据根本身」，供 readdir 使用）
 */
export async function resolveWithin(root: string, ...segments: string[]): Promise<string | null> {
  const absoluteRoot = resolve(root);
  for (const segment of segments) {
    if (!isSafeSegment(segment)) return null;
  }
  const target = resolve(absoluteRoot, ...segments);
  if (!isWithin(absoluteRoot, target)) return null;
  if (segments.length === 0) return target; // 仅「数据根本身」这一种形态允许等于根
  if (target === absoluteRoot) return null;
  const realRoot = await realpathOfNearest(absoluteRoot);
  const realTarget = await realpathOfNearest(target);
  if (!isWithin(realRoot, realTarget)) return null;
  if (realTarget === realRoot) return null;
  return target;
}

/**
 * 对象级删除守卫：判定 `target` 是否恰好是「`root` 内的一个 `.dfg` 目录」。
 * 绝不允许把数据根本身、根的祖先、或根内的普通文件/软链作为递归删目标。
 */
export function isRemovableDocDirectory(options: {
  root: string;
  target: string;
  suffix: string;
}): boolean {
  const { root, target, suffix } = options;
  if (target === root) return false;
  if (dirname(target) !== root) return false; // 必须是「直接子级」——根本身/更深层一律拒
  const name = basename(target);
  if (!name.endsWith(suffix)) return false;
  if (name.length <= suffix.length) return false; // 形如 `.dfg`（空 id）不是文档目录
  return true;
}

/**
 * JSON 嵌套深度是否超过 `maxDepth`（**迭代**实现，不吃调用栈）。
 * 用途：opaque 正文落盘前把关——`JSON.stringify` 是递归的，
 * 20 万层嵌套会栈溢出 → 500；这里在序列化前把这类输入判为 4xx。
 */
export function exceedsJsonDepth(value: unknown, maxDepth: number): boolean {
  const stack: { node: unknown; depth: number }[] = [{ node: value, depth: 0 }];
  while (stack.length > 0) {
    const item = stack.pop();
    if (item === undefined) break;
    if (item.depth > maxDepth) return true;
    const node = item.node;
    if (Array.isArray(node)) {
      for (const child of node) stack.push({ node: child, depth: item.depth + 1 });
      continue;
    }
    if (typeof node === 'object' && node !== null) {
      for (const key of Object.keys(node)) {
        stack.push({ node: (node as Record<string, unknown>)[key], depth: item.depth + 1 });
      }
    }
  }
  return false;
}
