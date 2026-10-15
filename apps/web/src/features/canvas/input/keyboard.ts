/**
 * 快捷键分发表（白名单第 1–13 类的键盘入口）。
 *
 * 设计：
 * - 每个条目是**纯数据 + 谓词 + 动作**（`match` / `run`），因此可以
 *   ① 直接单测分派（不依赖 DOM 事件对象）、② 派生快捷键说明表与命令面板条目（FE-03/FE-08 复用）。
 * - 修饰键口径：`mod` = ⌘（mac）**或** Ctrl（Windows/Linux）——本机与 CI（Linux）都要能用；
 *   展示串按产品语言用 ⌘。
 * - 文本内联编辑中只有列出的条目生效（其余交给 DOM 覆盖层的输入框）。
 */

import type { Point } from '@dforge/engine';

import type { CanvasSession } from '../state/session';

/** 归一化后的按键输入（DOM 事件 → 本形状）。 */
export interface KeyInput {
  key: string;
  meta: boolean;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  /** 长按重复（方向键微移允许重复）。 */
  repeat?: boolean;
}

/** 快捷键上下文（需要视口尺寸的动作）。 */
export interface ShortcutContext {
  screenSize: { width: number; height: number };
  /** 视口中心（缩放锚点）。 */
  screenCenter: Point;
}

/** 快捷键条目。 */
export interface ShortcutSpec {
  /** 稳定 id（命令面板/说明表用）。 */
  id: string;
  /** i18n 键（界面文案一律走 ICU 消息）。 */
  labelKey: string;
  /** 展示用组合键（产品语言：⌘）。 */
  display: string;
  match: (input: KeyInput) => boolean;
  run: (session: CanvasSession, context: ShortcutContext, input: KeyInput) => void;
  /** 文本编辑中是否仍生效（默认 false）。 */
  whileEditing?: boolean;
  /** 分组（快捷键说明表两栏排布用）。 */
  group: 'clipboard' | 'history' | 'arrange' | 'view' | 'edit';
}

/** 修饰键判定（⌘ 或 Ctrl）。 */
function mod(input: KeyInput): boolean {
  return input.meta || input.ctrl;
}

/** 简单组合键匹配（`mod` 与 shift 明确区分）。 */
function combo(key: string, options: { mod?: boolean; shift?: boolean } = {}) {
  const wantMod = options.mod === true;
  const wantShift = options.shift === true;
  return (input: KeyInput): boolean =>
    input.key.toLowerCase() === key.toLowerCase() &&
    mod(input) === wantMod &&
    input.shift === wantShift &&
    input.alt === false;
}

