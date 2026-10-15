/**
 * C17 预览预设（FE-08 ⇄ 宿主页面接口，供浏览器门禁与人工预览共用）。
 *
 * 为什么放在公开面：`scripts/verify-figma-inspect.mjs` 需要「普通 / 主组件 / 实例 / 变体 /
 * 缺失主组件」五种状态**可复现且与 jsdom 测试同源**的夹具——宿主页面（编辑器路由，
 * FE-06 接线）按 `?df-components=<state>` 取这里的选择集与文档即可，三处口径不再各自漂移。
 *
 * 与 `testing/fixtures.ts` 的差别：这里按状态**裁**文档（如缺失主组件态不把主组件放进页面），
 * 而测试夹具是「全角色同页」的一份文档。
 */

import {
  aliasToken,
  CommandStack,
  createComponent,
  createComponentSet,
  createDocument,
  createInstance,
  createPage,
  createRect,
  createSelection,
  type DesignDocument,
  type NodeId,
  type SceneNode,
  type ScenePage,
  type Selection,
  solidPaint,
  type TokenSet,
  token,
} from '@dforge/engine';

/** 预览页面 id（宿主断言与门禁共用）。 */
export const COMPONENTS_PREVIEW_PAGE_ID = 'p1';

/** 五态状态名（与门禁 `?df-components=` 取值一致）。 */
export const COMPONENT_PREVIEW_STATES = [
  'plain',
  'component',
  'instance',
  'variant',
  'missing',
] as const;

/** 五态状态名类型。 */
export type ComponentPreviewState = (typeof COMPONENT_PREVIEW_STATES)[number];

/** 预览节点 id（宿主断言与门禁共用）。 */
export const COMPONENTS_PREVIEW_IDS = {
  rectA: 'pv_rect_a',
  rectB: 'pv_rect_b',
  main: 'pv_main',
  mainChild: 'pv_main_child',
  instance: 'pv_instance',
  set: 'pv_set',
  variantSmall: 'pv_var_small',
  variantLarge: 'pv_var_large',
  variantInstance: 'pv_variant_instance',
} as const;

/** 预览令牌集（组件配色演示用）。 */
export function componentsPreviewTokens(): TokenSet {
  return {
    color: {
      component: token('color', '#9747ff'), // guard-tokens:allow 文档令牌值，非界面令牌
      surface: aliasToken('color.component', '别名链：与 component 同值'),
    },
  };
}

/** 预设选择集（每个状态给该状态的「主角」节点）。 */
export function previewSelection(state: ComponentPreviewState): Selection {
  switch (state) {
    case 'plain':
      return createSelection([COMPONENTS_PREVIEW_IDS.rectA, COMPONENTS_PREVIEW_IDS.rectB]);
    case 'component':
      return createSelection([COMPONENTS_PREVIEW_IDS.main]);
    case 'instance':
    case 'missing':
      return createSelection([COMPONENTS_PREVIEW_IDS.instance]);
    case 'variant':
      return createSelection([COMPONENTS_PREVIEW_IDS.variantInstance]);
  }
}

/**
 * 构造预览文档（按状态裁剪页面内容）。
 *
 * 各状态的「看点」：
 * - `plain`：两个同父级矩形 → 「创建组件」可用；
 * - `component`：主组件 + 一个实例 → 主↔实例提示、实例计数；
 * - `instance`：主组件 + **带覆盖**的实例 → 覆盖清单与重置；
 * - `variant`：组件集（两变体）+ 指向 small 的实例 → 变体切换下拉；
 * - `missing`：实例指向**不在页面内**的主组件 → 缺失主组件提示。
 */
export function createComponentsPreviewDocument(state: ComponentPreviewState): DesignDocument {
  return createDocument({
    id: `doc_components_${state}`,
    name: `组件预览 ${state}`,
    pages: [previewPage(state)],
    tokens: componentsPreviewTokens(),
  });
}

