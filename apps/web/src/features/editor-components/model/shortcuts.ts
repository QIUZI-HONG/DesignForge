/**
 * C17 组件快捷键登记（命令面板 E7 的条目来源）。
 *
 * 为什么要一张登记表：快捷键是「命令面板条目 + 键盘处理」的同一份真值——
 * 面板按表列条目，编辑器壳按表匹配键盘事件，二者不可能漂移。
 * 本模块只登记与匹配，**不自己监听键盘**（监听归编辑器壳，避免多处抢事件）。
 */

/** 键盘事件的最小形状（不依赖 DOM 类型，纯逻辑可测）。 */
export interface ShortcutEventLike {
  key: string;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  ctrlKey?: boolean;
}

/** 快捷键修饰符要求。 */
export interface ShortcutMatchSpec {
  /** 主键（小写字母，与 `KeyboardEvent.key.toLowerCase()` 对齐）。 */
  key: string;
  meta?: boolean;
  alt?: boolean;
  shift?: boolean;
  ctrl?: boolean;
}

/** 组件命令条目（命令面板与键盘层共用）。 */
export interface ComponentShortcutSpec {
  /** 命令 id（命令面板条目的稳定键）。 */
  id: string;
  /** 快捷键显示串（Mac 语义；界面只暴露中文，但键位沿用 Figma 习惯）。 */
  keys: string;
  match: ShortcutMatchSpec;
  /** 文案 i18n 键（命令面板显示；文案真源在 messages/zh-CN.json）。 */
  labelKey: string;
  /** 命令面板分组名（中文，与 Figma 中文界面的分组习惯一致）。 */
  category: string;
}

/** 组件类命令登记表（⌘⌥K 为 Figma 习惯；⌘⌥I / ⌘⌥R 为本产品自定并在此登记）。 */
export const COMPONENT_SHORTCUTS: readonly ComponentShortcutSpec[] = [
  {
    id: 'component.create',
    keys: '⌘⌥K',
    match: { key: 'k', meta: true, alt: true },
    labelKey: 'editor.components.command.create',
    category: '组件',
  },
  {
    id: 'component.createInstance',
    keys: '⌘⌥I',
    match: { key: 'i', meta: true, alt: true },
    labelKey: 'editor.components.command.createInstance',
    category: '组件',
  },
  {
    id: 'component.resetOverrides',
    keys: '⌘⌥R',
    match: { key: 'r', meta: true, alt: true },
    labelKey: 'editor.components.command.resetOverrides',
    category: '组件',
  },
];

/** 按 id 取登记项（命令面板调用）。 */
export function shortcutById(id: string): ComponentShortcutSpec | null {
  return COMPONENT_SHORTCUTS.find((entry) => entry.id === id) ?? null;
}

/**
 * 匹配组件快捷键。
 *
 * 口径：修饰键**精确匹配**（多按了 Shift 不算命中，避免与系统/浏览器快捷键撞车）；
 * 主键按 `toLowerCase()` 比较（大写锁与 Shift 大小写不干扰）。
 */
export function matchComponentShortcut(event: ShortcutEventLike): ComponentShortcutSpec | null {
  const key = event.key.toLowerCase();
  return (
    COMPONENT_SHORTCUTS.find(
      (entry) =>
        entry.match.key === key &&
        Boolean(entry.match.meta) === Boolean(event.metaKey) &&
        Boolean(entry.match.alt) === Boolean(event.altKey) &&
        Boolean(entry.match.shift) === Boolean(event.shiftKey) &&
        Boolean(entry.match.ctrl) === Boolean(event.ctrlKey),
    ) ?? null
  );
}
