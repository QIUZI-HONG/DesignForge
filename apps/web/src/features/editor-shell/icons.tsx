/**
 * 编辑器壳层自绘图标（16 画布 / 1.5 描边 / currentColor，走 `@dforge/ui` 的 `createIcon` 工厂）。
 *
 * 为什么在本目录补而不是加到 `@dforge/ui`：`packages/ui/**` 归 FE-01（_shared §2 目录归属），
 * 本票只能消费其图标集；壳层缺口（抓手/评论/演示/版本）按同一 clean-room 口径自绘，
 * 几何只用基础直线与圆弧组合，不复制任何第三方图标库路径。
 * 形状细节按 B 级「视觉同族」人工复核（验收标准 §2）。
 */
import { createIcon } from '@dforge/ui';

/** 抓手工具（画布平移）。 */
export const HandIcon = createIcon(
  'HandIcon',
  <>
    <path d="M6.1 8.4V4.5a1 1 0 0 1 2 0v3.6" />
    <path d="M8.1 7.4V3.5a1 1 0 0 1 2 0v4.4" />
    <path d="M10.1 8.2V5.4a1 1 0 0 1 2 0v5" />
    <path d="M6.1 8.4 4.7 7a1.05 1.05 0 0 0-1.5 1.4l2.2 2.9c1 1.3 2 2.1 3.9 2.1 2.3 0 3.9-1.6 3.9-3.9" />
  </>,
);

/** 评论（气泡）。 */
export const CommentIcon = createIcon(
  'CommentIcon',
  <path d="M2.6 5.4a2.6 2.6 0 0 1 2.6-2.6h5.6a2.6 2.6 0 0 1 2.6 2.6v2.9a2.6 2.6 0 0 1-2.6 2.6H7.3l-3.3 2.7v-2.7h-.2a1.2 1.2 0 0 1-1.2-1.2z" />,
);

/** 演示（播放三角）。 */
export const PresentIcon = createIcon('PresentIcon', <path d="M6.2 4.1 11.7 8l-5.5 3.9z" />);

/** 版本历史（时钟）。 */
export const HistoryIcon = createIcon(
  'HistoryIcon',
  <>
    <circle cx="8" cy="8" r="5.4" />
    <path d="M8 4.9V8l2.1 1.6" />
  </>,
);
