/**
 * 编辑器插槽注册表（**FE-03 提供，供 FE-04/05/06/07 挂载**）。
 *
 * 为什么要插槽：`app/editor/**` 归 FE-03，图层面板（FE-04）、Inspector（FE-05）、
 * 画布（FE-06）、评论/Present 入口（FE-07）各占自己的 `features/<id>/**` 目录——
 * 它们**不得改 `app/editor`**，因此壳层留出具名插槽，各票在自己的目录里
 * `registerEditorSlotItem('<槽名>', …)` 挂载（或在自身模块顶层注册）。
 *
 * 挂载点：`app/editor/page.tsx` 组合 `<EditorShell>` 时已为每个槽留了宿主
 * （`<EditorSlotHost slot="…" />`）；插槽条目统一声明在 `app/editor/editor-bootstrap.tsx`
 * 的 `EDITOR_SLOT_DECLARATIONS`（工单 02 起的声明式注册表），由唯一客户端引导件在
 * 挂载后经 `mountEditorSlotDeclarations` 批量注册——新增插槽 = 声明表加一条（纯增量）。
 *
 * 语义（与命令注册表一致，便于同一套心智）：
 * - 同槽同 id **后注册者覆盖前者，位置停在首次注册处**（热重载友好）；
 * - `listEditorSlotItems(slot)` 按 `order` 升序（同 order 保持注册顺序）返回快照副本；
 * - `getEditorSlotSnapshot(slot)` 引用稳定（`useSyncExternalStore` 专用）。
 */
import type { ReactNode } from 'react';

/** 编辑器壳层具名插槽（挂载点稳定，改动即跨票破坏性变更）。 */
export type EditorSlotName =
  /** 顶栏左区（工具以外的主菜单侧；追加项排在主菜单与撤销/重做之后）。 */
  | 'topbar-left'
  /** 顶栏中区（文件名与版本入口之后）。 */
  | 'topbar-center'
  /** 顶栏右区（分享/Present/评论入口之前）。 */
  | 'topbar-right'
  /** 工具栏（内置工具组之后的追加段，自带分隔线）。 */
  | 'toolbar'
  /** 左面板列（FE-04：图层面板 + 资产面板）。 */
  | 'left-panel'
  /** 画布列（FE-06：画布本体 + 覆盖层；空槽时壳层渲染空态）。 */
  | 'canvas'
  /** 右面板列（FE-05 Inspector；FE-07 版本抽屉可挂于此）。 */
  | 'right-panel'
  /** 全屏浮层列（FE-07 Present 预览这类盖住整壳的层）。 */
  | 'overlays';

/** 插槽条目。 */
export interface EditorSlotItem {
  /** 槽内唯一 id（同槽同 id 覆盖；建议 `'<ticket>-<feature>'` 命名）。 */
  id: string;
  /** 排序权重（小在前；同值按注册顺序）。缺省 0。 */
  order?: number;
  /** 渲染函数（每次渲染时调用；返回的节点由宿主放入该槽）。 */
  render: () => ReactNode;
}

/** 稳定的空快照（未注册过的槽共用同一个引用）。 */
const EMPTY: EditorSlotItem[] = [];

/** 槽位 → 条目表（插入序 = 首次注册序）。 */
const slots = new Map<EditorSlotName, Map<string, EditorSlotItem>>();
/** 槽位 → 稳定引用的排序快照。 */
const snapshots = new Map<EditorSlotName, EditorSlotItem[]>();
const listeners = new Set<() => void>();

/** 刷新某槽的快照并广播。 */
function refresh(slot: EditorSlotName): void {
  const entries = [...(slots.get(slot)?.values() ?? [])];
  // 先落 index 再排序：同 order 时保持注册顺序（Array.prototype.sort 自 ES2019 起稳定，这里显式带序号更抗改）
  snapshots.set(
    slot,
    entries
      .map((item, index) => ({ item, index }))
      .sort((a, b) => (a.item.order ?? 0) - (b.item.order ?? 0) || a.index - b.index)
      .map((entry) => entry.item),
  );
  for (const listener of [...listeners]) listener();
}

/**
 * 注册插槽条目。
 *
 * @returns 反注册函数（幂等；仅当该槽当前条目仍是本次注册的那条时才移除）
 */
export function registerEditorSlotItem(slot: EditorSlotName, item: EditorSlotItem): () => void {
  const bucket = slots.get(slot) ?? new Map<string, EditorSlotItem>();
  slots.set(slot, bucket);
  bucket.set(item.id, item);
  refresh(slot);
  return () => {
    if (bucket.get(item.id) === item) {
      bucket.delete(item.id);
      refresh(slot);
    }
  };
}

/** 取某槽条目（快照副本，按 order 升序）。 */
export function listEditorSlotItems(slot: EditorSlotName): EditorSlotItem[] {
  return [...(snapshots.get(slot) ?? [])];
}

/** 取某槽的稳定引用快照（`useSyncExternalStore` 用）。 */
export function getEditorSlotSnapshot(slot: EditorSlotName): EditorSlotItem[] {
  return snapshots.get(slot) ?? EMPTY;
}

/** 订阅任意槽变化。 */
export function subscribeEditorSlots(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 清空全部槽（**测试隔离与热重载清理**用；产品路径不调用）。 */
export function resetEditorSlots(): void {
  slots.clear();
  snapshots.clear();
  for (const listener of [...listeners]) listener();
}
