/**
 * 评论线程状态机（C12/F7）——**纯函数**，不碰 DOM。
 *
 * 边界（briefs/fe-07.md §2）：新建 / 回复 / 解决 / 折叠（折叠是面板的读法，见 `groupThreads`）；
 * 硬规则：**解决态不可再编辑**（回复必须失败），要改先「重新打开」。
 * 评论数据不属于 Design IR（文档 JSON 里没有评论），因此不进命令栈、不进版本快照；
 * 本模块只管状态转移，持久化归 `storage.ts`（本地快照目录口径）。
 */
import type { PageId } from '@dforge/engine';

/** 评论锚点（世界坐标：随画布缩放/平移跟随，见图层覆盖层的坐标换算）。 */
export interface CommentAnchor {
  x: number;
  y: number;
}

/** 一条回复。 */
export interface CommentReply {
  id: string;
  author: string;
  body: string;
  /** ISO 8601 时间戳（排序与显示用）。 */
  createdAt: string;
}

/** 一个评论线程（首条评论 + 回复列表 + 解决态）。 */
export interface CommentThread {
  id: string;
  pageId: PageId;
  anchor: CommentAnchor;
  author: string;
  body: string;
  createdAt: string;
  /** 已解决：线程折叠展示，且**不可再编辑**（回复/改锚点都会被拒绝）。 */
  resolved: boolean;
  replies: CommentReply[];
}

/** 新建线程的入参。 */
export interface NewThreadInit {
  id: string;
  pageId: PageId;
  anchor: CommentAnchor;
  author: string;
  body: string;
  createdAt: string;
}

/** 线程操作的领域错误（解决态被编辑、正文为空等）。 */
export class CommentError extends Error {
  readonly code: 'empty-body' | 'resolved-thread';

  constructor(code: 'empty-body' | 'resolved-thread', message: string) {
    super(message);
    this.name = 'CommentError';
    this.code = code;
  }
}

/** 正文是否有效（去掉首尾空白后非空）。 */
export function isValidBody(body: string): boolean {
  return body.trim().length > 0;
}

/** 新建线程（正文为空即拒绝——空评论不进面板，也不进存储）。 */
export function createThread(init: NewThreadInit): CommentThread {
  if (!isValidBody(init.body)) {
    throw new CommentError('empty-body', '评论内容不能为空');
  }
  return {
    id: init.id,
    pageId: init.pageId,
    anchor: { ...init.anchor },
    author: init.author,
    body: init.body.trim(),
    createdAt: init.createdAt,
    resolved: false,
    replies: [],
  };
}

/** 线程是否可编辑（未解决即可编辑）。 */
export function isEditable(thread: CommentThread): boolean {
  return !thread.resolved;
}

/** 回复线程；**解决态不可再编辑**——抛错而不是静默忽略（调用方要能提示用户）。 */
export function replyToThread(
  thread: CommentThread,
  reply: { id: string; author: string; body: string; createdAt: string },
): CommentThread {
  if (!isEditable(thread)) {
    throw new CommentError('resolved-thread', '已解决的评论不能再回复（请先重新打开）');
  }
  if (!isValidBody(reply.body)) {
    throw new CommentError('empty-body', '回复内容不能为空');
  }
  return {
    ...thread,
    replies: [
      ...thread.replies,
      {
        id: reply.id,
        author: reply.author,
        body: reply.body.trim(),
        createdAt: reply.createdAt,
      },
    ],
  };
}

/** 解决线程（幂等：已解决再解决不报错，保持原对象）。 */
export function resolveThread(thread: CommentThread): CommentThread {
  if (thread.resolved) return thread;
  return { ...thread, resolved: true };
}

/** 重新打开（解决的反向转移；重开后恢复可编辑）。 */
export function reopenThread(thread: CommentThread): CommentThread {
  if (!thread.resolved) return thread;
  return { ...thread, resolved: false };
}

/** 按页筛选（评论模式只显示当前页的钉）。 */
export function threadsOfPage(threads: readonly CommentThread[], pageId: PageId): CommentThread[] {
  return threads.filter((thread) => thread.pageId === pageId);
}

/** 分组：未解决在前、已解决折叠在后（面板两段式列表的数据形状）。 */
export interface ThreadGroups {
  open: CommentThread[];
  resolved: CommentThread[];
}

/**
 * 分组并排序：两组各自按创建时间倒序（新→旧），与 Figma 评论面板一致。
 * 排序是**稳定可断言**的纯逻辑：时间相同按 id 兜底，避免列表在两帧之间抖动。
 */
export function groupThreads(threads: readonly CommentThread[]): ThreadGroups {
  const sorted = [...threads].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return {
    open: sorted.filter((thread) => !thread.resolved),
    resolved: sorted.filter((thread) => thread.resolved),
  };
}

/** 回复数（面板徽标）。 */
export function replyCount(thread: CommentThread): number {
  return thread.replies.length;
}

/** 更新线程（按 id 替换；找不到原样返回，调用方无需先查存在性）。 */
export function replaceThread(
  threads: readonly CommentThread[],
  next: CommentThread,
): CommentThread[] {
  return threads.map((thread) => (thread.id === next.id ? next : thread));
}
