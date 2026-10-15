/**
 * 评论 UI store（C12/F7）——Zustand vanilla，只放 **UI 态 + 评论数据**。
 *
 * 边界（briefs/_shared.md §3）：文档真值与命令栈归 `@dforge/engine`；评论**不属于 Design IR**
 * （文档 JSON 里没有评论），因此不进命令栈、不进版本快照，单独持久化到本地键空间
 * `dfg:comments:<documentId>`（兜底口径见 `storage.ts` 模块头）。
 *
 * 状态机不在这里复制一份：新建/回复/解决/重开一律委托 `threads.ts` 的纯函数，
 * 本 store 负责「读状态 → 调纯函数 → 写回 + 持久化」。
 */
import type { PageId } from '@dforge/engine';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { KeyValueBackend } from '../storage';
import { commentsKey, createLocalStore, isCommentThread } from '../storage';
import type { WorldAnchor } from './coords';
import {
  type CommentThread,
  createThread,
  groupThreads,
  isEditable,
  reopenThread,
  replaceThread,
  replyToThread,
  resolveThread,
  type ThreadGroups,
} from './threads';

/** 写操作结果：失败带原因（UI 侧原样展示，不吞错）。 */
export type CommentActionResult = { ok: true } | { ok: false; error: string };

/** 评论 UI 态 + 动作。 */
export interface CommentsUiState {
  /** 评论模式开关（工具栏/顶栏 toggle 读写它）。 */
  mode: boolean;
  /** 当前文档的全部线程（跨页；画布与面板同源读这里）。 */
  threads: CommentThread[];
  /** 悬停中的钉点（钉点悬停展开预览卡）。 */
  hoveredThreadId: string | null;
  /** 线程面板中展开的线程。 */
  activeThreadId: string | null;
  /** 新建评论的落点（世界坐标；null = 未在起草）。 */
  draftAnchor: WorldAnchor | null;
  /** 线程面板「已解决」段是否展开（默认折叠）。 */
  resolvedExpanded: boolean;

  setMode: (on: boolean) => void;
  toggleMode: () => void;
  setHovered: (threadId: string | null) => void;
  setActive: (threadId: string | null) => void;
  /** 在画布某世界坐标落点，进入起草。 */
  beginDraft: (anchor: WorldAnchor) => void;
  /** 放弃起草（不落线程）。 */
  cancelDraft: () => void;
  /** 提交起草：空正文被拒（`ok: false`）。 */
  submitDraft: (body: string) => CommentActionResult;
  /** 回复线程：已解决被拒（`ok: false`，原因给 UI 提示）。 */
  reply: (threadId: string, body: string) => CommentActionResult;
  resolve: (threadId: string) => void;
  /** 重新打开已解决线程（恢复可编辑）。 */
  reopen: (threadId: string) => void;
  setResolvedExpanded: (expanded: boolean) => void;
}

/** 评论 store 句柄。 */
export type CommentsStore = StoreApi<CommentsUiState>;

/** createCommentsStore 选项。 */
export interface CommentsStoreOptions {
  /** 归属文档（持久化键空间按文档隔离）。 */
  documentId: string;
  /** 当前页面 id（新评论落在当前页）。 */
  pageId: PageId;
  /** 当前用户显示名（评论署名）。 */
  author: string;
  /** 本地后端；省略用 localStorage（测试注入内存后端）。 */
  backend?: KeyValueBackend | undefined;
  /** 时间源（测试固定时间戳）。 */
  now?: () => Date;
  /** id 生成（测试确定性）。 */
  nextId?: () => string;
  /** 写入失败回调（配额满等）。 */
  onWriteError?: (error: unknown) => void;
}

/** 建评论 store。 */
export function createCommentsStore(options: CommentsStoreOptions): CommentsStore {
  const now = options.now ?? (() => new Date());
  const nextId = options.nextId ?? defaultIdFactory();
  const storageOptions: Parameters<typeof createLocalStore<CommentThread>>[0] = {
    key: commentsKey(options.documentId),
    validate: isCommentThread,
  };
  if (options.backend !== undefined) storageOptions.backend = options.backend;
  if (options.onWriteError !== undefined) storageOptions.onWriteError = options.onWriteError;
  const storage = createLocalStore<CommentThread>(storageOptions);
  const initialThreads = storage.load();

  /** 写回 + 持久化（唯一出口：任何线程变更都经这里落盘）。 */
  const commit = (
    set: (partial: Partial<CommentsUiState>) => void,
    threads: CommentThread[],
  ): void => {
    storage.save(threads);
    set({ threads });
  };

  return createStore<CommentsUiState>((set, get) => ({
    mode: false,
    threads: initialThreads,
    hoveredThreadId: null,
    activeThreadId: null,
    draftAnchor: null,
    resolvedExpanded: false,

    setMode: (on) => {
      if (get().mode === on) return;
      // 退出评论模式时收起悬停/草稿（面板按模式的可见性由模式决定）
      set(on ? { mode: true } : { mode: false, hoveredThreadId: null, draftAnchor: null });
    },

    toggleMode: () => {
      get().setMode(!get().mode);
    },

    setHovered: (threadId) => {
      if (get().hoveredThreadId === threadId) return;
      set({ hoveredThreadId: threadId });
    },

    setActive: (threadId) => {
      if (get().activeThreadId === threadId) return;
      set({ activeThreadId: threadId });
    },

    beginDraft: (anchor) => set({ draftAnchor: { ...anchor } }),

    cancelDraft: () => {
      if (get().draftAnchor === null) return;
      set({ draftAnchor: null });
    },

    submitDraft: (body) => {
      const anchor = get().draftAnchor;
      if (anchor === null) return { ok: false, error: '没有落点，请先在画布上点击' };
      let created: CommentThread;
      try {
        created = createThread({
          id: nextId(),
          pageId: options.pageId,
          anchor,
          author: options.author,
          body,
          createdAt: now().toISOString(),
        });
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      commit(set, [...get().threads, created]);
      set({ draftAnchor: null, activeThreadId: created.id });
      return { ok: true };
    },

    reply: (threadId, body) => {
      const thread = get().threads.find((item) => item.id === threadId);
      if (thread === undefined) return { ok: false, error: '线程不存在' };
      let next: CommentThread;
      try {
        next = replyToThread(thread, {
          id: nextId(),
          author: options.author,
          body,
          createdAt: now().toISOString(),
        });
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      commit(set, replaceThread(get().threads, next));
      return { ok: true };
    },

    resolve: (threadId) => {
      const thread = get().threads.find((item) => item.id === threadId);
      if (thread === undefined || !isEditable(thread)) return;
      commit(set, replaceThread(get().threads, resolveThread(thread)));
    },

    reopen: (threadId) => {
      const thread = get().threads.find((item) => item.id === threadId);
      if (thread === undefined) return;
      commit(set, replaceThread(get().threads, reopenThread(thread)));
    },

    setResolvedExpanded: (expanded) => {
      if (get().resolvedExpanded === expanded) return;
      set({ resolvedExpanded: expanded });
    },
  }));
}

/** 派生读法：分组后的线程列表（面板渲染用；不写状态）。 */
export function groupsOf(threads: readonly CommentThread[]): ThreadGroups {
  return groupThreads(threads);
}

/** 默认 id 工厂（时间无关的自增 + 随机段，避免同毫秒内碰撞）。 */
function defaultIdFactory(): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `cmt_${Math.random().toString(36).slice(2, 8)}_${String(counter)}`;
  };
}
