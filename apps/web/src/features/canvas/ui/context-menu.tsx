'use client';

/**
 * C11 画布右键菜单：条目 **32 高** + 快捷键**右对齐**。
 *
 * 复用口径（简报 §2 点名要求）：菜单本体用 FE-01 的 `DropdownMenu`
 * （键盘漫游/外侧关闭/Esc 归位/禁用语义都在组件里），本组件只负责
 * ①把指针位置换算成菜单锚点、②把条目高度口径钉到舒适档 32（C11 对标要点）——
 * 编辑器族默认密度是紧凑档 28，因此这里显式覆盖 `--dfg-row-height-md` 为
 * 令牌常量 `DENSITY.comfortable.rowHeight.md`（覆盖的是令牌值，不是裸值）。
 *
 * 关闭：菜单组件在「点击外侧」时自行收起；父层（CanvasStage）负责在这次交互后
 * 卸载菜单壳（监听 document mousedown 即可，无需菜单组件回传事件）。
 */

import { DENSITY, DropdownMenu } from '@dforge/ui';
import type { CSSProperties } from 'react';

import { t } from '@/i18n';

import type { CanvasSession } from '../state/session';
import { contextMenuSections } from './action-items';

/** 菜单 props。 */
export interface CanvasContextMenuProps {
  session: CanvasSession;
  /** 打开位置（容器内 CSS 像素）。 */
  point: { x: number; y: number };
  /** 打开序号（每次右键 +1：重挂载菜单以获得全新展开态）。 */
  epoch: number;
}

/** C11 右键菜单。 */
export function CanvasContextMenu({ session, point, epoch }: CanvasContextMenuProps) {
  const style: CSSProperties = {
    left: point.x,
    top: point.y,
    // C11：条目 32 高（舒适档），覆盖编辑器默认的紧凑档 28
    ['--dfg-row-height-md' as string]: `${DENSITY.comfortable.rowHeight.md}px`,
  };

  return (
    <div className="dfc-canvas-menu" style={style} data-df-canvas-context-menu="">
      <DropdownMenu
        key={epoch}
        label={t('canvas.menu.label')}
        sections={contextMenuSections(session, t)}
        defaultOpen
        align="start"
        tooltipDelay={0}
        trigger={(state) => (
          <button
            {...state.triggerProps}
            className="dfc-canvas-menu__anchor"
            aria-label={t('canvas.menu.label')}
            tabIndex={-1}
          />
        )}
      />
    </div>
  );
}
