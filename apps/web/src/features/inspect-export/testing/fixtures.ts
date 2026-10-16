/**
 * FE-08 检查 / 导出夹具（仅供本 feature 的测试与预览使用，不进公开面）。
 *
 * 与 `preview.ts` 同构（同一组节点让 jsdom 断言与浏览器门禁看到同一幕）：
 * - `card`：颜色与圆角都**绑定令牌**（brand / radius.card）→ 代码生成走 var() 分支；
 * - `plain`：填充**未绑定令牌** → 代码生成走原始值 + 回退提示分支；
 * - `title`：文本节点（字体/字号/字重/行高/对齐进代码）；
 * - `neighbor` / `frame`：与 `card` 形成可测的相邻间距（测量标注）。
 */

import {
  aliasToken,
  CommandStack,
  type CommandStackOptions,
  createComponent,
  createDocument,
  createFrame,
  createPage,
  createRect,
  createSelection,
  createText,
  type DesignDocument,
  defaultTextContent,
  type ScenePage,
  type Selection,
  solidPaint,
  type TokenSet,
  token,
} from '@dforge/engine';

/** 固定页面 id。 */
export const INSPECT_PAGE_ID = 'p1';

/** 夹具 id。 */
export const INSPECT_IDS = {
  card: 'card',
  plain: 'plain',
  title: 'title',
  neighbor: 'neighbor',
  frame: 'frame',
  /** 主组件（检查态也能落在组件上）。 */
  component: 'cmp',
} as const;

/** 令牌命中值（`card` 的填充 / 圆角）。 */
export const TOKEN_VALUES = {
  brand: '#0d99ff', // guard-tokens:allow 文档令牌值，非界面令牌
  radiusCard: 8,
} as const;

/** 未绑定值（文档数据色，非界面令牌）。 */
export const UNBOUND_FILL = '#abcdef'; // guard-tokens:allow 文档数据色，非界面令牌

/** 测量可测的间距：card 右边 24+240=264 → neighbor 左边 304，间隔 40。 */
export const MEASURED_GAP = 40;

/** 夹具令牌集（含别名链，验证「同一值多令牌取字典序最小路径」）。 */
export function inspectTokens(): TokenSet {
  return {
    color: {
      brand: token('color', TOKEN_VALUES.brand),
      brandAlias: aliasToken('color.brand', '别名链：与 brand 同值'),
    },
    radius: {
      card: token('dimension', TOKEN_VALUES.radiusCard),
    },
  };
}

/** 夹具页面。 */
export function inspectPage(): ScenePage {
  const card = createRect({
    id: INSPECT_IDS.card,
    name: '卡片',
    x: 24,
    y: 32,
    width: 240,
    height: 160,
    fills: [solidPaint(TOKEN_VALUES.brand)],
    cornerRadius: TOKEN_VALUES.radiusCard,
  });
  const neighbor = createRect({
    id: INSPECT_IDS.neighbor,
    name: '相邻块',
    x: 24 + 240 + MEASURED_GAP,
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
    text: { ...defaultTextContent('设界 DesignForge'), fontSize: 16, fontWeight: 500 }, // guard-tokens:allow fontSize 是文档数据（Design IR 文本真值）
  });
  const frame = createFrame({
    id: INSPECT_IDS.frame,
    name: '画板',
    x: 0,
    y: 0,
    width: 560,
    height: 480,
    children: [],
  });
  const component = createComponent({
    id: INSPECT_IDS.component,
    name: '卡片组件',
    x: 320,
    y: 240,
    width: 120,
    height: 80,
  });

  return createPage({
    id: INSPECT_PAGE_ID,
    name: '主页面',
    nodes: {
      card,
      neighbor,
      plain,
      title,
      frame,
      cmp: component,
    },
    rootIds: ['frame', 'card', 'neighbor', 'plain', 'title', 'cmp'],
    backgroundColor: '#1e1e1e', // guard-tokens:allow 文档数据色，非界面令牌
  });
}

/** 夹具文档（令牌齐备）。 */
export function inspectDocument(): DesignDocument {
  return createDocument({
    id: 'doc_inspect',
    name: '检查导出夹具',
    pages: [inspectPage()],
    tokens: inspectTokens(),
  });
}

/** 构造夹具命令栈（默认冻结）。 */
export function inspectStack(options: CommandStackOptions = {}): CommandStack {
  return new CommandStack(inspectDocument(), { freeze: true, ...options });
}

/** 便捷选择集。 */
export function inspectSelection(ids: readonly string[], activeId?: string): Selection {
  return createSelection(ids, activeId);
}
