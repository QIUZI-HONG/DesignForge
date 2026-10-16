/**
 * FE-08 组件夹具（仅供本 feature 的测试与预览使用，不进公开面）。
 *
 * 夹具与 `preview.ts` 的预览文档**同构**：同一组节点让 jsdom 断言与浏览器门禁看到同一幕，
 * 避免「测试绿而门禁红」的口径漂移。节点覆盖 C17 的四种角色：
 * - 普通节点（同父级 / 跨父级）→「创建组件」的可用性与前置校验；
 * - 主组件（带子节点）→ 主 ↔ 实例提示、创建实例；
 * - 实例（带覆盖）→ 覆盖清单与重置、变体切换；
 * - 组件集（两个变体）→ 变体切换下拉。
 */

import {
  aliasToken,
  CommandStack,
  type CommandStackOptions,
  createComponent,
  createComponentSet,
  createDocument,
  createFrame,
  createInstance,
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
  token,
} from '@dforge/engine';

/** 固定页面 id。 */
export const FIXTURE_PAGE_ID = 'p1';

/** 固定 id（测试断言直接引用；引擎命令用注入的确定性 id 工厂保持可复现）。 */
export const FIXTURE_IDS = {
  /** 画板（r1/r2 的父级）。 */
  frame: 'f1',
  /** 画板内矩形（与 r2 同父级 → 可创建组件）。 */
  rectInFrame: 'r1',
  /** 画板内矩形 2。 */
  rectInFrame2: 'r2',
  /** 顶层矩形（与 r1/r2 不同父级 → 不可创建组件）。 */
  rectTop: 'r3',
  /** 主组件（子节点：按钮底 + 文本）。 */
  component: 'cmp1',
  /** 主组件内矩形。 */
  componentRect: 'cmp1_bg',
  /** 主组件内文本。 */
  componentText: 'cmp1_label',
  /** 实例（覆盖了 cmp1_bg 的填充）。 */
  instance: 'inst1',
  /** 组件集（两个变体）。 */
  set: 'set1',
  /** 变体：small。 */
  variantSmall: 'var_small',
  /** 变体：large。 */
  variantLarge: 'var_large',
  /** 变体 small 内的矩形。 */
  variantSmallRect: 'var_small_bg',
  /** 变体 large 内的矩形。 */
  variantLargeRect: 'var_large_bg',
  /** 指向 small 变体的实例。 */
  variantInstance: 'inst2',
} as const;

/** 覆盖键（路径串）：主组件内 cmp1_bg 的覆盖。 */
export const FIXTURE_OVERRIDE_PATH = 'cmp1_bg';

/** 覆盖后的填充色（文档数据色，非界面令牌）。 */
export const FIXTURE_OVERRIDE_FILL = '#ff0000'; // guard-tokens:allow 文档数据色，非界面令牌

/** 变体集属性维度：size。 */
export const FIXTURE_VARIANT_DIMENSION = 'size';

/** 夹具令牌集：品牌色 + 指向品牌色的别名（令牌解析链用）。 */
export function fixtureTokens(): TokenSet {
  return {
    color: {
      brand: token('color', '#0d99ff'), // guard-tokens:allow 文档令牌值，非界面令牌
      brandAlias: aliasToken('color.brand', '别名链测试'),
    },
    radius: {
      card: token('dimension', 8),
    },
  };
}

