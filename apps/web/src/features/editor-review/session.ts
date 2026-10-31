/**
 * 评论 / Present / 版本的**会话接缝**（FE-07）——与 FE-03 壳层、FE-06 画布的对接点。
 *
 * 组装（口径同 FE-04 `createPanelsSession`）：
 * 1. `CommandStack`：文档真值与唯一写入口（版本回滚 = `document.replace` 命令）；
 *    **编辑器路由下与画布工作区共享同一栈**（`documentPort`，C3/D-4 修复）——
 *    评审侧不再自建空文档，否则「演示判定 / 版本快照 / 评论锚点」会与画布脱钩；
 * 2. `CommentsStore` / `VersionStore`：评论线程与版本列表（UI 态 + 本地持久化）；
 * 3. `ViewportSource`：**视口来源**——评论钉点要随画布缩放/平移跟随，
 *    因此必须与画布读同一份视口。FE-03/FE-06 落地后注入它们持有的视口 store；
 *    未注入时本会话自建一个（独立挂载与测试用）。
 *
 * 为什么视口是「来源接口」而不是具体 store：画布（FE-06）需要高频 `setState` + rAF，
 * 面板只需要读；接口只暴露 `getViewport` + `subscribeViewport`，两侧互不锁死实现。
 *
 * **文档标识随工作区文档动态解析**（#03 / 证据 §A3，方案定案）：
 * 缺陷现场是 `documentId` 在会话首次创建时冻结（冻结到占位文档 `doc-editor`），而评审会话
 * 是路由级单例、跨 SPA 导航存活——整页会话所有文档共用一个 localStorage 键：文档 A 的
 * 评论出现在文档 B 上；对 B「恢复」A 的快照把 A 整体写进 B。候选方案二选一：
 * - **动态解析（本票采用）**：`documentId` 随当前栈的文档 id 动态解析，评论/版本 store 经
 *   `attachDocument` 重挂到新文档的持久化桶。理由：文档端口（`documentPort`）已经动态解析
 *   栈/页面，「标识」天然属于同一接缝，零新增跨 feature 耦合；且 `loadDesignDocument` 用
 *   daemon 文档 id 命名引擎文档（见 canvas/persistence/documents-client.ts），当前文档 id
 *   即 daemon 身份，无需再接文档桥；
 * - 按 daemon 文档桥 id 分桶（未采用）：桥的 `documentId` 未落盘时为 null，仍要回退到引擎
 *   id，两套身份并存口径更复杂，且评审会话要多一条进 canvas 桥的依赖。
 * 已知边界（有意不做）：未落盘文档首次保存后 daemon 侧 id 才出现，引擎文档 id 不随保存
 * 迁移——「未命名草稿 → 首次落盘」的评论不跨身份迁移，跨文档隔离语义不受影响（票面验收
 * 只约束跨文档隔离）。
 */
import {
  type Command,
  CommandStack,
  createDocument,
  createViewport,
  type DesignDocument,
  findPage,
  type PageId,
  panBy as panViewport,
  type ScenePage,
  type Viewport,
  zoomAt as zoomViewport,
} from '@dforge/engine';

import { type CommentsStore, createCommentsStore } from './comments/comments-store';
import { createPresentStore, type PresentStore } from './present/present-store';
import type { KeyValueBackend } from './storage';
import { createVersionStore, type VersionStore } from './versions/versions-store';

/** 视口读取来源（只读；画布/壳层注入）。 */
export interface ViewportSource {
  getViewport: () => Viewport;
  subscribeViewport: (listener: () => void) => () => void;
}

/**
 * 文档端口——评审会话与**画布工作区共享同一份文档真值**的接缝（C3/D-4 修复）。
 *
 * 为什么是「端口 + 动态解析」而不是创建时注入一份 `CommandStack`：编辑器宿主在
 * 载入/导入时会替换工作区会话（栈也换新的），评审侧若在创建时抓住旧栈，
 * 演示判定（`buildSlides` 读快照）与版本快照就会与画布脱钩——这正是
 * 「文档 root 已有画板、演示入口仍恒禁用」的根因（评审会话自建空文档）。
 *
 * 引用稳定性：三个成员都必须是稳定引用（会被 `useSyncExternalStore` 与命令订阅长期持有）。
 */
export interface ReviewDocumentPort {
  /** 当前文档真值的命令栈（唯一写入口）。 */
  getStack: () => CommandStack;
  /** 当前页面 id（载入/切页后跟随；评论落在当前页）。 */
  getPageId: () => PageId;
  /** 文档或栈身份变化订阅（退订函数返回值同形）。 */
  subscribe: (listener: () => void) => () => void;
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
  /**
   * 文档 id（评论/版本持久化键空间）：显式给定时键空间创建起固定（独立挂载/门禁取样/单测）；
   * 省略则动态跟随当前文档（载入/导入换文档即换桶，见模块头「方案定案」）。
   */
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
  /**
   * 文档端口（编辑器路由注入画布工作区的文档真值；省略时用注入/自建的独立栈——
   * 独立挂载、门禁取样与单测走这条）。
   */
  documentPort?: ReviewDocumentPort;
}

