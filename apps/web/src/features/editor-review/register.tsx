'use client';

import { RESERVED_COMMAND_IDS, registerCommand } from '@/features/editor-shell';
/**
 * FE-07 的**路由侧接线模块**（命令登记 + 插槽渲染件；工单 02 引导收口后的形状）。
 *
 * 挂载时机统一收口到编辑器唯一客户端引导件（`app/editor/editor-bootstrap.tsx` 的
 * 声明式注册表）：本模块提供两样东西，由引导在挂载后执行/渲染——
 * 1. `registerEditorReview()`：**命令登记**（浏览器侧；幂等——同 id 覆盖）。壳层顶栏
 *    （C1）已渲染三个预留入口（`review.comment.toggle` / `review.present.start` /
 *    `review.versions.open`），未注册时禁用 + 原因提示，用同 id 注册后自动点亮
 *    （注册表 last wins）；
 * 2. `Review*Slot` 四个**插槽渲染件**：声明表按 id/order 引用（落点与含义见各组件注释）。
 *
 * 插槽落点（声明在 `app/editor/editor-bootstrap.tsx` 的 `EDITOR_SLOT_DECLARATIONS`）：
 * - `canvas`：评论钉点覆盖层（铺满画布区域；壳层的画布列是 `position: relative`）；
 * - `right-panel`：评论线程面板（**只在评论模式显示**——非评论模式不该占右栏）；
 * - `overlays`：Present 全屏浮层 + 版本抽屉/并排对比（盖住整壳的层）。
 *
 * 迁移说明（工作包 C 已落地）：
 * 1. 会话的文档改为**与画布工作区同源**（`documentPort`，见 `workspace-port.ts`）——
 *    修复前 `createReviewSession()` 自建空文档：画布上画出画板后，「演示」入口的
 *    `enabled()` 读到的仍是空文档 → 恒禁用（C3/D-4 实测）；
 * 2. 视口仍走 `createShellViewportSource()` 桥外壳缩放：画布视口与外壳缩放已由 FE-06 的
 *    `connectViewSync` 单向回写（外壳跟随画布），本票不动这条缝。
 *
 * 纪律：本模块不产生 UI 文案（文案在组件内走 `t()`）；注册幂等（同 id 覆盖）。
 *
 * 为什么命令登记必须带 `typeof window` 守卫（而不是模块顶层裸调用）：本模块会被 SSR
 * 求值（客户端组件也会），而注册表是**模块单例**；服务端注册会跨请求共享。
 * 工单 02 起模块求值**不再注册**——唯一执行点是编辑器引导件挂载后的 effect（浏览器侧），
 * 服务端/客户端首帧一致由此保证（hydration 时序脆弱性消除）。
 */
import { t } from '@/i18n';

import { CommentLayer } from './comments/CommentLayer';
import { CommentThreadPanel } from './comments/CommentThreadPanel';
import { Presenter } from './present/Presenter';
import { buildSlides } from './present/sequence';
import { ReviewProvider, useCommentsUi } from './review-context';
import { createReviewSession, type ReviewSession } from './session';
import { createShellViewportSource } from './shell-viewport';
import { VersionsDrawer } from './versions/VersionsDrawer';
import { createWorkspaceDocumentPort } from './workspace-port';

/**
 * 路由级会话单例（浏览器侧**惰性**创建）。
 *
 * 为什么不是模块求值期就建：装配要读画布工作区单例（`getWorkspace()` → `window.location.search`），
 * SSR 期求值会把「服务端的那一份」建出来；惰性化把创建时机锁死在浏览器首次使用，
 * 同时让「命令 run 闭包」与「插槽渲染」永远取同一份（单例）。
 */
let session: ReviewSession | null = null;

/** 取（必要时创建）路由级评审会话：文档真值与画布工作区同源。 */
export function getReviewSession(): ReviewSession {
  if (session === null) {
    session = createReviewSession({
      documentPort: createWorkspaceDocumentPort(),
      viewport: createShellViewportSource(),
    });
  }
  return session;
}