/** 夹具页面（角色齐备，见文件头注释）。 */
export function fixturePage(): ScenePage {
  const r1 = createRect({ id: FIXTURE_IDS.rectInFrame, x: 0, y: 0, width: 100, height: 50 });
  const r2 = createRect({ id: FIXTURE_IDS.rectInFrame2, x: 120, y: 0, width: 100, height: 50 });
  const frame = createFrame({
    id: FIXTURE_IDS.frame,
    name: '画板',
    width: 320,
    height: 200,
    children: [r1.id, r2.id],
  });
  const r3 = createRect({ id: FIXTURE_IDS.rectTop, x: 420, y: 40, width: 100, height: 50 });

  const cmpRect = createRect({
    id: FIXTURE_IDS.componentRect,
    name: '按钮底',
    x: 0,
    y: 0,
    width: 120,
    height: 40,
  });
  const cmpText = createText({
    id: FIXTURE_IDS.componentText,
    name: '按钮文字',
    x: 12,
    y: 10,
    text: defaultTextContent('按钮'),
  });
  const component = createComponent({
    id: FIXTURE_IDS.component,
    name: '按钮主件',
    x: 40,
    y: 300,
    width: 120,
    height: 40,
    children: [cmpRect.id, cmpText.id],
  });

  const instance = createInstance({
    id: FIXTURE_IDS.instance,
    name: '按钮主件',
    x: 220,
    y: 300,
    width: 120,
    height: 40,
    componentId: component.id,
    overrides: {
      // 覆盖：主组件内「按钮底」的填充改成红色
      [FIXTURE_OVERRIDE_PATH]: { fills: [solidPaint(FIXTURE_OVERRIDE_FILL)] },
    },
  });

  const smallRect = createRect({
    id: FIXTURE_IDS.variantSmallRect,
    x: 0,
    y: 0,
    width: 80,
    height: 32,
  });
  const small = createComponent({
    id: FIXTURE_IDS.variantSmall,
    name: '按钮 small',
    x: 40,
    y: 420,
    width: 80,
    height: 32,
    children: [smallRect.id],
    variantProperties: { size: 'small' },
    componentSetId: FIXTURE_IDS.set,
  });
  const largeRect = createRect({
    id: FIXTURE_IDS.variantLargeRect,
    x: 0,
    y: 0,
    width: 120,
    height: 44,
  });
  const large = createComponent({
    id: FIXTURE_IDS.variantLarge,
    name: '按钮 large',
    x: 160,
    y: 420,
    width: 120,
    height: 44,
    children: [largeRect.id],
    variantProperties: { size: 'large' },
    componentSetId: FIXTURE_IDS.set,
  });
  const set = createComponentSet({
    id: FIXTURE_IDS.set,
    name: '按钮集',
    x: 40,
    y: 400,
    width: 240,
    height: 64,
    children: [small.id, large.id],
  });
  const variantInstance = createInstance({
    id: FIXTURE_IDS.variantInstance,
    name: '按钮 small',
    x: 340,
    y: 420,
    width: 80,
    height: 32,
    componentId: small.id,
  });

  return createPage({
    id: FIXTURE_PAGE_ID,
    name: '主页面',
    nodes: {
      r1,
      r2,
      f1: frame,
      r3,
      cmp1_bg: cmpRect,
      cmp1_label: cmpText,
      cmp1: component,
      inst1: instance,
      var_small_bg: smallRect,
      var_small: small,
      var_large_bg: largeRect,
      var_large: large,
      set1: set,
      inst2: variantInstance,
    },
    rootIds: [frame.id, r3.id, component.id, instance.id, set.id, variantInstance.id],
    backgroundColor: '#f5f5f5', // guard-tokens:allow 文档数据色，非界面令牌
  });
}

/** 夹具文档（令牌齐备）。 */
export function fixtureDocument(): DesignDocument {
  return createDocument({
    id: 'doc_components',
    name: '组件夹具',
    pages: [fixturePage()],
    tokens: fixtureTokens(),
  });
}

/** 构造夹具命令栈（默认冻结：逮住绕过命令栈的就地写入）。 */
export function fixtureStack(options: CommandStackOptions = {}): CommandStack {
  return new CommandStack(fixtureDocument(), { freeze: true, ...options });
}

/** 便捷选择集。 */
export function selectionOf(ids: readonly NodeId[], activeId?: string): Selection {
  return createSelection(ids, activeId);
}
