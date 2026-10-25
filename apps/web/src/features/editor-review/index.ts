/**
 * `@dforge/web` 编辑器评审特性（FE-07）—— 评论 / Present / 版本的公开面。
 *
 * 消费方（FE-03 编辑器壳）只需要这几样：
 * - `createReviewSession` + `ReviewProvider`：把命令栈、视口来源、评论/版本/Present 三块接起来；
 * - 画布覆盖层 `CommentLayer`（放进画布区域）、右栏 `CommentThreadPanel`（面板槽）、
 *   右抽屉 `VersionsDrawer`（壳自带触发按钮时也可直接挂）、全屏 `Presenter`；
 * - 顶栏/工具栏插槽件：`CommentsModeToggle`（评论模式）、`PresentButton`（演示）、
 *   `VersionsButton`（版本历史）；
 * - 订阅 hooks：`useReviewDocument` / `useCommentsUi` / `useVersionsUi` / `usePresentUi`。
 *
 * 接线要点（FE-03 落地后）：
 * 1. 视口要**同源**——把壳层/画布的视口 store 以 `viewport` 选项注入会话（接口见 `ViewportSource`），
 *    否则评论钉点会跟着自建视口走，不随画布缩放/平移；
 * 2. `Presenter` 是全屏固定浮层，挂在布局最外层即可；它开着时壳层快捷键应让位（读 `present.open`）。
 *
 * 纪律：本模块**不直接修改文档**——一切写入（含版本回滚）都是引擎命令，经 `ReviewSession.run` 交命令栈。
 */

export { CommentLayer, type CommentLayerProps } from './comments/CommentLayer';
export {
  CommentsModeToggle,
  type CommentsModeToggleProps,
} from './comments/CommentsModeToggle';
export {
  CommentThreadPanel,
  type CommentThreadPanelProps,
} from './comments/CommentThreadPanel';
export {
  type CommentsStore,
  type CommentsStoreOptions,
  type CommentsUiState,
  createCommentsStore,
  groupsOf,
} from './comments/comments-store';
export {
  hitTestPins,
  type PinLike,
  pinScreenPoint,
  type ScreenPoint,
  type WorldAnchor,
  worldAnchorAt,
} from './comments/coords';
export {
  type CommentAnchor,
  CommentError,
  type CommentReply,
  type CommentThread,
  createThread,
  groupThreads,
  isEditable,
  isValidBody,
  reopenThread,
  replaceThread,
  replyCount,
  replyToThread,
  resolveThread,
  type ThreadGroups,
  threadsOfPage,
} from './comments/threads';

export { formatTimestamp } from './format';

export {
  AUTO_HIDE_DELAY_MS,
  advanceBar,
  barsVisibleAfterIdle,
  createPresenterState,
  keyboardActionOf,
  type PresentAction,
  type PresenterState,
  stepPresentation,
} from './present/controller';
export { PresentButton, type PresentButtonProps } from './present/PresentButton';
export { Presenter } from './present/Presenter';
export { usePresentUi } from './present/present-hooks';
export {
  createPresentStore,
  type PresentStore,
  type PresentUiState,
} from './present/present-store';
export { fitScale, paintToCss, SlidePreview, type SlidePreviewProps } from './present/SlidePreview';
export {
  buildSlides,
  frameOf,
  type Slide,
  slideLabel,
} from './present/sequence';

export {
  ReviewProvider,
  useCommentsUi,
  useReviewDocument,
  useReviewSession,
  useReviewViewport,
  useVersionsUi,
} from './review-context';
export {
  createReviewSession,
  createViewportStore,
  type ReviewSession,
  type ReviewSessionOptions,
  type ViewportSource,
  type ViewportStore,
} from './session';
export {
  browserBackend,
  commentsKey,
  createLocalStore,
  createMemoryBackend,
  isCommentThread,
  isVersionSnapshot,
  type KeyValueBackend,
  type LocalStore,
  type LocalStoreOptions,
  versionsKey,
} from './storage';
export {
  appendSnapshot,
  createSnapshot,
  type DocumentDiff,
  diffDocuments,
  documentSummary,
  type NewSnapshotInit,
  type PageDiffEntry,
  restoreCommands,
  snapshotSummary,
  sortSnapshots,
  type VersionSnapshot,
} from './versions/snapshots';
export { VersionCompare } from './versions/VersionCompare';
export { VersionsButton, type VersionsButtonProps } from './versions/VersionsButton';
export { VersionsDrawer } from './versions/VersionsDrawer';
export {
  createVersionStore,
  type VersionStore,
  type VersionStoreOptions,
  type VersionUiState,
} from './versions/versions-store';
