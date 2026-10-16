'use client';

import {
  RESERVED_COMMAND_IDS,
  registerCommand,
  registerEditorSlotItem,
} from '@/features/editor-shell';
/**
 * FE-07 的**路由侧挂载模块**（FE-03 约定的接头）：
 * 在编辑器路由上把评论 / Present / 版本接进壳层——命令入口 + 插槽挂载。
 *
 * 为什么是「注册命令」而不是自己画按钮：壳层顶栏（C1）**已经渲染**三个预留入口
 * （`review.comment.toggle` / `review.present.start` / `review.versions.open`），
 * 未注册时禁用 + 原因提示；本模块用同 id 注册后入口自动点亮（注册表 last wins）。
 *
 * 插槽落点：
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
 * 为什么还要 `ReviewBootstrap`（而不是只写一行 `import`）：Next App Router 里**仅被 import、
 * 未被渲染**的客户端模块不会进入首屏客户端图（实测：裸 import 时入口仍是禁用态）。
 * 路由侧渲染一个 `return null` 的客户端组件即可把本模块拉进客户端图；
 * 注册函数带 `typeof window` 守卫——SSR 期不注册（服务端模块单例是跨请求共享的，
 * 在服务端注册会污染其他请求）。
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
 * 注册命令与插槽（浏览器侧；幂等——同 id 覆盖、同槽同 id 覆盖）。
 *
 * 为什么不是模块顶层裸调用：本模块会被 SSR 求值一次（客户端组件也会），
 * 而注册表是**模块单例**；服务端注册会跨请求共享。因此显式函数 + 浏览器守卫。
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

  // —— 插槽挂载 ——
  registerEditorSlotItem('canvas', {
    id: 'fe-07-comment-layer',
    order: 10,
    render: () => (
      <WithSession>
        <CommentLayer />
      </WithSession>
    ),
  });

  registerEditorSlotItem('right-panel', {
    id: 'fe-07-comments-panel',
    order: 10,
    render: () => <CommentsRightPanel />,
  });

  registerEditorSlotItem('overlays', {
    id: 'fe-07-presenter',
    order: 10,
    render: () => (
      <WithSession>
        <Presenter />
      </WithSession>
    ),
  });

  registerEditorSlotItem('overlays', {
    id: 'fe-07-versions',
    order: 11,
    render: () => (
      <WithSession>
        <VersionsDrawer />
      </WithSession>
    ),
  });
}

// —— 路由侧引导件 ——
/**
 * 路由侧引导件：`return null`，唯一职责是把本模块拉进客户端图并触发注册。
 * 路由（`app/editor/page.tsx`）渲染它一次即可（见本模块头注释的说明）。
 */
export function ReviewBootstrap(): null {
  return null;
}

// 模块求值即注册（浏览器侧）：路由渲染本模块后立即可用；
// 若宿主先于本模块挂载，注册表的通知会让插槽/入口重新取快照（useSyncExternalStore）。
registerEditorReview();
