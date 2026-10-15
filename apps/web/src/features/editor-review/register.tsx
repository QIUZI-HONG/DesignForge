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
 * 迁移说明（FE-06 画布落地后）：
 * 1. 会话的视口改为注入 FE-06 的引擎视口（现在用 `createShellViewportSource()` 桥外壳缩放）；
 * 2. 会话的文档改为 FE-06 的命令栈快照（现在文档为空：`createReviewSession()` 自建空文档，
 *    评论/版本因此按 `dfg:comments:<docId>`、`dfg:versions:<docId>` 落在 `draft` 键空间——
 *    换成真实文档后键空间自动跟着 `document.id` 走）。
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
import { createReviewSession } from './session';
import { createShellViewportSource } from './shell-viewport';
import { VersionsDrawer } from './versions/VersionsDrawer';

/** 路由级会话单例（浏览器侧创建：命令的 `run` 闭包与插槽渲染共享同一份状态）。 */
const session = createReviewSession({ viewport: createShellViewportSource() });

/** 给插槽渲染包一层会话 Provider（插槽渲染在壳层的 React 树里）。 */
function WithSession({ children }: { children: React.ReactNode }) {
  return <ReviewProvider session={session}>{children}</ReviewProvider>;
}

/** 评论线程面板：只在评论模式显示。 */
function CommentsRightPanel() {
  const mode = useCommentsUi(session, (state) => state.mode);
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
    run: () => {
      session.comments.getState().toggleMode();
    },
  });

  registerCommand({
    id: RESERVED_COMMAND_IDS.present,
    title: t('review.present.title'),
    group: t('review.group'),
    enabled: () => buildSlides(session.getSnapshot()).length > 0,
    run: () => {
      session.present.getState().openPresentation();
    },
  });

  registerCommand({
    id: RESERVED_COMMAND_IDS.versions,
    title: t('review.versions.title'),
    group: t('review.group'),
    run: () => {
      const versions = session.versions.getState();
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
