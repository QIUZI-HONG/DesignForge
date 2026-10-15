/**
 * 版本 UI store（C14/F10）——Zustand vanilla。
 *
 * 关键语义（briefs/fe-07.md §2）：**恢复两步确认**——
 * 第一步 `beginCompare(id)` 只进「并排对比」视图，**不碰文档**；
 * 第二步 `confirmRestore()` 才把 `document.replace` 交给命令栈（唯一写入口，可撤销）。
 * 这样「看一眼差异」永远不会误改文档，回滚是显式的第二击。
 */
import type { Command, DesignDocument } from '@dforge/engine';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { KeyValueBackend } from '../storage';
import { createLocalStore, isVersionSnapshot, versionsKey } from '../storage';
import {
  appendSnapshot,
  createSnapshot,
  type DocumentDiff,
  diffDocuments,
  restoreCommands,
  type VersionSnapshot,
} from './snapshots';

/** 版本 UI 态 + 动作。 */
export interface VersionUiState {
  /** 右抽屉开合。 */
  open: boolean;
  /** 快照列表（新→旧）。 */
  snapshots: VersionSnapshot[];
  /** 对比中的快照 id（第一步；null = 不在对比态）。 */
  compareId: string | null;

  setOpen: (open: boolean) => void;
  /** 保存当前文档为新版本快照（手动保存）。 */
  capture: (label?: string) => VersionSnapshot;
  /** 删除一份快照。 */
  remove: (snapshotId: string) => void;
  /** 第一步：进入并排对比（不落回滚）。 */
  beginCompare: (snapshotId: string) => void;
  /** 放弃对比（回到列表）。 */
  cancelCompare: () => void;
  /** 第二步：确认恢复（派发整文档替换命令）；不在对比态时是空操作。 */
  confirmRestore: () => void;
  /** 读取对比数据（快照 vs 当前文档；无对比对象返回 null）。 */
  diffOf: (snapshotId: string) => DocumentDiff | null;
}

/** 版本 store 句柄。 */
export type VersionStore = StoreApi<VersionUiState>;

/** createVersionStore 选项。 */
export interface VersionStoreOptions {
  documentId: string;
  /** 当前文档读法（命令栈快照；保存版本时抓取）。 */
  getDocument: () => DesignDocument;
  /** 命令提交入口（唯一写入口的薄包装；回滚用）。 */
  run: (commands: readonly Command[], label: string) => void;
  backend?: KeyValueBackend | undefined;
  now?: () => Date;
  nextId?: () => string;
  onWriteError?: (error: unknown) => void;
}

/** 建版本 store。 */
export function createVersionStore(options: VersionStoreOptions): VersionStore {
  const now = options.now ?? (() => new Date());
  const nextId = options.nextId ?? defaultSnapshotId();
  const storageOptions: Parameters<typeof createLocalStore<VersionSnapshot>>[0] = {
    key: versionsKey(options.documentId),
    validate: isVersionSnapshot,
  };
  if (options.backend !== undefined) storageOptions.backend = options.backend;
  if (options.onWriteError !== undefined) storageOptions.onWriteError = options.onWriteError;
  const storage = createLocalStore<VersionSnapshot>(storageOptions);

  return createStore<VersionUiState>((set, get) => ({
    open: false,
    snapshots: storage.load(),
    compareId: null,

    setOpen: (open) => {
      if (get().open === open) return;
      // 关闭抽屉同时退出对比态：下次打开回到列表（避免「上次停在确认页」的迟钝感）
      set(open ? { open: true } : { open: false, compareId: null });
    },

    capture: (label) => {
      const snapshot = createSnapshot({
        id: nextId(),
        createdAt: now().toISOString(),
        document: options.getDocument(),
        documentId: options.documentId,
        ...(label === undefined ? {} : { label }),
      });
      const snapshots = appendSnapshot(get().snapshots, snapshot);
      storage.save(snapshots);
      set({ snapshots });
      return snapshot;
    },

    remove: (snapshotId) => {
      const snapshots = get().snapshots.filter((item) => item.id !== snapshotId);
      if (snapshots.length === get().snapshots.length) return;
      storage.save(snapshots);
      set({
        snapshots,
        compareId: get().compareId === snapshotId ? null : get().compareId,
      });
    },

    beginCompare: (snapshotId) => {
      if (!get().snapshots.some((item) => item.id === snapshotId)) return;
      set({ compareId: snapshotId });
    },

    cancelCompare: () => {
      if (get().compareId === null) return;
      set({ compareId: null });
    },

    confirmRestore: () => {
      const compareId = get().compareId;
      if (compareId === null) return;
      const snapshot = get().snapshots.find((item) => item.id === compareId);
      if (snapshot === undefined) {
        set({ compareId: null });
        return;
      }
      // 回滚前先给当前状态留一份自动快照：误回滚还能再回来（本地优先的兜底体验）
      const auto = createSnapshot({
        id: nextId(),
        label: '回滚前自动保存',
        createdAt: now().toISOString(),
        document: options.getDocument(),
        documentId: options.documentId,
      });
      const snapshots = appendSnapshot(get().snapshots, auto);
      storage.save(snapshots);
      set({ snapshots, compareId: null });
      options.run(restoreCommands(snapshot), '恢复版本');
    },

    diffOf: (snapshotId) => {
      const snapshot = get().snapshots.find((item) => item.id === snapshotId);
      if (snapshot === undefined) return null;
      return diffDocuments(snapshot.document, options.getDocument());
    },
  }));
}

/** 默认快照 id 工厂。 */
function defaultSnapshotId(): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `ver_${Math.random().toString(36).slice(2, 8)}_${String(counter)}`;
  };
}
