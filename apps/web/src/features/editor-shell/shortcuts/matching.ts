/**
 * 快捷键串解析与匹配（E8 快捷键表与全局键盘派发共用的纯逻辑）。
 *
 * 口径：
 * - 快捷键串是**展示与派发的同一份来源**（`Command.shortcut`，如 `'⇧⌘Z'`）——
 *   命令面板、快捷键说明、键盘派发三处不可能漂移；
 * - 修饰键记法用符号：`⌘`（主修饰）/ `⇧` / `⌥`；兼容 `Cmd`/`Meta`/`Ctrl`/`Control`/`Shift`/`Alt`/`Option`；
 * - `⌘` 是**主修饰键**：mac 上是 Meta，Windows/Linux 上是 Ctrl——匹配时两者皆认，
 *   同一份快捷键表跨平台可用（验收标准 §3：浏览器与 Electron 壳内行为一致）；
 * - 末位键大小写不敏感；`+`/`=` 与 `-`/`_` 互为别名（不同键盘布局下同一物理键报法不同），
 *   这两组**不校验 Shift**（`+` 与 `_` 本身多由 Shift 产出）。
 */

/** 解析后的快捷键。 */
export interface ParsedShortcut {
  /** 可接受的末位键（小写，含别名，如 `['+', '=']`）。 */
  keys: readonly string[];
  /** 需要主修饰键（`⌘`）。 */
  meta: boolean;
  shift: boolean;
  alt: boolean;
}

/** 参与匹配的事件形状（`KeyboardEvent` 子集，便于纯函数测试）。 */
export interface ShortcutEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** 符号修饰键。 */
const MODIFIER_SYMBOLS: Record<string, 'meta' | 'shift' | 'alt'> = {
  '⌘': 'meta',
  '⇧': 'shift',
  '⌥': 'alt',
};

/** 字母类修饰词（大小写不敏感）。 */
const MODIFIER_WORDS: Record<string, 'meta' | 'shift' | 'alt'> = {
  cmd: 'meta',
  command: 'meta',
  meta: 'meta',
  ctrl: 'meta',
  control: 'meta',
  shift: 'shift',
  alt: 'alt',
  option: 'alt',
};

/** 同一物理键的两种报法（互为别名）。 */
const ALIAS_GROUPS: readonly (readonly string[])[] = [
  ['+', '='],
  ['-', '_'],
];

/** 末位键 → 全部可接受写法。 */
const KEY_ALIASES: Record<string, readonly string[]> = Object.fromEntries(
  ALIAS_GROUPS.flatMap((group) => group.map((key) => [key, group])),
);

/** 不校验 Shift 的末位键（这些字符常由 Shift 产出，强校验会误杀）。 */
const SHIFT_TOLERANT_KEYS = new Set(ALIAS_GROUPS.flat());

/**
 * 解析快捷键串。
 *
 * @param text 如 `'⌘K'`、`'⇧⌘Z'`、`'⌘/'`、`'⌘+'`、`'Shift+0'`、`'V'`
 * @returns 解析结果；缺末位键或空串 → `null`
 */
export function parseShortcut(text: string): ParsedShortcut | null {
  const parsed = { keys: [] as readonly string[], meta: false, shift: false, alt: false };
  let rest = text.trim();
  if (rest === '') return null;

  // 1) 前缀符号修饰键（可连写，如 '⇧⌘Z'）
  while (rest.length > 0) {
    const symbol = MODIFIER_SYMBOLS[rest[0] as string];
    if (symbol === undefined) break;
    parsed[symbol] = true;
    rest = rest.slice(1);
  }

  // 2) 反复消耗「字母类修饰词」与分隔符 '+'（'+' 仅在后面还有内容时才算分隔符，
  //    否则 '⌘+' 的末位键会被当成分隔符吃掉）
  let progress = true;
  while (progress && rest.length > 0) {
    progress = false;
    const word = rest.match(/^[A-Za-z]+/)?.[0];
    // 只有「修饰词之后还有末位键」时才按修饰词吸收，避免把单键 'v' 当修饰词
    if (word !== undefined && rest.length > word.length) {
      const modifier = MODIFIER_WORDS[word.toLowerCase()];
      if (modifier !== undefined) {
        parsed[modifier] = true;
        rest = rest.slice(word.length);
        progress = true;
      }
    }
    if (rest.startsWith('+') && rest.length > 1) {
      rest = rest.slice(1);
      progress = true;
    }
  }

  const key = rest.trim();
  if (key === '') return null;
  const normalized = key.toLowerCase();
  // 只剩一个修饰词、没有末位键（如 'Shift'、'Cmd'）：不是合法快捷键
  if (MODIFIER_WORDS[normalized] !== undefined) return null;
  return { ...parsed, keys: KEY_ALIASES[normalized] ?? [normalized] };
}

/** 是否含任一修饰键（无修饰键的快捷键在输入区内不派发）。 */
export function hasModifier(parsed: ParsedShortcut): boolean {
  return parsed.meta || parsed.shift || parsed.alt;
}

/**
 * 事件是否命中快捷键。
 *
 * 修饰键**精确匹配**（多按了 Alt/Shift 不算命中）；主修饰键 `⌘` 认 Meta 与 Ctrl 两者；
 * 别名键（`+`/`=`、`-`/`_`）不校验 Shift。
 */
export function matchesShortcut(event: ShortcutEventLike, parsed: ParsedShortcut): boolean {
  const key = event.key.toLowerCase();
  if (!parsed.keys.includes(key)) return false;

  const primaryPressed = event.metaKey || event.ctrlKey;
  if (primaryPressed !== parsed.meta) return false;
  if (event.altKey !== parsed.alt) return false;
  if (!SHIFT_TOLERANT_KEYS.has(key) && event.shiftKey !== parsed.shift) return false;
  return true;
}

/**
 * 事件目标是否是可编辑区（输入框 / 文本域 / 下拉 / 内容可编辑）。
 *
 * 用途：**无修饰键的快捷键**（工具键 V/F/R/T/H）在输入时不得劫持按键——
 * 在命令面板的搜索框里打 'v' 只能是输入 'v'。
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (target === null || !(target instanceof HTMLElement)) return false;
  // `isContentEditable` 在 jsdom 未实现，属性回退保证测试与浏览器同判据
  if (target.isContentEditable === true) return true;
  const contentEditable = target.getAttribute('contenteditable');
  if (contentEditable !== null && contentEditable !== 'false') return true;
  const tag = target.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') {
    const type = (target as HTMLInputElement).type.toLowerCase();
    // 按钮类 input 不是文字输入区
    return !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file'].includes(
      type,
    );
  }
  return false;
}
