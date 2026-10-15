'use client';

/**
 * 图层行（C3）：箭头 / 类型图标 / 名称（可内联重命名）/ 眼睛 / 锁。
 *
 * 交互口径（清单 C3）：行高 28（深色编辑器族，令牌 `--dfg-row-height-md`）、缩进 12/级；
 * 单击选中（Shift 加选）、双击重命名（Enter 提交 / Esc 取消 / 失焦提交）、
 * 右键出菜单、拖动排序（指针序列由面板统一处理，本组件只报 pointerdown）。
 * 悬停态用本地 state 表达（不惊动面板），并把结果投射到 `data-df-state`
 * ——截图门禁要能对「hover / 选中 / 禁用」逐态取样（验收标准 §5）。
 */
import type { NodeId } from '@dforge/engine';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  EyeIcon,
  EyeOffIcon,
  IconButton,
  LockIcon,
} from '@dforge/ui';
import { type CSSProperties, type KeyboardEvent, type PointerEvent, useRef, useState } from 'react';

import { t } from '@/i18n';
import { layerTypeColor, layerTypeIcon } from './layer-icons';
import type { LayerRowModel } from './layer-rows';
import { layerRowStateStyles, layerRowStyles } from './styles';

/** 拖拽落点指示：行的上缘 / 下缘画线，行内（放入容器）画内描边。 */
export type DropEdge = 'top' | 'bottom' | 'inside';

/** 图层行 props（纯展示 + 事件回传：状态与命令都在面板/会话层）。 */
export interface LayerRowProps {
  row: LayerRowModel;
  /** 键盘漫游焦点目标（roving tabindex：只有它为 0，其余 -1）。 */
  focused: boolean;
  /** 最近一次交互来自键盘（决定是否画焦点环——鼠标点击只出选中底，不出环）。 */
  keyboardFocus: boolean;
  renaming: boolean;
  dropEdge: DropEdge | null;
  dragging: boolean;
  registerRef: (id: NodeId, element: HTMLDivElement | null) => void;
  onPointerDown: (id: NodeId, event: PointerEvent<HTMLDivElement>) => void;
  onActivate: (id: NodeId, modifiers: { shift: boolean; meta: boolean }) => void;
  onKeyDown: (id: NodeId, event: KeyboardEvent<HTMLDivElement>) => void;
  onToggleCollapsed: (id: NodeId) => void;
  onToggleVisibility: (id: NodeId) => void;
  onToggleLock: (id: NodeId) => void;
  onBeginRename: (id: NodeId) => void;
  onCommitRename: (id: NodeId, name: string) => void;
  onCancelRename: () => void;
  onContextMenu: (id: NodeId, position: { x: number; y: number }) => void;
}

