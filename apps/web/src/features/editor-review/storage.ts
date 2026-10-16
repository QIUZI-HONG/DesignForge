/**
 * 本地存储层（评论 / 版本快照的持久化兜底）。
 *
 * **为什么是本地而不是 daemon**：本票开工时核对过契约与 daemon 路由——
 * `@dforge/contracts` 的 documents 命名空间与 `apps/daemon/src/routes/documents.ts` 只有
 * 文档/页面 CRUD，**没有版本或评论的读写路由**。按 briefs/fe-07.md §1 的兜底口径：
 * 走「本地快照目录」语义（浏览器侧 = localStorage 键空间 `dfg:*`），并在报告中明确声明阻塞，
 * 不伪造后端。接口形状（load/save 的 JSON 列表）与未来 daemon 路由一一对应，替换成本低。
 *
 * 健壮性契约：存储是**可丢的缓存**——坏 JSON、形状不符、写入配额失败一律不炸界面。
 */
import type { CommentThread } from './comments/threads';
import type { VersionSnapshot } from './versions/snapshots';

/** 最小键值后端（`localStorage` 的形状子集；便于测试注入与 SSR 判空）。 */
export interface KeyValueBackend {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

/** 本地列表存储。 */
export interface LocalStore<T> {
  /** 读全部条目（坏数据一律当空/过滤，永不抛错）。 */
  load: () => T[];
  /** 覆盖写全部条目（失败只回调，不抛错）。 */
  save: (items: readonly T[]) => void;
}

/** createLocalStore 选项。 */
export interface LocalStoreOptions<T> {
  key: string;
  /** 后端；省略时用 `localStorage`（不存在则退化为空操作）。 */
  backend?: KeyValueBackend | undefined;
  /** 形状校验（逐条过滤，挡住旧版本数据与手改坏数据）。 */
  validate?: (value: unknown) => value is T;
  /** 写入失败回调（配额满 / 隐私模式），供上层提示「本地保存失败」。 */
  onWriteError?: (error: unknown) => void;
}

/** 浏览器后端（非浏览器环境返回 undefined）。 */
export function browserBackend(): KeyValueBackend | undefined {
  if (typeof window === 'undefined') return undefined;
  const storage = (window as { localStorage?: KeyValueBackend }).localStorage;
  return storage ?? undefined;
}

/** 解析后端里的 JSON 列表：坏数据不进界面。 */
function readList<T>(
  backend: KeyValueBackend | undefined,
  key: string,
  validate: ((value: unknown) => value is T) | undefined,
): T[] {
  if (backend === undefined) return [];
  let raw: string | null;
  try {
    raw = backend.getItem(key);
  } catch {
    return [];
  }
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  if (validate === undefined) return parsed as T[];
  return parsed.filter((item) => validate(item));
}

/** 建本地列表存储。 */
export function createLocalStore<T>(options: LocalStoreOptions<T>): LocalStore<T> {
  const backend = options.backend ?? browserBackend();
  return {
    load: () => readList(backend, options.key, options.validate),
    save: (items) => {
      if (backend === undefined) return;
      try {
        backend.setItem(options.key, JSON.stringify(items));
      } catch (error) {
        options.onWriteError?.(error);
      }
    },
  };
}

/** 内存后端（测试与「本次会话内有效」的降级路径）。 */
export function createMemoryBackend(seed: Record<string, string> = {}): KeyValueBackend {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

/** 评论线程键空间（按文档隔离；与版本快照分开，删除文档不影响对方）。 */
export function commentsKey(documentId: string): string {
  return `dfg:comments:${documentId}`;
}

/** 版本快照键空间。 */
export function versionsKey(documentId: string): string {
  return `dfg:versions:${documentId}`;
}

/** 评论线程形状校验（旧版本/手改坏数据不进面板）。 */
export function isCommentThread(value: unknown): value is CommentThread {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  const anchor = record.anchor as Record<string, unknown> | undefined;
  return (
    typeof record.id === 'string' &&
    typeof record.pageId === 'string' &&
    typeof record.author === 'string' &&
    typeof record.body === 'string' &&
    typeof record.createdAt === 'string' &&
    typeof record.resolved === 'boolean' &&
    Array.isArray(record.replies) &&
    typeof anchor === 'object' &&
    anchor !== null &&
    typeof anchor.x === 'number' &&
    typeof anchor.y === 'number'
  );
}

/** 版本快照形状校验（document 是 opaque JSON：只校验外层元数据与必要字段）。 */
export function isVersionSnapshot(value: unknown): value is VersionSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  const document = record.document as Record<string, unknown> | undefined;
  return (
    typeof record.id === 'string' &&
    typeof record.documentId === 'string' &&
    typeof record.label === 'string' &&
    typeof record.createdAt === 'string' &&
    typeof document === 'object' &&
    document !== null &&
    Array.isArray(document.pages)
  );
}
