/**
 * 画布动作清单（C9 浮层工具条与 C11 右键菜单的**同一份真源**）。
 *
 * 为什么集中：工具条与右键菜单是同一批操作的两种排布，各自硬编码会出现
 * 「菜单里能编组、工具条里禁用态不一致」这类漂移；这里按**可用性谓词 + 执行体**定义一次，
 * 两个 UI 各自挑选子集与排布。快捷键展示串从 `input/keyboard` 的分布表取，
 * 因此菜单右侧的快捷键永远与实际键位一致。
 */

import type { NodeId } from '@dforge/engine';
import { resolveNode, selectionNodes } from '@dforge/engine';
import type { MenuItemSpec, MenuSectionSpec } from '@dforge/ui';

import { SHORTCUTS } from '../input/keyboard';
import type { AlignOpName, CanvasSession } from '../state/session';

/** 文案函数（注入 i18n，测试用假函数）。 */
export type Translate = (key: string, values?: Record<string, string | number>) => string;

/** 快捷键 id → 展示串。 */
export function shortcutDisplay(id: string): string | undefined {
  return SHORTCUTS.find((shortcut) => shortcut.id === id)?.display;
}

/** 画布动作（可用性 + 执行体）。 */
export interface CanvasAction {
  /** 与快捷键表对齐的稳定 id。 */
  id: string;
  /** 文案键（i18n）。 */
  labelKey: string;
  /** 展示用快捷键。 */
  display?: string;
  /** 快捷键 id（取展示串用；默认同 id）。 */
  shortcutId?: string;
  disabled: boolean;
  /** 危险语义（删除类）。 */
  danger?: boolean;
  run: () => void;
}

/** 选择集几何与语义速览（可用性判定的唯一依据）。 */
export interface SelectionInsight {
  count: number;
  /** 含编组节点。 */
  hasGroup: boolean;
  /** 单一文本节点（可进入编辑）。 */
  textNodeId: NodeId | null;
}

/** 取选择集语义。 */
export function selectionInsight(session: CanvasSession): SelectionInsight {
  const nodes = selectionNodes(session.page(), session.selection());
  const single = session.singleSelectionId();
  const singleNode = single === null ? undefined : resolveNode(session.page(), single);
  return {
    count: nodes.length,
    hasGroup: nodes.some((node) => node.type === 'group'),
    textNodeId:
      singleNode !== undefined && singleNode.type === 'text' ? (singleNode.id as NodeId) : null,
  };
}

/** 全部动作（顺序即工具条顺序；菜单按分组挑子集）。 */
export function canvasActions(session: CanvasSession, t: Translate): CanvasAction[] {
  const insight = selectionInsight(session);
  const state = session.store.getState();
  const multiple = insight.count >= 2;

  const align = (op: AlignOpName, id: string, labelKey: string): CanvasAction => ({
    id,
    labelKey,
    disabled: !multiple,
    run: () => {
      session.align(op);
    },
  });

  const actions: CanvasAction[] = [
    {
      id: 'editText',
      labelKey: 'canvas.action.editText',
      disabled: insight.textNodeId === null,
      run: () => {
        if (insight.textNodeId !== null)
          session.beginTextEditing(insight.textNodeId, { selectAll: true });
      },
    },
    {
      id: 'group',
      labelKey: 'canvas.action.group',
      disabled: !multiple,
      run: () => {
        session.group();
      },
    },
    {
      id: 'ungroup',
      labelKey: 'canvas.action.ungroup',
      disabled: !insight.hasGroup,
      run: () => {
        session.ungroup();
      },
    },
    {
      id: 'bringForward',
      labelKey: 'canvas.action.bringForward',
      disabled: insight.count === 0,
      run: () => {
        session.reorder('forward');
      },
    },
    {
      id: 'sendBackward',
      labelKey: 'canvas.action.sendBackward',
      disabled: insight.count === 0,
      run: () => {
        session.reorder('backward');
      },
    },
    {
      id: 'bringToFront',
      labelKey: 'canvas.action.bringToFront',
      disabled: insight.count === 0,
      run: () => {
        session.reorder('front');
      },
    },
    {
      id: 'sendToBack',
      labelKey: 'canvas.action.sendToBack',
      disabled: insight.count === 0,
      run: () => {
        session.reorder('back');
      },
    },
    align('left', 'alignLeft', 'canvas.action.alignLeft'),
    align('hcenter', 'alignHCenter', 'canvas.action.alignHCenter'),
    align('right', 'alignRight', 'canvas.action.alignRight'),
    align('top', 'alignTop', 'canvas.action.alignTop'),
    align('vcenter', 'alignVCenter', 'canvas.action.alignVCenter'),
    align('bottom', 'alignBottom', 'canvas.action.alignBottom'),
    {
      id: 'distributeHorizontal',
      labelKey: 'canvas.action.distributeHorizontal',
      disabled: insight.count < 3,
      run: () => {
        session.distribute('horizontal');
      },
    },
    {
      id: 'distributeVertical',
      labelKey: 'canvas.action.distributeVertical',
      disabled: insight.count < 3,
      run: () => {
        session.distribute('vertical');
      },
    },
    {
      id: 'copy',
      labelKey: 'canvas.action.copy',
      disabled: insight.count === 0,
      run: () => {
        session.copy();
      },
    },
    {
      id: 'paste',
      labelKey: 'canvas.action.paste',
      disabled: false,
      run: () => {
        void session.paste();
      },
    },
    {
      id: 'duplicate',
      labelKey: 'canvas.action.duplicate',
      disabled: insight.count === 0,
      run: () => {
        session.duplicate();
      },
    },
    {
      id: 'delete',
      labelKey: 'canvas.action.delete',
      disabled: insight.count === 0,
      danger: true,
      run: () => {
        session.deleteSelection();
      },
    },
    {
      id: 'toggleRulers',
      labelKey: 'canvas.action.toggleRulers',
      disabled: false,
      run: () => {
        session.setRulers(!state.rulers);
      },
    },
    {
      id: 'zoomFit',
      labelKey: 'canvas.action.zoomFit',
      disabled: false,
      run: () => {
        session.zoomToFit();
      },
    },
    {
      id: 'zoomReset',
      labelKey: 'canvas.action.zoomReset',
      disabled: false,
      run: () => {
        session.zoom100();
      },
    },
  ];

  return actions.map((action) => {
    const display = shortcutDisplay(action.shortcutId ?? action.id);
    return display === undefined ? action : { ...action, display };
  });
}