/** 一行的完整实现（无 memo：状态变化本来就整面板重算，行内 hover 才是热路径）。 */
export function LayerRow(props: LayerRowProps) {
  const { row } = props;
  const [hovered, setHovered] = useState(false);
  const [domFocused, setDomFocused] = useState(false);
  const dimmed = !row.node.visible || row.hiddenByAncestor;
  const showActions = hovered || row.selected || !row.node.visible || row.node.locked;

  const typeLabel = t(`panels.layerType.${row.node.type}`);
  const rowStyle: CSSProperties = {
    ...layerRowStyles.row,
    // 行深由 CSS 变量喂给缩进算式（单位来自令牌，见 styles.ts）
    ['--dfg-layer-depth' as string]: String(row.depth),
    ...(row.selected ? layerRowStateStyles.selected : hovered ? layerRowStateStyles.hover : null),
    ...(domFocused && props.keyboardFocus ? layerRowStateStyles.focusRing : null),
    ...(props.dropEdge === 'inside' ? layerRowStateStyles.inside : null),
    ...(props.dragging ? layerRowStateStyles.dimmed : null),
  } as CSSProperties;

  return (
    <div
      ref={(element) => {
        props.registerRef(row.id, element);
      }}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-selected={row.selected}
      aria-expanded={row.container ? !row.collapsed : undefined}
      aria-label={t('panels.layers.row.label', { name: row.node.name, type: typeLabel })}
      tabIndex={props.focused ? 0 : -1}
      data-df-layer-row={row.id}
      data-depth={row.depth}
      data-df-state={row.selected ? 'selected' : hovered ? 'hover' : 'default'}
      data-df-focus={domFocused ? 'true' : 'false'}
      data-df-drop-indicator={props.dropEdge ?? undefined}
      data-df-dragging={props.dragging ? 'true' : undefined}
      style={rowStyle}
      onMouseEnter={() => {
        setHovered(true);
      }}
      onMouseLeave={() => {
        setHovered(false);
      }}
      onFocus={() => {
        setDomFocused(true);
      }}
      onBlur={() => {
        setDomFocused(false);
      }}
      onClick={(event) => {
        props.onActivate(row.id, { shift: event.shiftKey, meta: event.metaKey });
      }}
      onDoubleClick={() => {
        if (!row.readOnly) props.onBeginRename(row.id);
      }}
      onPointerDown={(event) => {
        props.onPointerDown(row.id, event);
      }}
      onKeyDown={(event) => {
        props.onKeyDown(row.id, event);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        props.onContextMenu(row.id, { x: event.clientX, y: event.clientY });
      }}
    >
      {props.dropEdge === 'top' ? <span style={layerRowStyles.indicatorTop} /> : null}
      {row.container ? (
        <IconButton
          size="sm"
          label={
            row.collapsed
              ? t('panels.layers.expand', { name: row.node.name })
              : t('panels.layers.collapse', { name: row.node.name })
          }
          icon={row.collapsed ? <ChevronRightIcon size={12} /> : <ChevronDownIcon size={12} />}
          onClick={() => {
            props.onToggleCollapsed(row.id);
          }}
        />
      ) : (
        <span aria-hidden style={{ width: 'var(--dfg-icon-size-sm)' }} />
      )}

      <span aria-hidden style={{ color: layerTypeColor(row.node), display: 'inline-flex' }}>
        {layerTypeIcon(row.node)}
      </span>

      {props.renaming ? (
        <RenameInput
          row={row}
          onCommit={(name) => {
            props.onCommitRename(row.id, name);
          }}
          onCancel={() => {
            props.onCancelRename();
          }}
        />
      ) : (
        <span
          style={{
            ...layerRowStyles.name,
            ...(dimmed ? layerRowStateStyles.dimmed : null),
            ...(row.active ? { fontWeight: 'var(--dfg-font-weight-medium)' } : null),
          }}
        >
          {row.node.name}
          {row.overridden ? (
            <span
              title={t('panels.layers.overridden')}
              data-df-overridden="true"
              style={{ marginLeft: 'var(--dfg-space-1)', color: 'var(--dfg-color-text-secondary)' }}
            >
              •
            </span>
          ) : null}
        </span>
      )}

      {showActions ? (
        <span style={layerRowStyles.actions}>
          <IconButton
            size="sm"
            label={
              row.node.visible
                ? t('panels.layers.hide', { name: row.node.name })
                : t('panels.layers.show', { name: row.node.name })
            }
            icon={row.node.visible ? <EyeIcon size={12} /> : <EyeOffIcon size={12} />}
            disabled={row.lockedByAncestor}
            {...(row.lockedByAncestor
              ? { disabledReason: t('panels.layers.lockedByAncestor') }
              : {})}
            onClick={() => {
              props.onToggleVisibility(row.id);
            }}
            // 双击行会进重命名——按钮上的双击不该冒泡上来
            onDoubleClick={(event) => {
              event.stopPropagation();
            }}
          />
          <IconButton
            size="sm"
            label={
              row.node.locked
                ? t('panels.layers.unlock', { name: row.node.name })
                : t('panels.layers.lock', { name: row.node.name })
            }
            icon={<LockIcon size={12} />}
            pressed={row.node.locked}
            disabled={row.lockedByAncestor}
            {...(row.lockedByAncestor
              ? { disabledReason: t('panels.layers.lockedByAncestor') }
              : {})}
            onClick={() => {
              props.onToggleLock(row.id);
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
            }}
          />
        </span>
      ) : null}
      {props.dropEdge === 'bottom' ? <span style={layerRowStyles.indicatorBottom} /> : null}
    </div>
  );
}

/**
 * 内联重命名输入框。
 * 提交语义：Enter 提交、Esc 取消、失焦提交（与 C10 文本内联编辑的「失焦提交」一致）；
 * 取消后紧跟的 blur 不再提交（`cancelled` 旗标）。
 */
function RenameInput({
  row,
  onCommit,
  onCancel,
}: {
  row: LayerRowModel;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const cancelled = useRef(false);
  return (
    <input
      type="text"
      className="dfg-input"
      aria-label={t('panels.layers.renameInput')}
      defaultValue={row.node.name}
      style={layerRowStyles.input}
      // biome-ignore lint/a11y/noAutofocus: 双击进入重命名后焦点必须落在输入框（Figma 同款交互）
      autoFocus
      onFocus={(event) => {
        event.currentTarget.select();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          onCommit(event.currentTarget.value);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          cancelled.current = true;
          onCancel();
        }
        // 行级键盘漫游不应吃掉输入框的按键
        event.stopPropagation();
      }}
      onBlur={(event) => {
        if (cancelled.current) {
          cancelled.current = false;
          return;
        }
        onCommit(event.currentTarget.value);
      }}
    />
  );
}
