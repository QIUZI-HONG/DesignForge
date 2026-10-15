/**
 * 命令层公开面：命令定义、处理器、命令栈（唯一写入口）与意图级 helpers。
 */

export type { ApplyResult } from './apply';
export { applyCommand, assertVirtualPath } from './apply';
export {
  deleteNodesCommands,
  dissolveGroupCommands,
  frameTransformPatch,
  groupNodesCommands,
  insertNodeCommands,
  moveNodesByWorldCommands,
  parentIdOf,
  patchNodeCommands,
  reorderNodeCommands,
  reparentPreservingWorldCommands,
  setNodePropsCommands,
  siblingIndexOf,
  worldCenterOf,
} from './helpers';

export type { CommandStackOptions, DispatchOptions, HistorySnapshot } from './stack';
export { asDomainError, CommandError, CommandStack, isCommandError } from './stack';
export type {
  AddPageCommand,
  Command,
  CommandType,
  HistoryEntry,
  InsertNodeCommand,
  MoveNodesCommand,
  RemoveNodeCommand,
  RemovePageCommand,
  RenameDocumentCommand,
  ReorderNodeCommand,
  ReparentNodeCommand,
  ResetInstanceOverrideCommand,
  RestoreNodeCommand,
  SetDocumentTokensCommand,
  SetInstanceOverrideCommand,
  SwitchVariantCommand,
  Transaction,
  UpdateNodeCommand,
  UpdatePageCommand,
} from './types';