/** 工具条挑的子集（C9：对齐/分布/编辑/复制等）。 */
export const TOOLBAR_ACTION_IDS: readonly string[] = [
  'alignLeft',
  'alignHCenter',
  'alignRight',
  'alignTop',
  'alignVCenter',
  'alignBottom',
  'distributeHorizontal',
  'distributeVertical',
  'bringForward',
  'sendBackward',
  'group',
  'ungroup',
  'editText',
  'copy',
  'duplicate',
  'delete',
];

/** 右键菜单分组（C11：条目 32 高 + 快捷键右对齐）。 */
export const CONTEXT_MENU_GROUPS: ReadonlyArray<{
  id: string;
  labelKey: string;
  ids: readonly string[];
}> = [
  { id: 'edit', labelKey: 'canvas.menu.section.edit', ids: ['editText', 'group', 'ungroup'] },
  {
    id: 'clipboard',
    labelKey: 'canvas.menu.section.clipboard',
    ids: ['copy', 'paste', 'duplicate', 'delete'],
  },
  {
    id: 'arrange',
    labelKey: 'canvas.menu.section.arrange',
    ids: ['bringToFront', 'bringForward', 'sendBackward', 'sendToBack'],
  },
  {
    id: 'align',
    labelKey: 'canvas.menu.section.align',
    ids: [
      'alignLeft',
      'alignHCenter',
      'alignRight',
      'alignTop',
      'alignVCenter',
      'alignBottom',
      'distributeHorizontal',
      'distributeVertical',
    ],
  },
  {
    id: 'view',
    labelKey: 'canvas.menu.section.view',
    ids: ['toggleRulers', 'zoomFit', 'zoomReset'],
  },
];

/** 由动作构造 @dforge/ui 的菜单条目（快捷键右对齐）。 */
export function toMenuItem(action: CanvasAction, t: Translate): MenuItemSpec {
  const item: MenuItemSpec = {
    id: action.id,
    label: t(action.labelKey),
    disabled: action.disabled,
    onSelect: action.run,
  };
  if (action.display !== undefined) item.shortcut = action.display;
  if (action.danger === true) item.danger = true;
  return item;
}

/** 右键菜单分组（空组自动省略：例如单选时「取消编组」之外的对齐组仍保留但条目全禁用）。 */
export function contextMenuSections(session: CanvasSession, t: Translate): MenuSectionSpec[] {
  const actions = new Map(canvasActions(session, t).map((action) => [action.id, action]));
  const sections: MenuSectionSpec[] = [];
  for (const group of CONTEXT_MENU_GROUPS) {
    const items: MenuItemSpec[] = [];
    for (const id of group.ids) {
      const action = actions.get(id);
      if (action === undefined) continue;
      items.push(toMenuItem(action, t));
    }
    if (items.length === 0) continue;
    sections.push({ id: group.id, label: t(group.labelKey), items });
  }
  return sections;
}
