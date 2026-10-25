/**
 * 字段写入层（Inspector 的「写」侧）：把控件的意图翻译成引擎命令。
 *
 * 三条纪律：
 * 1. **唯一写入口**是命令栈——本模块只产生 `Command[]`，由调用方交给 `CommandStack.dispatch`；
 * 2. 批量修改逐节点从该节点现状推导补丁（保留各节点其余属性），
 *    并统一走 `patchNodeCommands` 路由（实例内的虚节点自动落成实例覆盖）；
 * 3. 无变化/不适用 → 不产生命令（避免空历史条目）。
 */

import {
  type AutoLayoutConfig,
  autoLayoutCommands,
  type BlendMode,
  type Command,
  type DesignDocument,
  defaultAutoLayout,
  type Effect,
  getPage,
  type NodeId,
  type NodePatch,
  type PageId,
  patchNodeCommands,
  resolveNode,
  type SceneNode,
  type ScenePage,
  type Stroke,
  setNodeProps,
  solidPaint,
  type TextContent,
} from '@dforge/engine';

import type { NumberFieldKey } from './readers';

/**
 * 逐节点构造补丁并翻译成命令。
 *
 * @param build 由该节点现状产出补丁；返回 null/undefined 表示跳过此节点。
 */
export function batchPatchCommands(
  page: ScenePage,
  pageId: PageId,
  ids: readonly NodeId[],
  build: (node: SceneNode, id: NodeId) => NodePatch | null | undefined,
): Command[] {
  const commands: Command[] = [];
  for (const id of ids) {
    const node = resolveNode(page, id);
    if (node === undefined) continue;
    const patch = build(node, id);
    if (patch === null || patch === undefined || Object.keys(patch).length === 0) continue;
    commands.push(...patchNodeCommands(pageId, id, patch));
  }
  return commands;
}

/** 批量写标量字段（位置/尺寸/旋转/不透明度/圆角）。 */
export function setNumberCommands(
  page: ScenePage,
  pageId: PageId,
  ids: readonly NodeId[],
  key: NumberFieldKey,
  value: number,
): Command[] {
  return batchPatchCommands(page, pageId, ids, (node) =>
    node[key] === value ? null : ({ [key]: value } as NodePatch),
  );
}

/** 批量改第一层填充颜色（保留各节点自身的填充不透明度）。 */
export function setFillColorCommands(
  page: ScenePage,
  pageId: PageId,
  ids: readonly NodeId[],
  color: string,
): Command[] {
  return batchPatchCommands(page, pageId, ids, (node) => {
    const first = node.fills[0];
    if (first?.type === 'solid' && first.color === color) return null;
    const opacity = first?.opacity ?? 1;
    return { fills: [solidPaint(color, opacity), ...node.fills.slice(1)] };
  });
}

/** 批量改第一层填充的不透明度（0–1；无填充的节点跳过）。 */
export function setFillOpacityCommands(
  page: ScenePage,
  pageId: PageId,
  ids: readonly NodeId[],
  opacity: number,
): Command[] {
  return batchPatchCommands(page, pageId, ids, (node) => {
    const first = node.fills[0];
    if (first === undefined) return null;
    if (first.type === 'solid') {
      if (first.opacity === opacity) return null;
      return { fills: [{ ...first, opacity }, ...node.fills.slice(1)] };
    }
    return { fills: [{ ...first, opacity }, ...node.fills.slice(1)] };
  });
}

/** 批量改第一层描边（颜色/宽度）；无描边时按默认宽 1 新建。 */
export function setStrokeCommands(
  page: ScenePage,
  pageId: PageId,
  ids: readonly NodeId[],
  patch: { color?: string; width?: number },
): Command[] {
  return batchPatchCommands(page, pageId, ids, (node) => {
    const first: Stroke | undefined = node.strokes[0];
    if (patch.color === undefined && patch.width === undefined) return null;
    // 只给宽度但该节点没有描边：没有可改的描边行，跳过
    if (patch.color === undefined && first === undefined) return null;

    // 文档数据色（Design IR 填充/描边真值，非界面令牌：engine paint.ts 明确文档值不引 UI 令牌）
    const basePaint = first?.paint ?? solidPaint('#000000'); // guard-tokens:allow 文档数据色，非界面令牌
    const paint = patch.color === undefined ? basePaint : solidPaint(patch.color, 1);
    const width = patch.width ?? first?.width ?? 1;
    const align = first?.align ?? 'inside';
    if (
      first !== undefined &&
      first.width === width &&
      (patch.color === undefined ||
        (first.paint.type === 'solid' && first.paint.color === patch.color))
    ) {
      return null;
    }
    return { strokes: [{ paint, width, align }, ...node.strokes.slice(1)] };
  });
}

/** 批量改文本属性（仅文本节点适用；未涉及的排版属性保留）。 */
export function setTextCommands(
  page: ScenePage,
  pageId: PageId,
  ids: readonly NodeId[],
  patch: Partial<TextContent>,
): Command[] {
  return batchPatchCommands(page, pageId, ids, (node) => {
    if (node.type !== 'text') return null;
    const entries = Object.entries(patch) as [keyof TextContent, TextContent[keyof TextContent]][];
    if (entries.every(([key, value]) => node.text[key] === value)) return null;
    return { text: { ...node.text, ...patch } };
  });
}

