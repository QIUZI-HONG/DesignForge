/**
 * 首页自绘图标（FE-02）。
 *
 * 为什么在本票目录里自绘而不是加进 `@dforge/ui`：`packages/ui` 的图标集归 FE-01 独占
 * （_shared §2 目录归属），首页要用的几个图标（齿轮/网格/列表/时钟/文件夹/星芒/模板）
 * 尚未收录——按同一口径（16 画布 / 1.5 描边 / currentColor / clean-room 基础几何）
 * 在本票目录内自绘，避免跨票写他人目录。
 *
 * a11y 同 FE-01 约定：默认装饰性（`aria-hidden`）；单独承载语义时由调用方给文案。
 */
import type { ReactNode, SVGProps } from 'react';

/** 描边宽（16 画布坐标内，随 viewBox 等比缩放；与 FE-01 图标集一致）。 */
const STROKE_WIDTH = 1.5;

/** 图标 props（尺寸由调用方按令牌档给，默认 16）。 */
export interface HomeIconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  size?: number;
}

/** 生成一个首页图标组件（统一注入画布与描边属性）。 */
function createHomeIcon(displayName: string, geometry: ReactNode) {
  function Icon({ size = 16, ...rest }: HomeIconProps) {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable="false"
        {...rest}
      >
        {geometry}
      </svg>
    );
  }
  Icon.displayName = displayName;
  return Icon;
}

/** 齿轮（设置入口）。 */
export const GearIcon = createHomeIcon(
  'GearIcon',
  <>
    <circle cx="8" cy="8" r="2.2" />
    <path d="M8 1.6v1.6M8 12.8v1.6M2.6 8H1M15 8h-1.6M4.2 4.2 3 3M13 13l-1.2-1.2M11.8 4.2 13 3M3 13l1.2-1.2" />
  </>,
);

/** 网格视图（2×2 方格）。 */
export const GridViewIcon = createHomeIcon(
  'GridViewIcon',
  <>
    <rect x="2" y="2" width="5" height="5" rx="1" />
    <rect x="9" y="2" width="5" height="5" rx="1" />
    <rect x="2" y="9" width="5" height="5" rx="1" />
    <rect x="9" y="9" width="5" height="5" rx="1" />
  </>,
);

/** 列表视图（三行，行首圆点）。 */
export const ListViewIcon = createHomeIcon(
  'ListViewIcon',
  <>
    <path d="M2.2 4h.01M2.2 8h.01M2.2 12h.01" />
    <path d="M5.5 4h8.3M5.5 8h8.3M5.5 12h8.3" />
  </>,
);

/** 时钟（「最近」分区）。 */
export const ClockIcon = createHomeIcon(
  'ClockIcon',
  <>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 4.6V8l2.4 1.6" />
  </>,
);

/** 文件夹（「本地文档」分区）。 */
export const FolderIcon = createHomeIcon(
  'FolderIcon',
  <path d="M2 4.4a1 1 0 0 1 1-1h3l1.4 1.8H13a1 1 0 0 1 1 1v5.4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />,
);

/** 星芒（AI 提示区）。 */
export const SparkleIcon = createHomeIcon(
  'SparkleIcon',
  <>
    <path d="M8 2.2 9.5 6.5 13.8 8 9.5 9.5 8 13.8 6.5 9.5 2.2 8 6.5 6.5z" />
    <path d="M12.6 2.6v1.6M11.8 3.4h1.6" />
  </>,
);

/** 模板（「从模板新建」菜单条目）。 */
export const TemplateIcon = createHomeIcon(
  'TemplateIcon',
  <>
    <rect x="2" y="2.4" width="12" height="11.2" rx="1.2" />
    <path d="M2 6.4h12M6.4 6.4v7.2" />
  </>,
);
