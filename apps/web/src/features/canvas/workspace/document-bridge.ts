/**
 * 文档桥（D-2 / UX-03）——`/editor` 的「载入 → 编辑 → 保存」闭环，复用既有持久化客户端。
 *
 * 缺陷现场：`/editor` 只装配内存「未命名设计文件」——不读 `?documentId=`、不落盘，
 * 从首页点开自己的文档得到空画布、刷新即丢、导出报 `doc_not_found`（验收 D-2 / UX-03）。
 *
 * 口径（与 studio 宿主同一套 `features/canvas/persistence/documents-client.ts`，不新造第二套）：
 * - **载入**：`load(id)` 走 `loadDesignDocument`（逐页读回 → 引擎 `parseDocument` 结构校验），
 *   交给宿主 `adopt(...)` **以 `document.replace` 命令**替换进共享命令栈（写路径唯一性），
 *   并清空历史（载入不该能被撤销回内存空文档）；
 * - **保存**：`save()` 走 `saveDesignDocument`（逐页 PUT，页面不存在时先建）；
 *   未落盘文档先按名**幂等**落盘——同名已存在则复用（与 studio 口径一致），不产生第二份；
 * - **保存态**：`dirty（未保存）/ saving（保存中…）/ saved（已保存）/ error（失败 + 原因）`；
 *   保存期间继续编辑不会谎报「已保存」（按保存起点与当前修订号比对，落后即回「未保存」）；
 * - **顶栏真名**：`name` 取文档真值（非内存占位名），壳层据此显示真实文件名。
 *
 * 本模块不依赖 React、不依赖装配层（宿主以 `DocumentBridgeHost` 注入），因此可在单测里
 * 直接驱动；装配层（`workspace-session.ts`）负责把 pageId / 选择集 / 单例同步接上。
 */
import type { DesignDocument } from '@dforge/engine';
import { createStore, type StoreApi } from 'zustand/vanilla';

import {
  type DocumentsClient,
  loadDesignDocument,
  saveDesignDocument,
} from '../persistence/documents-client';

/** 保存态（顶栏显示 / 命令可用性判据）。 */
export type SaveStatus = 'dirty' | 'saving' | 'saved' | 'error';

/**
 * 保存命令 id（顶栏按钮、文件菜单与 ⌘S 共用同一条命令；同 id 三处入口不漂移）。
 * 归属：画布工作区注册实现（壳层 `file.*` 预留族里的新成员，未注册时入口不渲染死链）。
 */
export const SAVE_DOCUMENT_COMMAND_ID = 'file.save';

/** 失败来源（决定用户文案：载入失败 ≠ 保存失败）。 */
export type DocumentErrorKind = 'load' | 'save';

/** 文档态投影（顶栏与命令读它）。 */
export interface WorkspaceDocumentState {
  /** daemon 文档 id（未落盘 → null；落盘后 = daemon 的文档标识）。 */
  documentId: string | null;
  /** 文档名（取文档真值；未命名内存文档即为装配名）。 */
  name: string;
  status: SaveStatus;
  /** 失败原因（原文；界面文案由消费方经 i18n 包一层）。 */
  error: string | null;
  /** 失败来源。 */
  errorKind: DocumentErrorKind | null;
}

/** 载入/保存结果（调用方只需成功与否 + 原因）。 */
export interface DocumentBridgeResult {
  ok: boolean;
  error?: string;
  /** 落盘后的文档 id（保存成功时给出）。 */
  documentId?: string;
}

/**
 * 宿主接缝（装配层注入；本模块不反向依赖 `workspace-session`，避免循环导入）。
 */
export interface DocumentBridgeHost {
  /** 当前文档真值（命令栈快照）。 */
  document(): DesignDocument;
  /**
   * 把载入的文档替换进共享命令栈（装配层同时负责页面 id / 选择集 / 会话 UI 态收尾）。
   * 返回 false 表示目标文档不可采纳（例如没有任何页面）——此时不改变会话。
   */
  adopt(document: DesignDocument, documentId: string): boolean;
  /** 订阅文档变更（用于「未保存」判定）。 */
  subscribe(listener: () => void): () => void;
}

/** 构造选项。 */
export interface DocumentBridgeOptions {
  host: DocumentBridgeHost;
  client: DocumentsClient;
  /** 初始状态（装配时以内存文档为准：documentId=null、status=clean→dirty 按需）。 */
  initial: { documentId?: string | null; name: string };
  /** 保存后把文档 id 写进地址栏（浏览器默认开；`?documentId=` 刷新可恢复）。 */
  syncUrl?: boolean;
}