/** 批量改混合模式（高级分区）。 */
export function setBlendModeCommands(
  page: ScenePage,
  pageId: PageId,
  ids: readonly NodeId[],
  mode: BlendMode,
): Command[] {
  return batchPatchCommands(page, pageId, ids, (node) =>
    node.blendMode === mode ? null : { blendMode: mode },
  );
}

/* ------------------------------------------------------------------------ *
 * 效果分区（RW-10）：效果列表的增/删/改，全部落 node.update（画布实时联动）。
 * 序号口径：效果编辑只针对「选中集共有的第 index 个效果」（三态为 single 时成立）；
 * 越界/不适用节点跳过，无变化不出命令（避免空历史）。
 * ------------------------------------------------------------------------ */

/** 效果类型（引擎 P0 三种）。 */
export type EffectType = Effect['type'];

/** 新效果的默认参数（对齐 Figma 常用初值；色值是文档数据，非界面令牌）。 */
export function defaultEffect(type: EffectType): Effect {
  switch (type) {
    case 'drop_shadow':
    case 'inner_shadow':
      return {
        type,
        color: '#000000', // guard-tokens:allow 文档数据色，非界面令牌
        offsetX: 0,
        offsetY: 4,
        blur: 10,
        spread: 0,
        visible: true,
      };
    case 'layer_blur':
      return {
        type,
        color: '#000000', // guard-tokens:allow 文档数据色，非界面令牌
        offsetX: 0,
        offsetY: 0,
        blur: 10,
        spread: 0,
        visible: true,
      };
  }
}

/** 批量追加效果（各节点从自身现状追加同一效果定义）。 */
export function addEffectCommands(
  page: ScenePage,
  pageId: PageId,
  ids: readonly NodeId[],
  effect: Effect,
): Command[] {
  return batchPatchCommands(page, pageId, ids, (node) => ({
    effects: [...node.effects, effect],
  }));
}

/** 批量按序号移除效果（越界节点跳过）。 */
export function removeEffectCommands(
  page: ScenePage,
  pageId: PageId,
  ids: readonly NodeId[],
  index: number,
): Command[] {
  return batchPatchCommands(page, pageId, ids, (node) => {
    if (index < 0 || index >= node.effects.length) return null;
    return { effects: node.effects.filter((_, at) => at !== index) };
  });
}

/** 批量改第 index 个效果的参数（部分补丁；未涉及参数保留；无变化/越界跳过）。 */
export function updateEffectCommands(
  page: ScenePage,
  pageId: PageId,
  ids: readonly NodeId[],
  index: number,
  patch: Partial<Omit<Effect, 'type'>>,
): Command[] {
  return batchPatchCommands(page, pageId, ids, (node) => {
    const current = node.effects[index];
    if (current === undefined) return null;
    const next: Effect = { ...current, ...patch };
    if (
      next.color === current.color &&
      next.offsetX === current.offsetX &&
      next.offsetY === current.offsetY &&
      next.blur === current.blur &&
      next.spread === current.spread &&
      next.visible === current.visible
    ) {
      return null;
    }
    return { effects: node.effects.map((effect, at) => (at === index ? next : effect)) };
  });
}

/**
 * 自动布局读写（布局分区）。
 *
 * `patch === null` 关闭自动布局（清空配置、保留子项现状）；
 * 给出配置片段时按「当前配置 ⊕ 片段」合并（当前未启用则取默认配置）。
 * 启用/改配置都会**同事务**追加子项重排命令（引擎布局求解器）——
 * 因此开自动布局与子项落位撤销粒度仍是「一次修改」。
 */
export function applyAutoLayoutCommands(
  doc: DesignDocument,
  pageId: PageId,
  frameId: NodeId,
  patch: Partial<AutoLayoutConfig> | null,
): Command[] {
  const page = doc.pages.find((candidate) => candidate.id === pageId);
  if (page === undefined) return [];
  const node = resolveNode(page, frameId);
  if (node === undefined || node.type !== 'frame') return [];

  const config: AutoLayoutConfig | null =
    patch === null ? null : { ...(node.autoLayout ?? defaultAutoLayout()), ...patch };
  const first: Command = {
    type: 'node.update',
    pageId,
    nodeId: frameId,
    patch: { autoLayout: config },
  };
  if (config === null) return [first];

  // 预览补丁后的页面，再交引擎布局求解器定位子项与容器尺寸
  const nextPage = getPage(setNodeProps(doc, pageId, frameId, { autoLayout: config }), pageId);
  return [first, ...autoLayoutCommands(nextPage, pageId, frameId)];
}

/**
 * 批量自动布局读写（多画板选中）：逐个画板求命令，并在**预览文档**上折叠前序补丁，
 * 保证嵌套画板（自动布局套自动布局）的求解基准正确；全部命令一条事务提交。
 */
export function applyAutoLayoutToSelectionCommands(
  doc: DesignDocument,
  pageId: PageId,
  frameIds: readonly NodeId[],
  patch: Partial<AutoLayoutConfig> | null,
): Command[] {
  let commands: Command[] = [];
  let preview: DesignDocument = doc;
  for (const frameId of frameIds) {
    const perFrame = applyAutoLayoutCommands(preview, pageId, frameId, patch);
    if (perFrame.length === 0) continue;
    commands = [...commands, ...perFrame];
    for (const command of perFrame) {
      if (command.type === 'node.update') {
        preview = setNodeProps(preview, pageId, command.nodeId, command.patch);
      }
    }
  }
  return commands;
}
