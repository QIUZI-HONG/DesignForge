'use client';

/**
 * 图层行的类型图标（画布 16 线性图标；图标集与颜色都取自 FE-01 设计系统）。
 *
 * 语义色口径：组件族（主组件/组件集/实例）用**组件紫**令牌 `--dfg-color-component`，
 * 其余类型用图标的次级前景色——与 Figma 图层面板的语义分色一致。
 */
import type { SceneNode } from '@dforge/engine';
import { BoxIcon, ComponentIcon, cssVar, FrameIcon, LayersIcon, TextIcon } from '@dforge/ui';
import type { ReactNode } from 'react';

/** 组件紫（实例用同一语义色的弱化表达：与主组件的区分靠行名与覆盖记号）。 */
const COMPONENT_COLOR = cssVar('color.component');
const ICON_COLOR = cssVar('color.icon-secondary');

/** 取节点的类型图标（已上色，直接渲染）。 */
export function layerTypeIcon(node: SceneNode): ReactNode {
  switch (node.type) {
    case 'frame':
      return <FrameIcon size={16} />;
    case 'text':
      return <TextIcon size={16} />;
    case 'group':
      return <LayersIcon size={16} />;
    case 'component':
    case 'component_set':
      return <ComponentIcon size={16} />;
    case 'instance':
      return <ComponentIcon size={16} />;
    default:
      return <BoxIcon size={16} />;
  }
}

/** 图标颜色：组件族走组件紫，其余走次级前景色。 */
export function layerTypeColor(node: SceneNode): string {
  return node.type === 'component' || node.type === 'component_set' || node.type === 'instance'
    ? COMPONENT_COLOR
    : ICON_COLOR;
}
