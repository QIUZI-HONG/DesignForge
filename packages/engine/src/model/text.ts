/**
 * 文本内容模型（C10 内联编辑的数据面）。
 *
 * 编辑覆盖层（DOM，世界坐标对齐）归 FE-06；本包只承载文本数据与其**结构化编辑操作**
 * （插入/删除/选区替换），保证编辑结果可经命令栈提交与撤销。
 */

/**
 * 单文本节点字符数上限（UTF-16 码元口径，与 `string.length` 一致）。
 *
 * 依据（票 13 / spec P2「超长输入钳制」）：UX 巡检以 5000 字探针实测各输入位，
 * 与架构规模族（5000 节点可打开）同数量级——超过后文档体积与段落布局都进入
 * 病态区间，故在编辑会话的写入点（`insertText`）钳制，UI 与命令栈同源受益。
 */
export const TEXT_CHARACTERS_MAX_LENGTH = 5000;

/** 把任意输入钳到字符数上限内（截断尾部的超出部分）。 */
export function clampTextCharacters(value: string): string {
  return value.length > TEXT_CHARACTERS_MAX_LENGTH
    ? value.slice(0, TEXT_CHARACTERS_MAX_LENGTH)
    : value;
}

/** 文本水平对齐（Inspector「文字」分区）。 */
export type TextAlign = 'left' | 'center' | 'right' | 'justify';

/** 自动尺寸：与 Figma 一致的三态。 */
export type TextAutoResize = 'none' | 'width_and_height' | 'height';

/** 文本节点内容与排版属性。 */
export interface TextContent {
  characters: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  /** 行高倍数（1 = 100%）。 */
  lineHeight: number;
  /** 字距（px）。 */
  letterSpacing: number;
  align: TextAlign;
  autoResize: TextAutoResize;
}

/** 文本选区（半开区间 [start, end)，与 DOM Selection 语义一致）。 */
export interface TextSelection {
  start: number;
  end: number;
}

/** 默认文本内容（新建文本节点用）。 */
export function defaultTextContent(characters = ''): TextContent {
  return {
    characters,
    fontFamily: 'Noto Sans SC',
    fontSize: 14,
    fontWeight: 400,
    lineHeight: 1.4,
    letterSpacing: 0,
    align: 'left',
    autoResize: 'width_and_height',
  };
}

/** 归一化选区：保证 start ≤ end 且落在文本长度内。 */
export function normalizeSelection(text: string, selection: TextSelection): TextSelection {
  const clamp = (value: number): number => Math.max(0, Math.min(text.length, Math.trunc(value)));
  const start = clamp(selection.start);
  const end = clamp(selection.end);
  return start <= end ? { start, end } : { start: end, end: start };
}

/** 在选区处替换文本（输入法/粘贴/删除据此实现），返回新内容。 */
export function replaceTextRange(
  content: TextContent,
  selection: TextSelection,
  inserted: string,
): TextContent {
  const { start, end } = normalizeSelection(content.characters, selection);
  const characters = content.characters.slice(0, start) + inserted + content.characters.slice(end);
  return { ...content, characters };
}

/** 删除选区（Backspace/Delete）。 */
export function deleteTextRange(
  content: TextContent,
  selection: TextSelection,
): { content: TextContent; selection: TextSelection } {
  const { start, end } = normalizeSelection(content.characters, selection);
  // 折叠选区时删除前一个字符（Backspace 语义）
  const from = start === end ? Math.max(0, start - 1) : start;
  const content2 = replaceTextRange(content, { start: from, end }, '');
  return { content: content2, selection: { start: from, end: from } };
}
