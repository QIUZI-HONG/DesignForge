/**
 * 图层面板 / 资产面板的 **UI 态** store（Zustand vanilla）。
 *
 * 边界（briefs/_shared.md §3 + 前端实现规格 v1 §一.8）：文档真值与命令栈归 `@dforge/engine`，
 * **不进 React state**；本 store 只放 UI 态——选择集（引擎 `Selection` 数据形状）、
 * 展开/收起、正在重命名的图层、资产分段与搜索词。
 *
 * 为什么选择集在这里：画布（FE-06）与面板必须读**同一来源**才能同源联动；ENG-01 的选择模型
 * 是纯数据结构 + 纯函数（`@dforge/engine` 的 `selection/`），本 store 持有其状态、调用其纯函数。
 * 只用 vanilla store（不经 React context 包裹），方便测试与非 React 消费方（画布渲染循环）读取。
 */
import {
  clickSelection,
  type NodeId,
  type Selection,
  selectOnly,
  setSelection,
} from '@dforge/engine';
import { createStore, type StoreApi } from 'zustand/vanilla';

/** 资产面板分段（C4：组件 / Token）。 */
export type AssetSegment = 'components' | 'tokens';

/** 左栏页签（Figma 左面板 = 文件（图层）/ 资产两个页签）。 */
export type LeftPanelTab = 'layers' | 'assets';

/** 点击图层的修饰键（对应引擎 `clickSelection` 的语义）。 */
export interface LayerClickModifiers {
  shift?: boolean;
  meta?: boolean;
}

/** 面板 UI 态 + 动作。 */
export interface PanelsUiState {
  /** 选择集（引擎选择模型的数据形状；画布与面板同源）。 */
  selection: Selection;
  /** **收起的**容器 id（默认全展开：新建文档的图层树默认铺开，与 Figma 一致）。 */
  collapsedIds: ReadonlySet<NodeId>;
  /** 正在内联重命名的图层（null = 无）。 */
  renamingId: NodeId | null;
  /** 资产面板当前分段。 */
  assetSegment: AssetSegment;
  /** 资产面板搜索词（空 = 不过滤）。 */
  assetQuery: string;
  /** 左栏页签：图层 ↔ 资产（等同 Figma 左面板的「文件 / 资产」）。 */
  leftTab: LeftPanelTab;

  /** 整体替换选择集（画布框选 / 引擎回传用）。 */
  setSelection: (selection: Selection) => void;
  /** 点击图层行（含修饰键），走引擎 `clickSelection` 的语义。 */
  selectLayer: (id: NodeId | null, modifiers?: LayerClickModifiers) => void;
  /** 展开 ↔ 收起容器。 */
  toggleCollapsed: (id: NodeId) => void;
  /** 进入内联重命名。 */
  beginRename: (id: NodeId) => void;
  /** 退出内联重命名（提交与否由命令层决定，这里只收 UI 态）。 */
  endRename: () => void;
  /** 切换资产分段。 */
  setAssetSegment: (segment: AssetSegment) => void;
  /** 设置资产搜索词。 */
  setAssetQuery: (query: string) => void;
  /** 切换左栏页签。 */
  setLeftTab: (tab: LeftPanelTab) => void;
}

/** 面板 UI store 句柄（vanilla：`getState` / `subscribe` / React 侧配 `useStore`）。 */
export type PanelsUiStore = StoreApi<PanelsUiState>;

/** 空选择（与引擎 `EMPTY_SELECTION` 同形状；此处复制一份避免每渲染新建对象）。 */
const NO_SELECTION: Selection = { ids: [], activeId: null };

/**
 * 创建面板 UI store。
 *
 * @param initial 可注入初始态（测试/恢复会话用；省略即全默认）。
 */
export function createPanelsUiStore(
  initial: { selection?: Selection; assetSegment?: AssetSegment; assetQuery?: string } = {},
): PanelsUiStore {
  return createStore<PanelsUiState>((set, get) => ({
    selection: initial.selection ?? NO_SELECTION,
    collapsedIds: new Set<NodeId>(),
    renamingId: null,
    assetSegment: initial.assetSegment ?? 'components',
    assetQuery: initial.assetQuery ?? '',
    leftTab: 'layers',

    setSelection: (selection) => {
      if (sameSelection(get().selection, selection)) return;
      set({ selection });
    },

    selectLayer: (id, modifiers = {}) => {
      const next = clickSelection(get().selection, id, modifiers);
      if (sameSelection(get().selection, next)) return;
      set({ selection: next });
    },

    toggleCollapsed: (id) => {
      const next = new Set(get().collapsedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      set({ collapsedIds: next });
    },

    beginRename: (id) => {
      if (get().renamingId === id) return;
      set({ renamingId: id });
    },

    endRename: () => {
      if (get().renamingId === null) return;
      set({ renamingId: null });
    },

    setAssetSegment: (segment) => {
      if (get().assetSegment === segment) return;
      set({ assetSegment: segment });
    },

    setAssetQuery: (query) => {
      if (get().assetQuery === query) return;
      set({ assetQuery: query });
    },

    setLeftTab: (tab) => {
      if (get().leftTab === tab) return;
      set({ leftTab: tab });
    },
  }));
}

/** 选择集是否等价（同序同元素同主选中）——用于跳过无意义的状态写入。 */
function sameSelection(a: Selection, b: Selection): boolean {
  return (
    a.activeId === b.activeId &&
    a.ids.length === b.ids.length &&
    a.ids.every((id, index) => id === b.ids[index])
  );
}

/** 行是否选中（面板渲染的派生读法；只读不写）。 */
export function isRowSelected(selection: Selection, id: NodeId): boolean {
  return selection.ids.includes(id);
}

/** 选中的单节点 id（Inspector 之外的面板逻辑用；多选用 activeId）。 */
export function singleSelectedId(selection: Selection): NodeId | null {
  return selection.ids.length === 1 ? (selection.ids[0] as NodeId) : null;
}

/** 便捷：按 id 单选（面板外部如资产卡片点击用）。 */
export function selectionOf(id: NodeId | null): Selection {
  return id === null ? NO_SELECTION : selectOnly(id);
}

/** 便捷：按 id 列表替换选择（对齐/编组等批量操作用）。 */
export function selectionOfMany(ids: readonly NodeId[]): Selection {
  return setSelection(NO_SELECTION, ids);
}
