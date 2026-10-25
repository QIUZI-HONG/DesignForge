'use client';

/**
 * 图层行的类型图标（画布 16 线性图标；图标集取自 FE-01 设计系统）。
 *
 * 语义色口径（工单 06 起由 CSS 承接）：组件族（主组件/组件集/实例）用**组件紫**令牌
 * `--dfg-color-component`，其余类型用图标的次级前景色——见 `editor-panels.css` 的
 * `.dfg-panels__layer-type-icon[data-df-layer-type=…]` 规则（组件落 `data-df-layer-type`）。
 */
import type { SceneNode } from '@dforge/engine';
import { BoxIcon, ComponentIcon, FrameIcon, LayersIcon, TextIcon } from '@dforge/ui';
import type { ReactNode } from 'react';

/** 取节点的类型图标（直接渲染，着色由 CSS 按类型挂点承接）。 */
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
