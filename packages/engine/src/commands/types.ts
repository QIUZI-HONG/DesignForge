/**
 * 命令定义（**写操作的唯一入口**：一切文档变更都必须表达为这里的命令）。
 *
 * 设计：命令是**纯数据**（可序列化、可比较、可由任意 actor 构造）——
 * 用户、AI、导入器、MCP、协作模拟五类 actor 在事务层等价（架构 v1.1 §4.1）。
 * 每条命令的逆命令由处理器在**施加时**依据当前文档计算（`commands/apply.ts`），
 * 因此撤销/重做不需要调用方提供额外的还原信息。
 */

import type {
  NodeId,
  NodePatch,
  PageId,
  PatchableKey,
  SceneNode,
  ScenePage,
  TokenSet,
} from '../model/index';
import type { PagePatch, ZOrderOp } from '../scene/mutate';

/** 插入节点。 */
export interface InsertNodeCommand {
  type: 'node.insert';
  pageId: PageId;
  node: SceneNode;
  /** 父节点；null = 页面顶层。 */
  parentId: NodeId | null;
  /** 插入位置（省略 = 追加到末尾）。显式 `| undefined` 是为适配 exactOptionalPropertyTypes。 */
  index?: number | undefined;
}

/** 删除节点（连同子树）。 */
export interface RemoveNodeCommand {
  type: 'node.remove';
  pageId: PageId;
  nodeId: NodeId;
}

/** 复原被删除的子树（`node.remove` 的逆命令；`nodes` 按「父先于子」排列）。 */
export interface RestoreNodeCommand {
  type: 'node.restore';
  pageId: PageId;
  rootId: NodeId;
  nodes: SceneNode[];
  parentId: NodeId | null;
  index: number;
}

/** 修改节点属性。 */
export interface UpdateNodeCommand {
  type: 'node.update';
  pageId: PageId;
  nodeId: NodeId;
  patch: NodePatch;
}

/** 平移节点（`dx/dy` 位于节点父坐标系）。 */
export interface MoveNodesCommand {
  type: 'node.move';
  pageId: PageId;
  nodeIds: NodeId[];
  dx: number;
  dy: number;
}

/** 改变父级。 */
export interface ReparentNodeCommand {
  type: 'node.reparent';
  pageId: PageId;
  nodeId: NodeId;
  parentId: NodeId | null;
  index?: number | undefined;
}

/** 层级调整（同级内）。 */
export interface ReorderNodeCommand {
  type: 'node.reorder';
  pageId: PageId;
  nodeId: NodeId;
  op: ZOrderOp;
}

/** 设置实例覆盖（路径 = 主组件内节点 id 链路）。 */
export interface SetInstanceOverrideCommand {
  type: 'instance.setOverride';
  pageId: PageId;
  instanceId: NodeId;
  path: NodeId[];
  patch: NodePatch;
}

/** 重置实例覆盖。 */
export interface ResetInstanceOverrideCommand {
  type: 'instance.resetOverride';
  pageId: PageId;
  instanceId: NodeId;
  path: NodeId[];
  /** 省略 = 整段重置。 */
  keys?: PatchableKey[] | undefined;
}

/** 切换实例的变体（改实例指向的主组件）。 */
export interface SwitchVariantCommand {
  type: 'instance.switchVariant';
  pageId: PageId;
  instanceId: NodeId;
  componentId: NodeId;
}

/** 新增页面。 */
export interface AddPageCommand {
  type: 'page.add';
  page: ScenePage;
  index?: number | undefined;
}

/** 删除页面。 */
export interface RemovePageCommand {
  type: 'page.remove';
  pageId: PageId;
}

/** 修改页面设置（背景/网格/名称）。 */
export interface UpdatePageCommand {
  type: 'page.update';
  pageId: PageId;
  patch: PagePatch;
}

/** 重命名文档。 */
export interface RenameDocumentCommand {
  type: 'document.rename';
  name: string;
}

/** 替换文档令牌集。 */
export interface SetDocumentTokensCommand {
  type: 'document.setTokens';
  tokens: TokenSet;
}

/** 命令联合。 */
export type Command =
  | InsertNodeCommand
  | RemoveNodeCommand
  | RestoreNodeCommand
  | UpdateNodeCommand
  | MoveNodesCommand
  | ReparentNodeCommand
  | ReorderNodeCommand
  | SetInstanceOverrideCommand
  | ResetInstanceOverrideCommand
  | SwitchVariantCommand
  | AddPageCommand
  | RemovePageCommand
  | UpdatePageCommand
  | RenameDocumentCommand
  | SetDocumentTokensCommand;

/** 命令类型判别符。 */
export type CommandType = Command['type'];

/** 一次事务 = 一组命令（原子：全成功或整体不生效）。 */
export interface Transaction {
  commands: Command[];
  /** 历史条目显示名（撤销菜单用）。 */
  label?: string;
}

/** 历史条目。 */
export interface HistoryEntry {
  label: string;
  /** 正向命令（redo 用）。 */
  commands: Command[];
  /** 逆命令（undo 用；已按「后进先出」排好序）。 */
  inverse: Command[];
}
