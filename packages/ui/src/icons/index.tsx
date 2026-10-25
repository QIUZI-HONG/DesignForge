/**
 * 图标工厂与图标集（@dforge/ui）。
 *
 * 口径（清单 §1.0 两套基准规范）：**16 画布 / 1.5 描边 / currentColor**（描边宽见 `ICON_STROKE_WIDTH`）；
 * 全部**自绘（clean-room）**——只用基础几何（直线、圆、圆弧、圆角矩形）组合，
 * 不复制任何第三方图标库的路径数据；形状细节按 B 级「视觉同族」人工复核
 * （验收标准 §2：图标几何/尺寸/描边/颜色为 A 级，形状细节为 B 级）。
 *
 * a11y 约定：默认**装饰性**（`aria-hidden`），此时必须由相邻文本或调用方给出名称；
 * 单独承载语义时传 `title`，图标变为 `role="img"` 具名图形。
 */
import type { ReactNode, SVGProps } from 'react';

import { PRIMITIVES } from '../tokens';

/** 描边宽（清单口径 1.5，位于 16 画布坐标内，随 viewBox 等比缩放）。 */
const ICON_STROKE_WIDTH = 1.5;

/** 图标 props：默认装饰性；`title` 给出后可访问名，`size` 覆盖边长。 */
export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children' | 'title'> {
  /** 边长（数值即 CSS 像素）；默认 16（`PRIMITIVES.iconSize.md`）。 */
  size?: number;
  /** 无障碍名称；给出后图标成为具名图形（`role="img"`）。 */
  title?: string;
}

/** 图标组件类型（带 displayName，便于调试与门禁列举）。 */
export interface IconComponent {
  (props: IconProps): ReactNode;
  displayName?: string;
}

/**
 * 由几何图形生成图标组件（统一注入画布/描边/语义属性）。
 *
 * 两个返回分支是刻意分开的：装饰性与具名图形在无障碍树上形状不同
 * （`aria-hidden` vs `role="img"` + `<title>`），静态可读，也便于门禁断言。
 *
 * @param displayName 组件名（也是预览页与门禁的列举名）
 * @param geometry 16×16 坐标系内的图形
 */
export function createIcon(displayName: string, geometry: ReactNode): IconComponent {
  function Icon({ size = PRIMITIVES.iconSize.md, title, ...rest }: IconProps) {
    const common: SVGProps<SVGSVGElement> = {
      viewBox: '0 0 16 16',
      width: size,
      height: size,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: ICON_STROKE_WIDTH,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      focusable: 'false',
      ...rest,
    };
    if (title === undefined) {
      return (
        <svg aria-hidden="true" {...common}>
          {geometry}
        </svg>
      );
    }
    return (
      <svg role="img" {...common}>
        <title>{title}</title>
        {geometry}
      </svg>
    );
  }
  Icon.displayName = displayName;
  return Icon;
}

// ---------------------------------------------------------------------------
// 导航与方向
// ---------------------------------------------------------------------------

/** 对勾（确认、选中、成功）。 */
export const CheckIcon = createIcon('CheckIcon', <path d="M3 8.5 6.3 11.8 13 4.2" />);

/** 下箭头（下拉、折叠）。 */
export const ChevronDownIcon = createIcon('ChevronDownIcon', <path d="M4 6.2 8 10.2 12 6.2" />);

/** 上箭头。 */
export const ChevronUpIcon = createIcon('ChevronUpIcon', <path d="M4 9.8 8 5.8 12 9.8" />);

/** 右箭头（进入、展开）。 */
export const ChevronRightIcon = createIcon('ChevronRightIcon', <path d="M6.2 4 10.2 8 6.2 12" />);

/** 左箭头（返回）。 */
export const ChevronLeftIcon = createIcon('ChevronLeftIcon', <path d="M9.8 4 5.8 8 9.8 12" />);

/** 四向移动（画布拖动）。 */
export const MoveIcon = createIcon(
  'MoveIcon',
  <>
    <path d="M8 2.4v11.2" />
    <path d="M2.4 8h11.2" />
    <path d="M6.2 4.2 8 2.4 9.8 4.2" />
    <path d="M6.2 11.8 8 13.6 9.8 11.8" />
    <path d="M4.2 6.2 2.4 8 4.2 9.8" />
    <path d="M11.8 6.2 13.6 8 11.8 9.8" />
  </>,
);

// ---------------------------------------------------------------------------
// 操作
// ---------------------------------------------------------------------------

