/**
 * 三态预览预设（FE-05 ⇄ 宿主页面接口，供浏览器门禁与人工预览共用）。
 *
 * 为什么放在公开面：`scripts/verify-figma-inspector.mjs` 需要「默认/混选/空选」三态
 * 可复现且**与 jsdom 测试同源**的夹具——宿主页面（编辑器路由，FE-06 接线）按
 * `?df-state=default|mixed|empty` 取这里的选择集与文档即可，三处口径不再各自漂移。
 *
 * 选择集口径：
 * - `default`：单选带文本的节点（四个分区都能渲染，C5 对照面）；
 * - `mixed`：多选两个宽度相同、x 不同的矩形（C6 混选「—」对照面）；
 * - `empty`：空选（C7 画布设置对照面）。
 */

import {
  createDocument,
  createPage,
  createRect,
  createSelection,
  createText,
  type DesignDocument,
  defaultTextContent,
  type Selection,
  solidPaint,
} from '@dforge/engine';

/** 预览页面 id（宿主断言与门禁共用）。 */
export const PREVIEW_PAGE_ID = 'p1';

/** 三态状态名（与门禁 `?df-state=` 取值一致）。 */
export const INSPECTOR_PREVIEW_STATES = ['default', 'mixed', 'empty'] as const;

/** 三态状态名类型。 */
export type InspectorPreviewState = (typeof INSPECTOR_PREVIEW_STATES)[number];

/** 预设的选择集（对应 `createPreviewDocument()` 的节点 id）。 */
export function previewSelection(state: InspectorPreviewState): Selection {
  switch (state) {
    case 'default':
      return createSelection(['pv_text']);
    case 'mixed':
      return createSelection(['pv_rect_a', 'pv_rect_b']);
    case 'empty':
      return createSelection([]);
  }
}

/**
 * 构造预览文档：节点集与 `testing/fixtures.ts` 同构（文本 + 两个混值矩形 + 画板）。
 * 深色编辑器族页面只改 `data-theme`，文档数据不变。
 */
export function createPreviewDocument(): DesignDocument {
  const rectA = createRect({
    id: 'pv_rect_a',
    x: 24,
    y: 24,
    width: 100,
    height: 64,
    // 文档数据色（Design IR 填充真值，非界面令牌）
    fills: [solidPaint('#111111', 0.5)], // guard-tokens:allow 文档数据色，非界面令牌
  });
  const rectB = createRect({
    id: 'pv_rect_b',
    x: 180,
    y: 24,
    width: 100,
    height: 64,
    fills: [solidPaint('#222222')], // guard-tokens:allow 文档数据色，非界面令牌
  });
  const text = createText({
    id: 'pv_text',
    // 字号是文档数据（Design IR 文本真值），不是界面令牌
    text: { ...defaultTextContent('设界 DesignForge'), fontSize: 16 }, // guard-tokens:allow 文档数据
  });
  const page = createPage({
    id: PREVIEW_PAGE_ID,
    name: '预览页面',
    nodes: { pv_rect_a: rectA, pv_rect_b: rectB, pv_text: text },
    rootIds: ['pv_rect_a', 'pv_rect_b', 'pv_text'],
    backgroundColor: '#F5F5F5', // guard-tokens:allow 文档数据色，非界面令牌
  });
  return createDocument({ id: 'doc_inspector_preview', name: 'Inspector 预览', pages: [page] });
}
