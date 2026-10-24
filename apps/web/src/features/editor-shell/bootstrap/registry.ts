/**
 * 编辑器客户端引导·声明式注册表（机制层，工单 02）。
 *
 * 为什么有这一层：编辑器的插槽/命令注册此前散在各域的引导件里（`WorkspaceBootstrap` /
 * `ReviewBootstrap` 两个 `return null` 组件 + 模块顶层注册），注册时机各自为政——
 * 谁先挂载、谁先求值都影响时序（hydration 时序脆弱）。工单 02 把引导收口为**唯一
 * 客户端引导件**（`app/editor/editor-bootstrap.tsx`）：全部插槽挂载以声明表（数据）
 * 集中声明，域级接线（命令注册/会话同步/门禁探针）以登记项声明，由引导在挂载后
 * 按声明顺序统一执行——新增插槽只需注册表一处声明即可挂载。
 *
 * 分层纪律：本模块只提供机制（类型 + 两个执行器），**不 import 任何 feature 域**——
 * 声明（引用哪些域、按什么顺序）住在 `app/editor/editor-bootstrap.tsx`（组合根），
 * 依赖方向保持 `app → features`，不反向。
 *
 * 语义：
 * - 插槽声明经 `registerEditorSlotItem` 挂载，继承插槽注册表的覆盖语义
 *   （同槽同 id 后注册者覆盖，位置停在首次注册处）；
 * - 登记项按声明顺序执行；某项抛错即中断上抛（不吞错——引导失败必须显性暴露）；
 * - 两个执行器都返回清理函数（本批反注册 / 登记项清理按反序执行）——测试与热重载用；
 *   产品路径刻意不消费（模块单例跨路由存活，重挂同 id 覆盖幂等）。
 */
import {
  type EditorSlotItem,
  type EditorSlotName,
  registerEditorSlotItem,
} from '../slots/registry';

/** 插槽挂载声明（数据项：新增插槽 = 引导注册表加一条，由引导统一执行）。 */
export interface EditorSlotDeclaration extends EditorSlotItem {
  /** 目标插槽名。 */
  slot: EditorSlotName;
}

/** 域登记项（非插槽类注册：命令注册、会话接线、门禁探针等）。 */
export interface EditorBootstrapEntry {
  /** 条目 id（建议 `'<ticket>-<domain>'`，与插槽条目 id 约定一致）。 */
  id: string;
  /** 注册实现。返回清理函数时由执行器统一保管（产品路径不消费）。 */
  setup: () => void | (() => void);
}

/**
 * 把一批插槽声明挂进插槽注册表（继承「同槽同 id 覆盖」语义）。
 *
 * @returns 反注册函数：整批撤下本批条目（幂等；条目已被同名 id 覆盖时不误删后者）
 */
export function mountEditorSlotDeclarations(
  declarations: readonly EditorSlotDeclaration[],
): () => void {
  const unmounts = declarations.map((declaration) =>
    registerEditorSlotItem(declaration.slot, declaration),
  );
  return () => {
    for (const unmount of unmounts) unmount();
  };
}

/**
 * 依声明顺序执行域登记项。
 *
 * @returns 清理函数：按登记反序执行各项返回的清理函数（栈式撤销；测试与热重载用）
 */
export function runEditorBootstrapEntries(entries: readonly EditorBootstrapEntry[]): () => void {
  const cleanups: Array<() => void> = [];
  for (const entry of entries) {
    const cleanup = entry.setup();
    if (typeof cleanup === 'function') cleanups.push(cleanup);
  }
  return () => {
    for (let index = cleanups.length - 1; index >= 0; index -= 1) {
      cleanups[index]?.();
    }
  };
}