/** 会话：命令栈 + 评论 + 版本 + 视口。 */
export interface ReviewSession {
  /** 文档真值的命令栈（注入端口时按端口动态解析——载入/换栈后跟随）。 */
  readonly stack: CommandStack;
  /**
   * 持久化键空间（评论/版本按它隔离）：显式给定时固定；省略时**随当前文档动态解析**
   * （换文档即换桶，跨文档隔离——#03 / 证据 §A3）。
   */
  readonly documentId: string;
  /** 当前页面 id（评论落在当前页；注入端口时跟随工作区）。 */
  readonly pageId: PageId;
  readonly viewport: ViewportSource;
  readonly comments: CommentsStore;
  readonly versions: VersionStore;
  /** Present（演示）UI 态：入口按钮与全屏浮层同源读它。 */
  readonly present: PresentStore;
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
  const port = options.documentPort;
  const document = options.document ?? port?.getStack().document ?? emptyDocument();
  const stackOptions: { freeze?: boolean; historyLimit?: number } = {};
  if (options.freeze !== undefined) stackOptions.freeze = options.freeze;
  if (options.historyLimit !== undefined) stackOptions.historyLimit = options.historyLimit;
  const ownStack = new CommandStack(document, stackOptions);
  /** 文档真值的命令栈：有端口时**每次都问端口**（载入/换栈后自动跟随）。 */
  const getStack = (): CommandStack => port?.getStack() ?? ownStack;
  /** 当前页面 id：缺省取创建时文档首页（`findPage` 兜底——换文档后旧 id 失效不炸）。 */
  const fallbackPageId = options.pageId ?? (document.pages[0]?.id as PageId);
  const getPageId = (): PageId => port?.getPageId() ?? fallbackPageId;
  /**
   * 文档标识（#03 / 证据 §A3）：不再在创建时冻结——省略显式 `documentId` 时**随当前栈的
   * 文档动态解析**（工作区载入/导入 = 对同一栈 `document.replace` 换血，引擎文档 id 即
   * daemon 文档 id，见 canvas/persistence/documents-client.ts `loadDesignDocument`）；
   * 显式给定时固定（键空间显式给定语义，独立挂载/门禁取样/单测用）。
   */
  const resolveDocumentId = (): string => options.documentId ?? getStack().document.id;
  const documentId = resolveDocumentId();

  const run = (commands: Command | readonly Command[], label: string): void => {
    const list = Array.isArray(commands) ? (commands as readonly Command[]) : [commands as Command];
    if (list.length === 0) return;
    getStack().dispatch(list, { label });
  };

  const now = options.now ?? (() => new Date());
  const nextId = options.nextId ?? defaultIdFactory();

  const commentsOptions: Parameters<typeof createCommentsStore>[0] = {
    documentId,
    // 函数形式：新评论按**当时**的当前页落点（载入/切页后跟随）
    pageId: getPageId,
    author: options.author ?? '我',
    now,
    nextId,
  };
  if (options.backend !== undefined) commentsOptions.backend = options.backend;
  if (options.onWriteError !== undefined) commentsOptions.onWriteError = options.onWriteError;

  const versionOptions: Parameters<typeof createVersionStore>[0] = {
    documentId,
    getDocument: () => getStack().getSnapshot(),
    run,
    now,
    nextId,
  };
  if (options.backend !== undefined) versionOptions.backend = options.backend;
  if (options.onWriteError !== undefined) versionOptions.onWriteError = options.onWriteError;

  const comments = createCommentsStore(commentsOptions);
  const versions = createVersionStore(versionOptions);

  // —— 换文档重挂（跨文档隔离的执行点，#03 / 证据 §A3）——
  // 文档真值一变就重解析身份；变了就把评论/版本 store 重挂到新文档的持久化桶
  // （旧桶原样保留——切回原文档数据原样回来）。触发源与文档端口同一条订阅链：
  // 载入/导入是同一栈上的 `document.replace`（栈订阅可见），工作区整体被替换时端口
  // 的 `subscribeWorkspace` 也转发到这里。只在动态模式挂 watcher（显式 `documentId`
  // 是固定键空间，见 `resolveDocumentId` 注释）；退订随会话同寿命（路由级单例），
  // 与本文件 `subscribe` 的口径一致。
  if (options.documentId === undefined) {
    let attachedDocumentId = documentId;
    const reattachIfDocumentChanged = (): void => {
      const nextId = resolveDocumentId();
      if (nextId === attachedDocumentId) return;
      attachedDocumentId = nextId;
      comments.getState().attachDocument(nextId);
      versions.getState().attachDocument(nextId);
    };
    if (port !== undefined) port.subscribe(reattachIfDocumentChanged);
    else ownStack.subscribe(reattachIfDocumentChanged);
  }

  return {
    get stack() {
      return getStack();
    },
    get documentId() {
      return resolveDocumentId();
    },
    get pageId() {
      return getPageId();
    },
    viewport: options.viewport ?? createViewportStore(),
    comments,
    versions,
    present: createPresentStore(),
    getSnapshot: () => getStack().getSnapshot(),
    subscribe: (listener) => {
      // 无端口：栈自身就是真源（自建栈不会被替换）
      if (port === undefined) return ownStack.subscribe(listener);
      // 有端口：端口负责「文档变了 / 栈被换了」两类通知；快照按通知时的当前栈读
      return port.subscribe(() => {
        listener(getStack().getSnapshot());
      });
    },
    page: () => {
      const current = getStack().document;
      // 换文档后旧页面 id 可能失效：退回首页（读路径不抛错，写路径由命令栈兜住）
      return findPage(current, getPageId()) ?? (current.pages[0] as ScenePage);
    },
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