/** 关闭（X）。 */
export const CloseIcon = createIcon(
  'CloseIcon',
  <>
    <path d="M4.2 4.2 11.8 11.8" />
    <path d="M11.8 4.2 4.2 11.8" />
  </>,
);

/** 新增（+）。 */
export const PlusIcon = createIcon(
  'PlusIcon',
  <>
    <path d="M8 3.6v8.8" />
    <path d="M3.6 8h8.8" />
  </>,
);

/** 移除（−）。 */
export const MinusIcon = createIcon('MinusIcon', <path d="M3.6 8h8.8" />);

/** 搜索（放大镜）。 */
export const SearchIcon = createIcon(
  'SearchIcon',
  <>
    <circle cx="7.2" cy="7.2" r="4.2" />
    <path d="M10.4 10.4 13.6 13.6" />
  </>,
);

/** 撤销（Toast 内嵌动作、命令栈撤销）。 */
export const UndoIcon = createIcon(
  'UndoIcon',
  <>
    <path d="M3.5 6.5h6.2a3.4 3.4 0 0 1 0 6.8H6.5" />
    <path d="M6.3 3.8 3.5 6.5 6.3 9.2" />
  </>,
);

/** 重试（错误态重试按钮）。 */
export const RefreshIcon = createIcon(
  'RefreshIcon',
  <>
    <path d="M13.4 8a5.4 5.4 0 1 1-1.9-4.1" />
    <path d="M13.6 2.6v3.2h-3.2" />
  </>,
);

/** 更多（横向省略号）。 */
export const MoreHorizontalIcon = createIcon(
  'MoreHorizontalIcon',
  <>
    <circle cx="3.6" cy="8" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="12.4" cy="8" r="1.1" fill="currentColor" stroke="none" />
  </>,
);

/** 删除（垃圾桶）。 */
export const TrashIcon = createIcon(
  'TrashIcon',
  <>
    <path d="M3.4 5.2h9.2" />
    <path d="M6.4 5.2V3.6h3.2v1.6" />
    <path d="M4.8 5.2l.8 8h4.8l.8-8" />
  </>,
);

/** 复制。 */
export const CopyIcon = createIcon(
  'CopyIcon',
  <>
    <rect x="5.6" y="5.6" width="7.8" height="7.8" rx="1.4" />
    <path d="M10.4 5.6V4a1.4 1.4 0 0 0-1.4-1.4H4A1.4 1.4 0 0 0 2.6 4v5A1.4 1.4 0 0 0 4 10.4h1.6" />
  </>,
);

/** 下载（导出）。 */
export const DownloadIcon = createIcon(
  'DownloadIcon',
  <>
    <path d="M8 2.6v7.4" />
    <path d="M5 7.4 8 10.4 11 7.4" />
    <path d="M3 13.2h10" />
  </>,
);

/** 铅笔（重命名）。 */
export const PencilIcon = createIcon(
  'PencilIcon',
  <path d="M3 13l.6-2.6 7.6-7.6a1.5 1.5 0 0 1 2.1 2.1L5.6 12.4Z" />,
);

// ---------------------------------------------------------------------------
// 状态与语义
// ---------------------------------------------------------------------------

/** 警告（三角）。 */
export const AlertTriangleIcon = createIcon(
  'AlertTriangleIcon',
  <>
    <path d="M8 2.4 14.6 13.6H1.4Z" />
    <path d="M8 6.4v3.1" />
    <circle cx="8" cy="11.7" r="0.5" fill="currentColor" stroke="none" />
  </>,
);

/** 错误（圆）。 */
export const AlertCircleIcon = createIcon(
  'AlertCircleIcon',
  <>
    <circle cx="8" cy="8" r="5.9" />
    <path d="M8 4.8v3.6" />
    <circle cx="8" cy="11.2" r="0.5" fill="currentColor" stroke="none" />
  </>,
);

/** 信息。 */
export const InfoIcon = createIcon(
  'InfoIcon',
  <>
    <circle cx="8" cy="8" r="5.9" />
    <path d="M8 7.4v3.8" />
    <circle cx="8" cy="4.9" r="0.5" fill="currentColor" stroke="none" />
  </>,
);

/** 成功（带对勾的圆）。 */
export const CheckCircleIcon = createIcon(
  'CheckCircleIcon',
  <>
    <circle cx="8" cy="8" r="5.9" />
    <path d="M5.2 8.3 7.2 10.3 10.8 6.2" />
  </>,
);

