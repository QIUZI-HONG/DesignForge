'use client';

/**
 * C9 浮层工具条：**选中上方悬浮**、圆角 **13 胶囊**（`--dfg-radius-xl`）。
 *
 * 口径：
 * - 位置 = 选择集世界包围盒的屏幕位置（顶部中心，向上偏移一个间隙）；
 *   位置由**文档快照订阅**驱动（`useSyncExternalStore` 接命令栈，与 TextOverlay 同法）——
 *   提交 move / 撤销 / Inspector 改值后位置即时正确（票 10 · 报告 §E2）；
 * - 条目与可用性来自 `ui/action-items.ts`（与 C11 菜单同源），图标复用 `@dforge/ui`，
 *   对齐/分布这类无图标动作走文字小按钮（图标几何归 FE-01，本票不另造）；
 * - 无选择时不渲染（Figma 口径：空选态没有浮层）。
 */

import { selectionBounds } from '@dforge/engine';
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
import { useSyncExternalStore } from 'react';
import { useStore } from 'zustand';

import { t } from '@/i18n';
import { UNAVAILABLE_PLACEHOLDER } from '@/lib/unavailable';
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
  const pageId = useStore(session.store, (state) => state.pageId);
  // 文档真值在命令栈里：与同目录 TextOverlay 同法接 useSyncExternalStore（票 10 · 报告 §E2）。
  // 提交 move / 撤销重做 / Inspector 改值都只写命令栈，不改 viewport/selection 两个 UI 切片——
  // 只订阅这两切片时浮层会停在拖动前坐标；订阅文档快照后每次命令栈写入都驱动重渲。
  const documentSnapshot = useSyncExternalStore(
    (listener) => session.stack.subscribe(() => listener()),
    () => session.stack.getSnapshot(),
    () => session.stack.getSnapshot(),
  );

  // 位置从**订阅到的快照**派生（页面 + 选择集 + 视口都是订阅输入），不读会话的活值：
  // 保证重渲输出与触发它的事件一致（文档快照 → 包围盒 → 屏幕坐标）。
  const page = documentSnapshot.pages.find((candidate) => candidate.id === pageId);
  const bounds = page === undefined ? null : selectionBounds(page, selection);

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
                {TEXT_SHORT[action.id] ?? UNAVAILABLE_PLACEHOLDER}
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
