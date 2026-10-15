/**
 * 首页 UI 态 store（FE-02）。
 *
 * 状态边界（_shared §3）：这里只放**界面态**——分区（最近/本地文档/回收站）、
 * 视图模式（网格/列表）、时间范围筛选、排序、搜索词、侧栏折叠，以及「删除记录」
 * （回收站分区展示用，本机 localStorage）。**文档真值不进来**：列表来自 daemon，
 * 由视图组件按需拉取（避免把数据面状态复制进全局 store 造成双真源）。
 *
 * 工厂形态（`createHomeStore`）：测试与多窗口场景各自持有实例，互不污染；
 * 页面用模块级单例 `useHomeStore`。
 */
import { create, type StoreApi, type UseBoundStore } from 'zustand';

import {
  appendTrashRecord,
  parseTrashRecords,
  removeTrashRecord,
  serializeTrashRecords,
  TRASH_STORAGE_KEY,
  type TrashRecord,
} from '../lib/trash';
import type { DocumentRange, DocumentSort } from '../lib/filter';

/** 侧栏分区。 */
export type HomeSection = 'recent' | 'local' | 'trash';

/** 视图模式（B4 网格 ↔ 列表）。 */
export type HomeViewMode = 'grid' | 'list';

/** 首页 UI 态形状。 */
export interface HomeState {
  section: HomeSection;
  viewMode: HomeViewMode;
  /** 搜索词（顶栏搜索框）。 */
  query: string;
  /** 时间范围筛选（B4 筛选行）。 */
  range: DocumentRange;
  /** 排序（B4 筛选行）。 */
  sort: DocumentSort;
  /** 侧栏折叠（窄窗让位）。 */
  sidebarCollapsed: boolean;
  /** 删除记录（回收站分区）。 */
  trashRecords: TrashRecord[];
  setSection: (section: HomeSection) => void;
  setViewMode: (viewMode: HomeViewMode) => void;
  setQuery: (query: string) => void;
  setRange: (range: DocumentRange) => void;
  setSort: (sort: DocumentSort) => void;
  toggleSidebar: () => void;
  /** 记一条删除记录（删除成功后调用）。 */
  recordDeletion: (record: TrashRecord) => void;
  /** 彻底删除记录（回收站里的清理动作）。 */
  purgeTrashRecord: (id: string) => void;
}

/** store 用到的存储面（注入替身便于测试；SSR 无 window 时为 null）。 */
export interface HomeStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

/** 构造选项。 */
export interface HomeStoreOptions {
  /** 存储（缺省取全局 localStorage；无 window 时为 null）。 */
  storage?: HomeStorage | null;
}

/** 取缺省存储（浏览器 localStorage；SSR/纯 node 下为 null）。 */
function defaultStorage(): HomeStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    // 隐私模式等场景下访问 localStorage 会抛错：降级为不持久化
    return null;
  }
}

/** 读初始删除记录。 */
function initialTrashRecords(storage: HomeStorage | null): TrashRecord[] {
  return storage === null ? [] : parseTrashRecords(storage.getItem(TRASH_STORAGE_KEY));
}

/** 创建首页 store（工厂：测试与多实例用）。 */
export function createHomeStore(
  options: HomeStoreOptions = {},
): UseBoundStore<StoreApi<HomeState>> {
  const storage = options.storage === undefined ? defaultStorage() : options.storage;

  return create<HomeState>((set, get) => ({
    section: 'recent',
    viewMode: 'grid',
    query: '',
    range: 'all',
    sort: 'updated-desc',
    sidebarCollapsed: false,
    trashRecords: initialTrashRecords(storage),

    setSection: (section) => set({ section }),
    setViewMode: (viewMode) => set({ viewMode }),
    setQuery: (query) => set({ query }),
    setRange: (range) => set({ range }),
    setSort: (sort) => set({ sort }),
    toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),

    recordDeletion: (record) => {
      const next = appendTrashRecord(get().trashRecords, record);
      set({ trashRecords: next });
      storage?.setItem(TRASH_STORAGE_KEY, serializeTrashRecords(next));
    },

    purgeTrashRecord: (id) => {
      const next = removeTrashRecord(get().trashRecords, id);
      set({ trashRecords: next });
      storage?.setItem(TRASH_STORAGE_KEY, serializeTrashRecords(next));
    },
  }));
}

/** 页面单例（首页用）。 */
export const useHomeStore = createHomeStore();
