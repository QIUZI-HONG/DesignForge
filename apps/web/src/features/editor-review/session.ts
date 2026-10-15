/**
 * 评论 / Present / 版本的**会话接缝**（FE-07）——与 FE-03 壳层、FE-06 画布的对接点。
 *
 * 组装（口径同 FE-04 `createPanelsSession`）：
 * 1. `CommandStack`：文档真值与唯一写入口（版本回滚 = `document.replace` 命令）；
 * 2. `CommentsStore` / `VersionStore`：评论线程与版本列表（UI 态 + 本地持久化）；
 * 3. `ViewportSource`：**视口来源**——评论钉点要随画布缩放/平移跟随，
 *    因此必须与画布读同一份视口。FE-03/FE-06 落地后注入它们持有的视口 store；
 *    未注入时本会话自建一个（独立挂载与测试用）。
 *
 * 为什么视口是「来源接口」而不是具体 store：画布（FE-06）需要高频 `setState` + rAF，
 * 面板只需要读；接口只暴露 `getViewport` + `subscribeViewport`，两侧互不锁死实现。
 */
import {
  type Command,
  CommandStack,
  createDocument,
  createViewport,
  type DesignDocument,
  getPage,
  type PageId,
  panBy as panViewport,
  type ScenePage,
  type Viewport,
  zoomAt as zoomViewport,
} from '@dforge/engine';

import { type CommentsStore, createCommentsStore } from './comments/comments-store';
import type { KeyValueBackend } from './storage';
import { createVersionStore, type VersionStore } from './versions/versions-store';

/** 视口读取来源（只读；画布/壳层注入）。 */
export interface ViewportSource {
  getViewport: () => Viewport;
  subscribeViewport: (listener: () => void) => () => void;
}

/** 自建视口 store（独立挂载/测试用；FE-03/FE-06 落地后可被替换）。 */
export interface ViewportStore extends ViewportSource {
  setViewport: (viewport: Viewport) => void;
  /** 屏幕像素平移（与引擎 `panBy` 同语义）。 */
  panBy: (dxScreen: number, dyScreen: number) => void;
  /** 以屏幕锚点缩放（与引擎 `zoomAt` 同语义）。 */
  zoomAt: (nextZoom: number, anchorScreen: { x: number; y: number }) => void;
}

/** 建自建视口 store。 */
export function createViewportStore(initial: Viewport = createViewport()): ViewportStore {
  let viewport = initial;
  const listeners = new Set<() => void>();
  const emit = (): void => {
    for (const listener of listeners) listener();
  };
  return {
    getViewport: () => viewport,
    subscribeViewport: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setViewport: (next) => {
      viewport = next;
      emit();
    },
    panBy: (dxScreen, dyScreen) => {
      viewport = panViewport(viewport, dxScreen, dyScreen);
      emit();
    },
    zoomAt: (nextZoom, anchorScreen) => {
      viewport = zoomViewport(viewport, nextZoom, anchorScreen);
      emit();
    },
  };
}

/** 会话构造选项。 */
export interface ReviewSessionOptions {
  /** 现成文档（壳层加载的文档）；省略则新建空文档。 */
  document?: DesignDocument;
  /** 文档 id（评论/版本持久化键空间；省略取 `document.id`）。 */
  documentId?: string;
  /** 当前页面 id（省略取文档首页）。 */
  pageId?: PageId;
  /** 评论署名（当前用户显示名）。 */
  author?: string;
  /** 视口来源（FE-03/FE-06 注入；省略自建）。 */
  viewport?: ViewportSource;
  /** 本地后端（测试注入内存后端；省略 localStorage）。 */
  backend?: KeyValueBackend | undefined;
  /** 时间源（测试固定）。 */
  now?: () => Date;
  /** id 工厂（测试确定性）。 */
  nextId?: () => string;
  /** 历史栈上限。 */
  historyLimit?: number;
  /** 是否深冻结文档（测试/调试开）。 */
  freeze?: boolean;
  /** 本地写入失败回调（配额满提示）。 */
  onWriteError?: (error: unknown) => void;
}

/** 会话：命令栈 + 评论 + 版本 + 视口。 */
export interface ReviewSession {
  readonly stack: CommandStack;
  readonly documentId: string;
  /** 当前页面 id（评论落在当前页）。 */
  readonly pageId: PageId;
  readonly viewport: ViewportSource;
  readonly comments: CommentsStore;
  readonly versions: VersionStore;
  /** 当前文档快照（`useSyncExternalStore` 取值函数；引用稳定）。 */
  readonly getSnapshot: () => DesignDocument;
  /** 文档变更订阅（引用稳定）。 */
  readonly subscribe: (listener: (document: DesignDocument) => void) => () => void;
  /** 读当前页面（只读快照）。 */
  readonly page: () => ScenePage;
  /** 施加命令（唯一写入口；空列表视作无操作）。 */
  readonly run: (commands: Command | readonly Command[], label: string) => void;
}

/** 建会话。 */
export function createReviewSession(options: ReviewSessionOptions = {}): ReviewSession {
  const document = options.document ?? emptyDocument();
  const stackOptions: { freeze?: boolean; historyLimit?: number } = {};
  if (options.freeze !== undefined) stackOptions.freeze = options.freeze;
  if (options.historyLimit !== undefined) stackOptions.historyLimit = options.historyLimit;
  const stack = new CommandStack(document, stackOptions);
  const pageId = options.pageId ?? (stack.document.pages[0]?.id as PageId);
  const documentId = options.documentId ?? stack.document.id;

  const run = (commands: Command | readonly Command[], label: string): void => {
    const list = Array.isArray(commands) ? (commands as readonly Command[]) : [commands as Command];
    if (list.length === 0) return;
    stack.dispatch(list, { label });
  };

  const now = options.now ?? (() => new Date());
  const nextId = options.nextId ?? defaultIdFactory();

  const commentsOptions: Parameters<typeof createCommentsStore>[0] = {
    documentId,
    pageId,
    author: options.author ?? '我',
    now,
    nextId,
  };
  if (options.backend !== undefined) commentsOptions.backend = options.backend;
  if (options.onWriteError !== undefined) commentsOptions.onWriteError = options.onWriteError;

  const versionOptions: Parameters<typeof createVersionStore>[0] = {
    documentId,
    getDocument: () => stack.getSnapshot(),
    run,
    now,
    nextId,
  };
  if (options.backend !== undefined) versionOptions.backend = options.backend;
  if (options.onWriteError !== undefined) versionOptions.onWriteError = options.onWriteError;

  return {
    stack,
    documentId,
    pageId,
    viewport: options.viewport ?? createViewportStore(),
    comments: createCommentsStore(commentsOptions),
    versions: createVersionStore(versionOptions),
    getSnapshot: () => stack.getSnapshot(),
    subscribe: (listener) => stack.subscribe(listener),
    page: () => getPage(stack.document, pageId),
    run,
  };
}

/** 空文档（未注入文档时的开发/测试默认）。 */
function emptyDocument(): DesignDocument {
  return createDocument({ id: 'draft', name: '未命名文件' });
}

/** 默认 id 工厂（会话内自增 + 随机段）。 */
function defaultIdFactory(): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `rev_${Math.random().toString(36).slice(2, 8)}_${String(counter)}`;
  };
}
