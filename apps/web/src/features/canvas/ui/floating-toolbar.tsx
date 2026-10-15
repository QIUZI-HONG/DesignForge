'use client';

/**
 * C9 浮层工具条：**选中上方悬浮**、圆角 **13 胶囊**（`--dfg-radius-xl`）。
 *
 * 口径：
 * - 位置 = 选择集世界包围盒的屏幕位置（顶部中心，向上偏移一个间隙）；
 * - 条目与可用性来自 `ui/action-items.ts`（与 C11 菜单同源），图标复用 `@dforge/ui`，
 *   对齐/分布这类无图标动作走文字小按钮（图标几何归 FE-01，本票不另造）；
 * - 无选择时不渲染（Figma 口径：空选态没有浮层）。
 */

import {
  BoxIcon,
  CopyIcon,
  IconButton,
  LayersIcon,
  PencilIcon,
  PlusIcon,
  Tooltip,
  TrashIcon,
} from '@dforge/ui';
import type { ReactNode } from 'react';
import { useStore } from 'zustand';

import { t } from '@/i18n';

import type { CanvasSession } from '../state/session';
import { canvasActions, selectionInsight, TOOLBAR_ACTION_IDS } from './action-items';

/** 工具条 props。 */
export interface FloatingToolbarProps {
  session: CanvasSession;
}

/** 工具条上方间隙（屏幕 px）。 guard-tokens:allow 浮层与选择框的垂直偏移，属几何参数 */
const TOOLBAR_GAP = 12;

/** 图标动作的图标映射（无条目时不渲染）。 */
const ICON_BY_ACTION: Record<string, ReactNode> = {
  bringForward: <LayersIcon />,
  sendBackward: <LayersIcon />,
  group: <BoxIcon />,
  ungroup: <BoxIcon />,
  editText: <PencilIcon />,
  copy: <CopyIcon />,
  duplicate: <PlusIcon />,
  delete: <TrashIcon />,
};

/** 文字动作的短标签（对齐/分布用中文短词，tooltip 给全称）。 */
const TEXT_LABEL_KEY: Record<string, string> = {
  alignLeft: 'canvas.action.alignLeft',
  alignHCenter: 'canvas.action.alignHCenter',
  alignRight: 'canvas.action.alignRight',
  alignTop: 'canvas.action.alignTop',
  alignVCenter: 'canvas.action.alignVCenter',
  alignBottom: 'canvas.action.alignBottom',
  distributeHorizontal: 'canvas.action.distributeHorizontal',
  distributeVertical: 'canvas.action.distributeVertical',
};

/** 文字按钮的紧凑标签（tooltip 内给完整名称）。 */
const TEXT_SHORT: Record<string, string> = {
  alignLeft: '⇤',
  alignHCenter: '⇔',
  alignRight: '⇥',
  alignTop: '⇡',
  alignVCenter: '⇕',
  alignBottom: '⇣',
  distributeHorizontal: '⋯',
  distributeVertical: '⋮',
};

/** 浮层工具条。 */
export function FloatingToolbar({ session }: FloatingToolbarProps) {
  const viewport = useStore(session.store, (state) => state.viewport);
  const selection = useStore(session.store, (state) => state.selection);
  const bounds = session.selectionBounds();

  if (bounds === null || selection.ids.length === 0) return null;

  const insight = selectionInsight(session);
  const actions = canvasActions(session).filter((action) => TOOLBAR_ACTION_IDS.includes(action.id));

  const centerX = (bounds.x + bounds.width / 2) * viewport.zoom + viewport.panX;
  const topY = bounds.y * viewport.zoom + viewport.panY - TOOLBAR_GAP;
  const label =
    insight.count === 1
      ? (session.selectedNodes()[0]?.name ?? t('canvas.selection.count', { count: 1 }))
      : t('canvas.selection.count', { count: insight.count });

  return (
    <div
      className="dfc-canvas-toolbar"
      data-df-canvas-toolbar=""
      style={{ left: centerX, top: topY }}
      role="toolbar"
      aria-label={t('canvas.toolbar.label')}
    >
      <span className="dfc-canvas-toolbar__label">{label}</span>
      {actions.map((action) => {
        const textLabel = TEXT_LABEL_KEY[action.id];
        const icon = ICON_BY_ACTION[action.id];
        const title = `${t(action.labelKey)}${action.display === undefined ? '' : ` ${action.display}`}`;
        if (textLabel !== undefined) {
          return (
            <Tooltip key={action.id} content={title}>
              <button
                type="button"
                className="dfc-canvas-toolbar__text-btn"
                aria-label={t(textLabel)}
                disabled={action.disabled}
                data-df-canvas-action={action.id}
                onClick={action.run}
              >
                {TEXT_SHORT[action.id] ?? '—'}
              </button>
            </Tooltip>
          );
        }
        if (icon === undefined) return null;
        return (
          <Tooltip key={action.id} content={title}>
            <IconButton
              label={t(action.labelKey)}
              icon={icon}
              size="sm"
              variant={action.danger === true ? 'danger' : 'ghost'}
              disabled={action.disabled}
              data-df-canvas-action={action.id}
              onClick={action.run}
            />
          </Tooltip>
        );
      })}
    </div>
  );
}
