/**
 * 画布工作区自绘图标（修复批次 4 · 工作包 D1）。
 *
 * 为什么在画布目录里自绘而不是加进 `@dforge/ui`：`packages/ui` 的图标集归 FE-01 独占
 * （_shared §2 目录归属），AI 入口需要的星芒图标在 `features/home/icons.tsx` 已有一份
 * （首页 AI 提示区）；跨 feature 引图标文件属深导入（guard:feature-boundaries 禁止），
 * 按同一口径（16 画布 / 1.5 描边 / currentColor）在本目录自绘。
 */
import { createIcon } from '@dforge/ui';

/** 星芒（AI 助手入口）。 */
export const AiEntryIcon = createIcon(
  'AiEntryIcon',
  <>
    <path d="M8 2.2 9.4 6.6 13.8 8 9.4 9.4 8 13.8 6.6 9.4 2.2 8 6.6 6.6Z" />
    <path d="M12.6 2.4v2M11.6 3.4h2" />
  </>,
);