/** 复位路由级会话（**测试隔离用**；真实路由里会话与页面同生命周期）。 */
export function resetReviewSessionForTest(): void {
  session = null;
}

/** 给插槽渲染包一层会话 Provider（插槽渲染在壳层的 React 树里）。 */
function WithSession({ children }: { children: React.ReactNode }) {
  return <ReviewProvider session={getReviewSession()}>{children}</ReviewProvider>;
}

/** 评论线程面板：只在评论模式显示。 */
function CommentsRightPanel() {
  const mode = useCommentsUi(getReviewSession(), (state) => state.mode);
  if (!mode) return null;
  return (
    <WithSession>
      <CommentThreadPanel />
    </WithSession>
  );
}

/**
 * 登记 FE-07 命令（浏览器侧；幂等——同 id 覆盖）。
 *
 * 由编辑器引导注册表声明执行（`app/editor/editor-bootstrap.tsx`），测试里也可显式调用。
 * 为什么不是模块顶层裸调用：本模块会被 SSR 求值一次（客户端组件也会），而注册表是
 * **模块单例**；服务端注册会跨请求共享。因此显式函数 + 浏览器守卫。
 */
export function registerEditorReview(): void {
  if (typeof window === 'undefined') return;
  // —— 命令注册（顶栏预留入口据此点亮） ——
  registerCommand({
    id: RESERVED_COMMAND_IDS.commentToggle,
    title: t('review.comments.toggle'),
    group: t('review.group'),
    // Figma 同款：C 切评论模式（单键在输入区内不派发，见 editor-shell/tools.ts 的约定）
    shortcut: 'C',
    // 开启态（C2）：顶栏入口渲染 aria-pressed + 激活样式，按下时入口名切「退出评论模式」
    pressed: () => getReviewSession().comments.getState().mode,
    pressedTitle: () => t('review.comments.toggleOn'),
    subscribe: (notify) => getReviewSession().comments.subscribe(() => notify()),
    run: () => {
      getReviewSession().comments.getState().toggleMode();
    },
  });

  registerCommand({
    id: RESERVED_COMMAND_IDS.present,
    title: t('review.present.title'),
    group: t('review.group'),
    // 有画板可演示（文档真值与画布同源；`subscribe` 让「画布上出现第一个画板」立刻点亮入口）
    enabled: () => buildSlides(getReviewSession().getSnapshot()).length > 0,
    // 禁用原因（UX-07）：没有画板时入口给明确原因，而不是静默灰置
    disabledReason: () => t('review.present.empty.title'),
    pressed: () => getReviewSession().present.getState().open,
    pressedTitle: () => t('review.present.exit'),
    subscribe: (notify) => getReviewSession().subscribe(() => notify()),
    run: () => {
      const present = getReviewSession().present.getState();
      // 开关语义：演示进行中点入口 = 退出（与顶栏插槽里的 PresentButton 同口径）
      if (present.open) present.exitPresentation();
      else present.openPresentation();
    },
  });

  registerCommand({
    id: RESERVED_COMMAND_IDS.versions,
    title: t('review.versions.title'),
    group: t('review.group'),
    run: () => {
      const versions = getReviewSession().versions.getState();
      versions.setOpen(!versions.open);
    },
  });
}

// —— 插槽渲染件（声明表引用；包会话 Provider，见文件头注释）——

/** 评论钉点覆盖层（`canvas` 槽声明引用）：铺满画布区域。 */
export function ReviewCommentLayerSlot() {
  return (
    <WithSession>
      <CommentLayer />
    </WithSession>
  );
}

/** 评论线程面板（`right-panel` 槽声明引用）：只在评论模式显示。 */
export function ReviewCommentsPanelSlot() {
  return <CommentsRightPanel />;
}

/** Present 全屏浮层（`overlays` 槽声明引用）。 */
export function ReviewPresenterSlot() {
  return (
    <WithSession>
      <Presenter />
    </WithSession>
  );
}

/** 版本抽屉/并排对比（`overlays` 槽声明引用）。 */
export function ReviewVersionsDrawerSlot() {
  return (
    <WithSession>
      <VersionsDrawer />
    </WithSession>
  );
}