/** 可见（眼睛）。 */
export const EyeIcon = createIcon(
  'EyeIcon',
  <>
    <path d="M1.6 8S4.7 3.6 8 3.6 14.4 8 14.4 8 11.3 12.4 8 12.4 1.6 8 1.6 8Z" />
    <circle cx="8" cy="8" r="1.9" />
  </>,
);

/** 隐藏（闭眼）。 */
export const EyeOffIcon = createIcon(
  'EyeOffIcon',
  <>
    <path d="M6.4 4A6.8 6.8 0 0 1 8 3.8c3.3 0 6.4 4.2 6.4 4.2a13 13 0 0 1-2.3 2.6" />
    <path d="M4.1 5.3A13.2 13.2 0 0 0 1.6 8s3.1 4.2 6.4 4.2a6.4 6.4 0 0 0 2.7-.7" />
    <path d="M2.8 3 13.2 13" />
  </>,
);

/** 锁定（只读、禁用原因）。 */
export const LockIcon = createIcon(
  'LockIcon',
  <>
    <path d="M8 2.4A2.6 2.6 0 0 1 10.6 5v1.6H5.4V5A2.6 2.6 0 0 1 8 2.4Z" />
    <rect x="3.6" y="6.6" width="8.8" height="7" rx="1.6" />
  </>,
);

// ---------------------------------------------------------------------------
// 设计域（画布/图层/组件/框架/文本）
// ---------------------------------------------------------------------------

/** 图层（堆叠）。 */
export const LayersIcon = createIcon(
  'LayersIcon',
  <>
    <path d="M8 2.2 13.8 5.4 8 8.6 2.2 5.4Z" />
    <path d="M3 8.2 8 11 13 8.2" />
  </>,
);

/** 组件（四菱形，Figma 组件语义；颜色由调用方给组件紫）。 */
export const ComponentIcon = createIcon(
  'ComponentIcon',
  <>
    <path d="M8 1.8 10 3.9 8 6 6 3.9Z" />
    <path d="M8 10 10 12.1 8 14.2 6 12.1Z" />
    <path d="M3.4 5.9 5.5 8 3.4 10.1 1.3 8Z" />
    <path d="M12.6 5.9 14.7 8 12.6 10.1 10.5 8Z" />
  </>,
);

/** 框架（Frame，# 形井字）。 */
export const FrameIcon = createIcon(
  'FrameIcon',
  <>
    <path d="M5.6 2.2v11.6" />
    <path d="M10.4 2.2v11.6" />
    <path d="M2.2 5.6h11.6" />
    <path d="M2.2 10.4h11.6" />
  </>,
);

/** 文本（T）。 */
export const TextIcon = createIcon(
  'TextIcon',
  <>
    <path d="M4 3.6h8" />
    <path d="M8 3.6v8.8" />
    <path d="M6.2 12.4h3.6" />
  </>,
);

/** 空盒（空态插图底座）。 */
export const BoxIcon = createIcon(
  'BoxIcon',
  <>
    <path d="M2.4 5.6 8 2.6 13.6 5.6 8 8.6Z" />
    <path d="M2.4 5.6v4.8L8 13.4l5.6-3V5.6" />
    <path d="M8 8.6v4.8" />
  </>,
);

// ---------------------------------------------------------------------------
// 编辑器补全（RW-07：图层树 / Inspector / 命令面板；用词对齐 Figma 中文界面）
// ---------------------------------------------------------------------------

/** 拖拽把手（图层树行拖拽排序、Scrubber 抓手）。 */
export const GripIcon = createIcon(
  'GripIcon',
  <>
    <circle cx="5.8" cy="4" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="10.2" cy="4" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="5.8" cy="8" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="10.2" cy="8" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="5.8" cy="12" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="10.2" cy="12" r="1.1" fill="currentColor" stroke="none" />
  </>,
);

/** 矩形（图层类型）。 */
export const RectangleIcon = createIcon(
  'RectangleIcon',
  <rect x="2.6" y="3.4" width="10.8" height="9.2" rx="1.2" />,
);

/** 椭圆（图层类型；圆弧组合，横长纵短）。 */
export const EllipseIcon = createIcon(
  'EllipseIcon',
  <path d="M3 8a5 4.6 0 1 0 10 0a5 4.6 0 1 0 -10 0Z" />,
);

