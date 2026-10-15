'use client';

/**
 * 对齐/分布图标（C6 对齐工具行；clean-room 自绘：16 画布、currentColor、1.5 描边）。
 *
 * 复用 `@dforge/ui` 的图标工厂（同一套画布与描边口径），但形状是本 feature 自有的：
 * 六个对齐档 + 两个分布档，与 Figma 工具行的语义一一对应。
 */

import { createIcon } from '@dforge/ui';

/** 左对齐：左基准线 + 两条左贴齐的横条。 */
export const AlignLeftIcon = createIcon(
  'AlignLeftIcon',
  <>
    <path d="M3 3v10" />
    <path d="M4 5h8v2H4z" />
    <path d="M4 9h5v2H4z" />
  </>,
);

/** 水平居中：中线 + 两条居中的横条。 */
export const AlignHCenterIcon = createIcon(
  'AlignHCenterIcon',
  <>
    <path d="M8 3v10" />
    <path d="M4 5h8v2H4z" />
    <path d="M5.5 9h5v2h-5z" />
  </>,
);

/** 右对齐：右基准线 + 两条右贴齐的横条。 */
export const AlignRightIcon = createIcon(
  'AlignRightIcon',
  <>
    <path d="M13 3v10" />
    <path d="M4 5h8v2H4z" />
    <path d="M7 9h5v2H7z" />
  </>,
);

/** 顶对齐：顶基准线 + 两条上贴齐的竖条。 */
export const AlignTopIcon = createIcon(
  'AlignTopIcon',
  <>
    <path d="M3 3h10" />
    <path d="M5 4h2v8H5z" />
    <path d="M9 4h2v5H9z" />
  </>,
);

/** 垂直居中：中线 + 两条居中的竖条。 */
export const AlignVCenterIcon = createIcon(
  'AlignVCenterIcon',
  <>
    <path d="M3 8h10" />
    <path d="M5 4h2v8H5z" />
    <path d="M9 5.5h2v5H9z" />
  </>,
);

/** 底对齐：底基准线 + 两条下贴齐的竖条。 */
export const AlignBottomIcon = createIcon(
  'AlignBottomIcon',
  <>
    <path d="M3 13h10" />
    <path d="M5 4h2v8H5z" />
    <path d="M9 7h2v5H9z" />
  </>,
);

/** 水平分布：三条等距竖条。 */
export const DistributeHorizontalIcon = createIcon(
  'DistributeHorizontalIcon',
  <>
    <path d="M3 4v8" />
    <path d="M7 4v8" />
    <path d="M11 4v8" />
  </>,
);

/** 垂直分布：三条等距横条。 */
export const DistributeVerticalIcon = createIcon(
  'DistributeVerticalIcon',
  <>
    <path d="M4 3h8" />
    <path d="M4 7h8" />
    <path d="M4 11h8" />
  </>,
);
