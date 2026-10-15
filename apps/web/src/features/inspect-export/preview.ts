/**
 * C15 / F6 预览预设（FE-08 ⇄ 宿主页面接口，供浏览器门禁与人工预览共用）。
 *
 * 与 `testing/fixtures.ts` 同构（同一组节点、同一份令牌表），宿主页面按
 * `?df-inspect=<state>` 取这里的文档与选择集，浏览器门禁据此逐态取证：
 * - `bound`：颜色/圆角都绑定令牌 + 有相邻对象（三区齐备、令牌说明全命中）；
 * - `unbound`：填充未绑定令牌（回退提示分支）；
 * - `empty`：空选（空态）。
 */

import {
  CommandStack,
  createDocument,
  createPage,
  createRect,
  createSelection,
  createText,
  type DesignDocument,
  defaultTextContent,
  type NodeId,
  type ScenePage,
  type Selection,
  solidPaint,
  type TokenSet,
} from '@dforge/engine';

import { INSPECT_IDS, inspectTokens, UNBOUND_FILL } from './testing/fixtures';

/** 预览页面 id（宿主断言与门禁共用）。 */
export const INSPECT_PREVIEW_PAGE_ID = 'p1';

/** 预览状态名（与门禁 `?df-inspect=` 取值一致）。 */
export const INSPECT_PREVIEW_STATES = ['bound', 'unbound', 'empty'] as const;

/** 预览状态名类型。 */
export type InspectPreviewState = (typeof INSPECT_PREVIEW_STATES)[number];

/** 预设选择集。 */
export function previewSelection(state: InspectPreviewState): Selection {
  switch (state) {
    case 'bound':
      return createSelection([INSPECT_IDS.card]);
    case 'unbound':
      return createSelection([INSPECT_IDS.plain]);
    case 'empty':
      return createSelection([]);
  }
}

/**
 * 构造预览文档（三态共用同一份节点，只是选择集不同——保证「同一屏换状态」的可比性）。
 * 深色编辑器族：宿主页面把 `<html data-theme>` 设为 `dark`。
 */
export function createInspectPreviewDocument(): DesignDocument {
  const page = previewPage();
  return createDocument({
    id: 'doc_inspect_preview',
    name: '检查导出预览',
    pages: [page],
    tokens: previewTokens(),
  });
}

/** 预览命令栈（宿主与门禁取同一份初始文档）。 */
export function createInspectPreviewStack(): CommandStack {
  return new CommandStack(createInspectPreviewDocument(), { freeze: true });
}

/** 预览令牌集（与测试夹具同源）。 */
export function previewTokens(): TokenSet {
  return inspectTokens();
}

/** 预览页面（节点与 `testing/fixtures.ts` 同构）。 */
function previewPage(): ScenePage {
  const card = createRect({
    id: INSPECT_IDS.card,
    name: '卡片',
    x: 24,
    y: 32,
    width: 240,
    height: 160,
    fills: [solidPaint('#0d99ff')], // guard-tokens:allow 文档数据色，非界面令牌
    cornerRadius: 8,
  });
  const neighbor = createRect({
    id: INSPECT_IDS.neighbor,
    name: '相邻块',
    x: 304,
    y: 32,
    width: 120,
    height: 160,
  });
  const plain = createRect({
    id: INSPECT_IDS.plain,
    name: '未绑定块',
    x: 24,
    y: 240,
    width: 120,
    height: 80,
    fills: [solidPaint(UNBOUND_FILL)],
  });
  const title = createText({
    id: INSPECT_IDS.title,
    name: '标题',
    x: 24,
    y: 360,
    width: 240,
    height: 24,
    text: { ...defaultTextContent('设界 DesignForge'), fontSize: 16, fontWeight: 500 },
  });
  const frame = createRect({
    id: INSPECT_IDS.frame,
    name: '底板',
    x: 0,
    y: 0,
    width: 560,
    height: 480,
  });

  const nodes: Record<NodeId, ReturnType<typeof createRect> | typeof title> = {
    [card.id]: card,
    [neighbor.id]: neighbor,
    [plain.id]: plain,
    [title.id]: title,
    [frame.id]: frame,
  };
  return createPage({
    id: INSPECT_PREVIEW_PAGE_ID,
    name: '检查预览',
    nodes,
    rootIds: [frame.id, card.id, neighbor.id, plain.id, title.id],
    backgroundColor: '#1e1e1e', // guard-tokens:allow 文档数据色，非界面令牌
  });
}