/** 预览命令栈（宿主与门禁取同一份初始文档）。 */
export function createComponentsPreviewStack(state: ComponentPreviewState): CommandStack {
  return new CommandStack(createComponentsPreviewDocument(state), { freeze: true });
}

/** 预览页面。 */
function previewPage(state: ComponentPreviewState): ScenePage {
  const rectA = createRect({
    id: COMPONENTS_PREVIEW_IDS.rectA,
    name: '矩形 A',
    x: 24,
    y: 24,
    width: 160,
    height: 96,
    fills: [solidPaint('#9747ff')], // guard-tokens:allow 文档数据色，非界面令牌
  });
  const rectB = createRect({
    id: COMPONENTS_PREVIEW_IDS.rectB,
    name: '矩形 B',
    x: 216,
    y: 24,
    width: 160,
    height: 96,
  });
  const mainChild = createRect({
    id: COMPONENTS_PREVIEW_IDS.mainChild,
    name: '底',
    x: 0,
    y: 0,
    width: 160,
    height: 48,
  });
  const main = createComponent({
    id: COMPONENTS_PREVIEW_IDS.main,
    name: '按钮主件',
    x: 24,
    y: 200,
    width: 160,
    height: 48,
    children: [mainChild.id],
  });
  const instance = createInstance({
    id: COMPONENTS_PREVIEW_IDS.instance,
    name: '按钮主件',
    x: 24,
    y: 264,
    width: 160,
    height: 48,
    // 「缺失主组件」态：实例指向一个不在页面里的主组件（悬空是文档真值，不是渲染技巧）
    componentId: state === 'missing' ? 'pv_missing_main' : main.id,
    overrides:
      state === 'instance'
        ? { [mainChild.id]: { fills: [solidPaint('#ff5b38')] } } // guard-tokens:allow 文档数据色，非界面令牌
        : {},
  });
  const variantSmall = createComponent({
    id: COMPONENTS_PREVIEW_IDS.variantSmall,
    name: '按钮 small',
    x: 24,
    y: 320,
    width: 120,
    height: 40,
    variantProperties: { size: 'small' },
    componentSetId: COMPONENTS_PREVIEW_IDS.set,
  });
  const variantLarge = createComponent({
    id: COMPONENTS_PREVIEW_IDS.variantLarge,
    name: '按钮 large',
    x: 168,
    y: 320,
    width: 160,
    height: 48,
    variantProperties: { size: 'large' },
    componentSetId: COMPONENTS_PREVIEW_IDS.set,
  });
  const variantSet = createComponentSet({
    id: COMPONENTS_PREVIEW_IDS.set,
    name: '按钮集',
    x: 24,
    y: 304,
    width: 304,
    height: 64,
    children: [variantSmall.id, variantLarge.id],
  });
  const variantInstance = createInstance({
    id: COMPONENTS_PREVIEW_IDS.variantInstance,
    name: '按钮 small',
    x: 216,
    y: 408,
    width: 120,
    height: 40,
    componentId: variantSmall.id,
  });

  // 主组件的子节点是真实节点（不是虚节点），必须在页面节点表里；它不出现在 rootIds
  const nodes: Record<NodeId, SceneNode> = { [mainChild.id]: mainChild };
  const rootIds: NodeId[] = [];
  const add = (node: SceneNode): void => {
    nodes[node.id] = node;
    rootIds.push(node.id);
  };

  switch (state) {
    case 'plain':
      add(rectA);
      add(rectB);
      break;
    case 'component':
      add(rectA);
      add(rectB);
      add(main);
      add(instance);
      break;
    case 'instance':
    case 'missing':
      add(rectA);
      add(rectB);
      if (state === 'instance') add(main);
      add(instance);
      break;
    case 'variant':
      add(variantSet);
      add(variantSmall);
      add(variantLarge);
      add(variantInstance);
      break;
  }

  return createPage({
    id: COMPONENTS_PREVIEW_PAGE_ID,
    name: '组件预览',
    nodes,
    rootIds,
    backgroundColor: '#1e1e1e', // guard-tokens:allow 文档数据色，非界面令牌
  });
}
