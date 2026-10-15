'use client';

/**
 * 评审功能的本地图标（16×16 线性，clean-room 自绘）。
 *
 * 为什么放在本 feature 而不进 `@dforge/ui`：`packages/ui/**` 是 FE-01 独占目录
 * （briefs/_shared.md §2 的目录归属硬约束）。这里复用 UI 包导出的 `createIcon`
 * （统一 viewBox / 描边 / currentColor / 无障碍属性），几何按 Figma 本体中文界面
 * 的线性图标族自绘（同族视觉，非逐点照抄——A 级判定的图标几何由对照阶段校准）。
 */
import { createIcon } from '@dforge/ui';

/** 评论钉点（气泡 + 尾）。 */
export const CommentPinIcon = createIcon(
  'CommentPinIcon',
  <path d="M2.5 8.2C2.5 5.2 5 3 8 3s5.5 2.2 5.5 5.2-2.5 5.2-5.5 5.2c-.6 0-1.2-.1-1.7-.2L3.6 14l.6-2.4C3.1 10.7 2.5 9.6 2.5 8.2Z" />,
);

/** 版本历史（时钟 + 回溯箭头）。 */
export const HistoryIcon = createIcon(
  'HistoryIcon',
  <>
    <path d="M2.8 8a5.2 5.2 0 1 1 1.7 3.9" />
    <path d="M2.3 4.6v2.9h2.9" />
    <path d="M8 5.4V8l1.9 1.2" />
  </>,
);

/** 演示（播放三角）。 */
export const PlayIcon = createIcon('PlayIcon', <path d="M5 3.4 12.4 8 5 12.6Z" />);

/** 进入全屏（四角外张）。 */
export const FullscreenIcon = createIcon(
  'FullscreenIcon',
  <>
    <path d="M6 3.2H3.2V6" />
    <path d="M10 3.2h2.8V6" />
    <path d="M6 12.8H3.2V10" />
    <path d="M10 12.8h2.8V10" />
  </>,
);

/** 退出全屏（四角内收）。 */
export const ExitFullscreenIcon = createIcon(
  'ExitFullscreenIcon',
  <>
    <path d="M3.2 6H6V3.2" />
    <path d="M12.8 6H10V3.2" />
    <path d="M3.2 10H6v2.8" />
    <path d="M12.8 10H10v2.8" />
  </>,
);
