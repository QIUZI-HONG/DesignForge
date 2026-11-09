/**
 * 评审域本地存储（评论 / 版本快照的持久化兜底）。
 *
 * **为什么是本地而不是 daemon**：本票开工时核对过契约与 daemon 路由——
 * `@dforge/contracts` 的 documents 命名空间与 `apps/daemon/src/routes/documents.ts` 只有
 * 文档/页面 CRUD，**没有版本或评论的读写路由**。按 briefs/fe-07.md §1 的兜底口径：
 * 走「本地快照目录」语义（浏览器侧 = localStorage 键空间 `dfg:*`），并在报告中明确声明阻塞，
 * 不伪造后端。接口形状（load/save 的 JSON 列表）与未来 daemon 路由一一对应，替换成本低。
 *
 * 读写机制（createLocalStore / 后端 / 内存替身）已提升为 lib 单一真源
 * `lib/local-store.ts`（票 D 册收编），本文件 re-export 保持既有导入路径不变；
 * 这里只留评审域自己的键空间与形状校验。
 */
import type { CommentThread } from './comments/threads';
import type { VersionSnapshot } from './versions/snapshots';

export {
  browserBackend,
  createLocalStore,
  createMemoryBackend,
  type KeyValueBackend,
  type KeyValueReadWriter,
  type LocalStore,
  type LocalStoreOptions,
} from '@/lib/local-store';

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