/** 快捷键表（顺序即匹配优先级）。 */
export const SHORTCUTS: readonly ShortcutSpec[] = [
  {
    id: 'undo',
    labelKey: 'canvas.action.undo',
    display: '⌘Z',
    match: combo('z', { mod: true, shift: false }),
    run: (session) => session.undo(),
    group: 'history',
  },
  {
    id: 'redo',
    labelKey: 'canvas.action.redo',
    display: '⇧⌘Z',
    match: combo('z', { mod: true, shift: true }),
    run: (session) => session.redo(),
    group: 'history',
  },
  {
    id: 'copy',
    labelKey: 'canvas.action.copy',
    display: '⌘C',
    match: combo('c', { mod: true }),
    run: (session) => session.copy(),
    group: 'clipboard',
  },
  {
    id: 'paste',
    labelKey: 'canvas.action.paste',
    display: '⌘V',
    match: combo('v', { mod: true }),
    run: (session) => {
      void session.paste();
    },
    group: 'clipboard',
  },
  {
    id: 'duplicate',
    labelKey: 'canvas.action.duplicate',
    display: '⌘D',
    match: combo('d', { mod: true }),
    run: (session) => session.duplicate(),
    group: 'clipboard',
  },
  {
    id: 'delete',
    labelKey: 'canvas.action.delete',
    display: '⌫',
    match: (input) => input.key === 'Delete' || input.key === 'Backspace',
    run: (session) => session.deleteSelection(),
    group: 'edit',
  },
  {
    id: 'group',
    labelKey: 'canvas.action.group',
    display: '⌘G',
    match: combo('g', { mod: true, shift: false }),
    run: (session) => session.group(),
    group: 'arrange',
  },
  {
    id: 'ungroup',
    labelKey: 'canvas.action.ungroup',
    display: '⇧⌘G',
    match: combo('g', { mod: true, shift: true }),
    run: (session) => session.ungroup(),
    group: 'arrange',
  },
  {
    id: 'bringToFront',
    labelKey: 'canvas.action.bringToFront',
    display: '⇧⌘]',
    match: (input) => mod(input) && input.shift && (input.key === ']' || input.key === '}'),
    run: (session) => session.reorder('front'),
    group: 'arrange',
  },
  {
    id: 'bringForward',
    labelKey: 'canvas.action.bringForward',
    display: '⌘]',
    match: (input) => mod(input) && !input.shift && (input.key === ']' || input.key === '}'),
    run: (session) => session.reorder('forward'),
    group: 'arrange',
  },
  {
    id: 'sendBackward',
    labelKey: 'canvas.action.sendBackward',
    display: '⌘[',
    match: (input) => mod(input) && !input.shift && (input.key === '[' || input.key === '{'),
    run: (session) => session.reorder('backward'),
    group: 'arrange',
  },
  {
    id: 'sendToBack',
    labelKey: 'canvas.action.sendToBack',
    display: '⇧⌘[',
    match: (input) => mod(input) && input.shift && (input.key === '[' || input.key === '{'),
    run: (session) => session.reorder('back'),
    group: 'arrange',
  },
  {
    id: 'selectAll',
    labelKey: 'canvas.action.selectAll',
    display: '⌘A',
    match: combo('a', { mod: true }),
    run: (session) => session.selectAll(),
    group: 'edit',
  },
  {
    id: 'zoomIn',
    labelKey: 'canvas.action.zoomIn',
    display: '⌘+',
    match: (input) => mod(input) && (input.key === '+' || input.key === '='),
    run: (session, context) => session.zoomIn(context.screenCenter),
    group: 'view',
  },
  {
    id: 'zoomOut',
    labelKey: 'canvas.action.zoomOut',
    display: '⌘−',
    match: (input) => mod(input) && (input.key === '-' || input.key === '_'),
    run: (session, context) => session.zoomOut(context.screenCenter),
    group: 'view',
  },
  {
    id: 'zoomReset',
    labelKey: 'canvas.action.zoomReset',
    display: '⌘0',
    match: (input) => mod(input) && input.key === '0',
    run: (session, context) => session.zoom100(context.screenSize),
    group: 'view',
  },
  {
    id: 'zoomFit',
    labelKey: 'canvas.action.zoomFit',
    display: '⇧1',
    match: (input) => !mod(input) && input.shift && input.key === '1',
    run: (session, context) => session.zoomToFit(context.screenSize),
    group: 'view',
  },
  {
    id: 'toggleRulers',
    labelKey: 'canvas.action.toggleRulers',
    display: '⇧R',
    match: (input) => !mod(input) && input.shift && input.key.toLowerCase() === 'r',
    run: (session) => session.setRulers(!session.store.getState().rulers),
    group: 'view',
  },
  {
    id: 'editText',
    labelKey: 'canvas.action.editText',
    display: 'Enter',
    match: (input) => input.key === 'Enter' && !mod(input),
    run: (session) => {
      const id = session.singleSelectionId();
      if (id === null) return;
      session.beginTextEditing(id, { selectAll: true });
    },
    group: 'edit',
  },
  {
    id: 'nudge',
    labelKey: 'canvas.action.nudge',
    display: '↑↓←→',
    match: (input) =>
      !mod(input) &&
      (input.key === 'ArrowUp' ||
        input.key === 'ArrowDown' ||
        input.key === 'ArrowLeft' ||
        input.key === 'ArrowRight'),
    run: (session, _context, input) => {
      void _context;
      runArrow(session, input);
    },
    group: 'edit',
  },
  {
    id: 'cancel',
    labelKey: 'canvas.action.cancel',
    display: 'Esc',
    match: (input) => input.key === 'Escape',
    run: (session) => {
      const state = session.store.getState();
      if (state.editing !== null) {
        session.cancelText();
        return;
      }
      if (state.interaction.kind !== 'idle' || state.draft !== null) {
        session.cancelActiveInteraction();
        return;
      }
      session.clearSelection();
    },
    whileEditing: true,
    group: 'edit',
  },
];

/** 方向键微移步长（世界单位；Shift 加速）。 */
export const NUDGE_STEP = 1;
export const NUDGE_STEP_FAST = 10;

/** 修正后的方向键动作（把步长算进位移；`nudge` 条目的兜底由这里接管）。 */
function runArrow(session: CanvasSession, input: KeyInput): void {
  const step = input.shift ? NUDGE_STEP_FAST : NUDGE_STEP;
  switch (input.key) {
    case 'ArrowUp':
      session.nudge(0, -step);
      break;
    case 'ArrowDown':
      session.nudge(0, step);
      break;
    case 'ArrowLeft':
      session.nudge(-step, 0);
      break;
    case 'ArrowRight':
      session.nudge(step, 0);
      break;
    default:
      break;
  }
}

/**
 * 处理键盘按下：返回命中的快捷键 id（未命中 → null）。
 *
 * 抑制规则：文本编辑中只放行 `whileEditing` 条目；
 * 输入框/文本域内的按键不劫持（让 DOM 自己处理）。
 */
export function handleKeyDown(
  session: CanvasSession,
  input: KeyInput,
  context: ShortcutContext,
): string | null {
  const editing = session.store.getState().editing !== null;
  for (const shortcut of SHORTCUTS) {
    if (!shortcut.match(input)) continue;
    if (editing && shortcut.whileEditing !== true) return null;
    shortcut.run(session, context, input);
    return shortcut.id;
  }
  return null;
}

/** 空格键按下（临时手型；文本编辑中不劫持）。 */
export function handleSpaceDown(session: CanvasSession): void {
  if (session.store.getState().editing !== null) return;
  session.setSpacePressed(true);
}

/** 空格键松开。 */
export function handleSpaceUp(session: CanvasSession): void {
  session.setSpacePressed(false);
}

/** 快捷键说明表（两栏：按分组聚合；FE-03 的 E8 与命令面板共用此派生）。 */
export function shortcutTable(): Array<{
  group: ShortcutSpec['group'];
  id: string;
  labelKey: string;
  display: string;
}> {
  return SHORTCUTS.map((shortcut) => ({
    group: shortcut.group,
    id: shortcut.id,
    labelKey: shortcut.labelKey,
    display: shortcut.display,
  }));
}
