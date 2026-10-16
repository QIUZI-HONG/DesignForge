/**
 * 右键菜单的可用性 + 命令（纯函数，seam：菜单条目与其命令）。
 *
 * 与 Figma 的口径一致：右键**未选中**的行会先把它选上，菜单动作作用在（可能是多选的）选择集上；
 * 「编组」要求 ≥2 个**同级真实节点**，「解组」只对真实编组节点可用，
 * 已在端位的「上移到顶 / 下移到底」置灰（命令构造器返回空列表即禁用，UI 与命令同源）。
 */
import {
  type Command,
  deleteNodesCommands,
  type NodeId,
  type PageId,
  parentIdOf,
  parseVirtualNodeId,
  type ScenePage,
  type Selection,
} from '@dforge/engine';

import {
  bringToFrontCommands,
  groupLayersCommands,
  sendToBackCommands,
  ungroupLayerCommands,
} from './layer-commands';

/** 菜单动作 id（也是 i18n 键片段与菜单条目的稳定标识）。 */
export type LayerMenuActionId =
  | 'rename'
  | 'delete'
  | 'group'
  | 'ungroup'
  | 'bringToFront'
  | 'sendToBack';

/** 菜单条目：可用性 + 命令 + 历史条目键。 */
export interface LayerMenuEntry {
  id: LayerMenuActionId;
  disabled: boolean;
  /** 禁用原因（i18n 键；仅「编组」会给）。 */
  disabledReasonKey?: string;
  /** 菜单条目文案的 i18n 键。 */
  labelKey: string;
  /** 快捷键展示（键盘接线归 FE-03/FE-06，此处只做展示）。 */
  shortcut?: string;
  /** 危险语义（删除）。 */
  danger?: boolean;
  /** 施加的命令；空数组 = 只做 UI 手势（重命名）或不可用。 */
  commands: Command[];
  /** 撤销菜单里的历史条目键。 */
  historyKey: string;
}

/**
 * 构造右键菜单条目。
 *
 * @param page 当前页面快照
 * @param pageId 页面 id
 * @param rowId 被右键的行
 * @param selection 当前选择集（调用方在右键时已把该行并入）
 */
export function layerContextMenu(
  page: ScenePage,
  pageId: PageId,
  rowId: NodeId,
  selection: Selection,
): LayerMenuEntry[] {
  const realSelection = selection.ids.filter(
    (id) => parseVirtualNodeId(id) === null && page.nodes[id] !== undefined,
  );
  const groupCandidates = realSelection.length >= 2 ? realSelection : [];
  const sameParent =
    groupCandidates.length > 0 &&
    new Set(groupCandidates.map((id) => parentIdOf(page, id))).size === 1;
  const groupCommands =
    groupCandidates.length > 0 && sameParent
      ? groupLayersCommands(page, pageId, groupCandidates)
      : [];

  const deleteTargets =
    selection.ids.includes(rowId) && realSelection.length >= 1 ? realSelection : [rowId];
  const deletable = deleteTargets.filter(
    (id) => parseVirtualNodeId(id) === null && page.nodes[id] !== undefined,
  );
  const readOnlyRow = parseVirtualNodeId(rowId) !== null;

  const frontCommands = bringToFrontCommands(page, pageId, rowId);
  const backCommands = sendToBackCommands(page, pageId, rowId);
  const ungroupCommands = ungroupLayerCommands(page, pageId, rowId);

  return [
    {
      id: 'rename',
      labelKey: 'panels.menu.rename',
      shortcut: '⌘R',
      disabled: readOnlyRow,
      commands: [],
      historyKey: 'panels.history.rename',
    },
    {
      id: 'delete',
      labelKey: 'panels.menu.delete',
      shortcut: '⌫',
      danger: true,
      disabled: deletable.length === 0,
      commands: deletable.length === 0 ? [] : deleteNodesCommands(page, pageId, deletable),
      historyKey: 'panels.history.delete',
    },
    {
      id: 'group',
      labelKey: 'panels.menu.group',
      shortcut: '⌘G',
      disabled: groupCommands.length === 0,
      ...(groupCommands.length === 0 ? { disabledReasonKey: 'panels.menu.groupDisabled' } : {}),
      commands: groupCommands,
      historyKey: 'panels.history.group',
    },
    {
      id: 'ungroup',
      labelKey: 'panels.menu.ungroup',
      shortcut: '⇧⌘G',
      disabled: ungroupCommands.length === 0,
      commands: ungroupCommands,
      historyKey: 'panels.history.ungroup',
    },
    {
      id: 'bringToFront',
      labelKey: 'panels.menu.bringToFront',
      shortcut: '⇧⌘]',
      disabled: frontCommands.length === 0,
      commands: frontCommands,
      historyKey: 'panels.history.reorder',
    },
    {
      id: 'sendToBack',
      labelKey: 'panels.menu.sendToBack',
      shortcut: '⇧⌘[',
      disabled: backCommands.length === 0,
      commands: backCommands,
      historyKey: 'panels.history.reorder',
    },
  ];
}
