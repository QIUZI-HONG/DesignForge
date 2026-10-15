'use client';

/**
 * 图层右键菜单（C3 右键：重命名 / 删除 / 编组 / 解组 / 上移到顶 / 下移到底）。
 *
 * 复用设计系统的下拉菜单（FE-01）：条目高、分组分隔线、键盘漫游、Esc 关闭与点击外关闭
 * 都是既有行为；本组件只负责「定位到指针处」与「条目 → 命令」的映射。
 * 定位用 `position: fixed` + 指针坐标（几何计算，允许写裸数值）。
 */
import { findPage, type NodeId } from '@dforge/engine';
import {
  BoxIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  DropdownMenu,
  LayersIcon,
  type MenuItemSpec,
  PencilIcon,
  TrashIcon,
} from '@dforge/ui';
import { type CSSProperties, type ReactNode, useEffect, useRef } from 'react';

import { t } from '@/i18n';

import { type LayerMenuActionId, layerContextMenu } from '../commands/layer-menu';
import { usePanelsDocument, usePanelsUi } from '../state/hooks';
import { usePanelsSession } from './panels-context';

/** 菜单动作 → 图标（与条目语义对齐）。 */
const ACTION_ICONS: Record<LayerMenuActionId, ReactNode> = {
  rename: <PencilIcon size={16} />,
  delete: <TrashIcon size={16} />,
  group: <BoxIcon size={16} />,
  ungroup: <LayersIcon size={16} />,
  bringToFront: <ChevronUpIcon size={16} />,
  sendToBack: <ChevronDownIcon size={16} />,
};

/** 右键菜单 props。 */
export interface LayerContextMenuProps {
  /** 被右键的行（调用方已在右键时把它并入选择集）。 */
  rowId: NodeId;
  /** 指针位置（视口坐标）。 */
  position: { x: number; y: number };
  onClose: () => void;
}

/** 图层右键菜单。 */
export function LayerContextMenu({ rowId, position, onClose }: LayerContextMenuProps) {
  const session = usePanelsSession();
  const doc = usePanelsDocument(session);
  const selection = usePanelsUi(session, (state) => state.selection);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // 点击菜单外 / Esc 关闭（DropdownMenu 内部也会关，外层状态得同步收回）
  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      if (containerRef.current?.contains(event.target as Node) === true) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  const page = findPage(doc, session.pageId);
  if (page === undefined) return null;
  const entries = layerContextMenu(page, session.pageId, rowId, selection);

  const items: MenuItemSpec[] = entries.map((entry) => ({
    id: entry.id,
    label: t(entry.labelKey),
    icon: ACTION_ICONS[entry.id],
    ...(entry.shortcut === undefined ? {} : { shortcut: entry.shortcut }),
    disabled: entry.disabled,
    ...(entry.disabledReasonKey === undefined
      ? {}
      : { disabledReason: t(entry.disabledReasonKey) }),
    ...(entry.danger === true ? { danger: true } : {}),
    onSelect: () => {
      if (entry.id === 'rename') {
        // 重命名是 UI 手势（内联输入框），不是一次性命令
        session.ui.getState().beginRename(rowId);
        onClose();
        return;
      }
      session.run(entry.commands, t(entry.historyKey));
      onClose();
    },
  }));

  const wrapperStyle: CSSProperties = {
    position: 'fixed',
    left: position.x,
    top: position.y,
    zIndex: 'var(--dfg-z-dropdown)',
  };

  return (
    <div ref={containerRef} style={wrapperStyle} data-df-sample="layers/menu-open">
      {/* 触发器不渲染：菜单由右键唤起，位置由外层 fixed 容器决定 */}
      <DropdownMenu
        label={t('panels.menu.label')}
        sections={[{ id: 'layer', items }]}
        defaultOpen
        tooltipDelay={0}
        trigger={() => null}
      />
    </div>
  );
}