/** 多边形（图层类型，三角）。 */
export const PolygonIcon = createIcon('PolygonIcon', <path d="M8 3.2 13.2 12.4H2.8Z" />);

/** 直线（图层类型）。 */
export const LineIcon = createIcon('LineIcon', <path d="M2.8 13.2 13.2 2.8" />);

/** 图片（图层类型：相框 + 光点 + 山形）。 */
export const ImageIcon = createIcon(
  'ImageIcon',
  <>
    <rect x="2.4" y="3.2" width="11.2" height="9.6" rx="1.4" />
    <circle cx="5.8" cy="6.6" r="1.1" />
    <path d="M2.8 10.6 6.2 7.8 8.8 10 10.6 8.4 13.2 10.6" />
  </>,
);

/** 组（图层类型：虚线框——组是随内容收缩的容器）。 */
export const GroupIcon = createIcon(
  'GroupIcon',
  <rect x="2.6" y="2.6" width="10.8" height="10.8" rx="1.4" strokeDasharray="2.2 1.8" />,
);

/** 区块（图层类型：带标题条的大容器）。 */
export const SectionIcon = createIcon(
  'SectionIcon',
  <>
    <rect x="2.4" y="3.4" width="11.2" height="9.2" rx="1.2" />
    <path d="M2.4 6.6h11.2" />
  </>,
);

/** 吸管（取色器：ColorField / Inspector 取色）。 */
export const PipetteIcon = createIcon(
  'PipetteIcon',
  <>
    <path d="M10.2 2.8a2.1 2.1 0 0 1 3 3l-1.5 1.5-3-3Z" />
    <path d="M9.4 4.4 4 9.8a1.7 1.7 0 0 0-.5.8l-.5 1.9 1.9-.5a1.7 1.7 0 0 0 .8-.5l5.4-5.4" />
    <path d="M2.4 13.6l1.4-1.4" />
  </>,
);

/** 效果（四角星：投影/模糊/背景模糊分区）。 */
export const EffectsIcon = createIcon(
  'EffectsIcon',
  <path d="M8 2.4 9.4 6.6 13.6 8 9.4 9.4 8 13.6 6.6 9.4 2.4 8 6.6 6.6Z" />,
);

/** 回车（命令面板执行键提示）。 */
export const CornerDownLeftIcon = createIcon(
  'CornerDownLeftIcon',
  <>
    <path d="M12.6 3.4v4.2a1.6 1.6 0 0 1-1.6 1.6H3.4" />
    <path d="M6.6 6 3.4 9.2l3.2 3.2" />
  </>,
);

/** 键盘（快捷键速查卡）。 */
export const KeyboardIcon = createIcon(
  'KeyboardIcon',
  <>
    <rect x="1.8" y="4.4" width="12.4" height="7.2" rx="1.4" />
    <circle cx="4.2" cy="6.6" r="0.6" fill="currentColor" stroke="none" />
    <circle cx="6.3" cy="6.6" r="0.6" fill="currentColor" stroke="none" />
    <circle cx="8.4" cy="6.6" r="0.6" fill="currentColor" stroke="none" />
    <circle cx="10.5" cy="6.6" r="0.6" fill="currentColor" stroke="none" />
    <circle cx="12.4" cy="6.6" r="0.6" fill="currentColor" stroke="none" />
    <path d="M4.6 9.2h6.8" />
  </>,
);

/**
 * 图标注册表：预览页矩阵与门禁脚本按名列举（也是「图标集齐备」的唯一清单）。
 */
export const ICONS = {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ChevronRightIcon,
  ChevronLeftIcon,
  MoveIcon,
  CloseIcon,
  PlusIcon,
  MinusIcon,
  SearchIcon,
  UndoIcon,
  RefreshIcon,
  MoreHorizontalIcon,
  TrashIcon,
  CopyIcon,
  DownloadIcon,
  PencilIcon,
  AlertTriangleIcon,
  AlertCircleIcon,
  InfoIcon,
  CheckCircleIcon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  LayersIcon,
  ComponentIcon,
  FrameIcon,
  TextIcon,
  BoxIcon,
  GripIcon,
  RectangleIcon,
  EllipseIcon,
  PolygonIcon,
  LineIcon,
  ImageIcon,
  GroupIcon,
  SectionIcon,
  PipetteIcon,
  EffectsIcon,
  CornerDownLeftIcon,
  KeyboardIcon,
} satisfies Record<string, IconComponent>;

/** 图标名（注册表键）。 */
export type IconName = keyof typeof ICONS;