/** 文档桥。 */
export interface DocumentBridge {
  /** 文档态投影（React 侧经 `useStore` 订阅）。 */
  readonly store: StoreApi<WorkspaceDocumentState>;
  /** 从 daemon 载入并按 `document.replace` 替换当前会话文档。 */
  load(documentId: string): Promise<DocumentBridgeResult>;
  /** 保存当前文档（未落盘时先按名幂等落盘）。 */
  save(): Promise<DocumentBridgeResult>;
  /** 退订（宿主卸载时调用）。 */
  dispose(): void;
}

/** 地址栏同步（把文档 id 写进 `?documentId=`，保留其余查询参数如 `?daemon=`）。 */
function syncUrl(documentId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('documentId', documentId);
    window.history.replaceState(null, '', url.toString());
  } catch {
    // 地址栏不可写（无 history / 异常 URL）：不影响保存本身，静默降级
  }
}

/** 创建文档桥。 */
export function createDocumentBridge(options: DocumentBridgeOptions): DocumentBridge {
  const { host, client } = options;
  const store = createStore<WorkspaceDocumentState>(() => ({
    documentId: options.initial.documentId ?? null,
    name: options.initial.name,
    // 未落盘的装配文档（`/editor` 直接打开、或刚新建）在磁盘上没有对应内容 → 「未保存」；
    // 只有确实与 daemon 同步过的文档才是「已保存」（载入/保存成功时各自置位）。
    status: options.initial.documentId == null ? 'dirty' : 'saved',
    error: null,
    errorKind: null,
  }));

  /**
   * 文档修订号：每次**文档真值变化**（不含桥自身的载入替换）自增。
   * 用途：保存是异步的，保存期间用户可能继续编辑——完成时要能判断「保存的是不是最后一版」，
   * 落后就回到「未保存」，不允许显示「已保存」而实际有未落盘的改动。
   */
  let revision = 0;
  /** 桥自身正在替换文档（载入）：这期间的变更不算用户编辑。 */
  let adopting = false;

  const unsubscribe = host.subscribe(() => {
    if (adopting) return;
    revision += 1;
    const state = store.getState();
    // 名字跟随文档真值（重命名命令也走这里）；错误态下保留原因（用户还没重试）
    const name = host.document().name;
    if (state.status === 'saving') {
      if (state.name !== name) store.setState({ name });
      return;
    }
    if (state.status !== 'dirty' || state.name !== name) {
      store.setState({ status: 'dirty', name, error: null, errorKind: null });
    }
  });

  const fail = (kind: DocumentErrorKind, error: string): DocumentBridgeResult => {
    store.setState({ status: 'error', error, errorKind: kind });
    return { ok: false, error };
  };

  return {
    store,
    async load(documentId) {
      const loaded = await loadDesignDocument(client, documentId);
      if (!loaded.ok) return fail('load', loaded.error);

      adopting = true;
      try {
        if (!host.adopt(loaded.value, documentId)) {
          return fail('load', `文档无可用页面：${documentId}`);
        }
      } finally {
        adopting = false;
      }
      store.setState({
        documentId,
        name: loaded.value.name,
        status: 'saved',
        error: null,
        errorKind: null,
      });
      return { ok: true, documentId };
    },

    async save() {
      const startRevision = revision;
      store.setState({ status: 'saving', error: null, errorKind: null });
      const document = host.document();

      // 幂等落盘：未落盘文档先按名找/建（同名复用，与 studio 宿主同一口径）
      let documentId = store.getState().documentId;
      if (documentId === null) {
        const existing = await client.findDocumentByName(document.name);
        if (!existing.ok) return fail('save', existing.error);
        if (existing.value !== null) {
          documentId = existing.value.id;
        } else {
          const created = await client.createDocument(document.name);
          if (!created.ok) return fail('save', created.error);
          documentId = created.value.id;
        }
        store.setState({ documentId });
        if (options.syncUrl !== false) syncUrl(documentId);
      }

      const saved = await saveDesignDocument(client, documentId, document);
      if (!saved.ok) return fail('save', saved.error);

      store.setState({
        documentId,
        name: document.name,
        status: revision === startRevision ? 'saved' : 'dirty',
        error: null,
        errorKind: null,
      });
      return { ok: true, documentId };
    },

    dispose() {
      unsubscribe();
    },
  };
}
