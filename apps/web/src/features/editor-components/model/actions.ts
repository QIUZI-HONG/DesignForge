/**
 * C17 写操作：创建组件 / 创建实例 / 重置覆盖 / 切换变体。
 *
 * 纪律（_shared §3）：**写操作唯一入口 = 引擎命令栈**——本模块只负责
 * 「读当前文档 → 让引擎构造命令 → 交给命令栈（带中文历史标签）」，
 * 不做任何就地修改；前置不满足时返回结构化原因，不落任何命令。
 */

import {
  type Command,
  type CommandStack,
  type ComponentId,
  createComponentCommands,
  type IdFactory,
  instantiateComponentCommands,
  isComponentNode,
  isInstanceNode,
  type NodeId,
  type PageId,
  resolveNode,
  type ScenePage,
  type Selection,
  switchVariantCommands,
} from '@dforge/engine';

import { type CreateComponentBlockedReason, canCreateComponent } from './reads';

/** 创建组件结果。 */
export type CreateComponentOutcome =
  | { ok: true; componentId: ComponentId }
  | { ok: false; reason: CreateComponentBlockedReason };

/** 创建实例结果。 */
export type CreateInstanceOutcome =
  | { ok: true; instanceId: NodeId }
  | { ok: false; reason: 'not-a-component' };

/** 重置覆盖结果。 */
export type ResetOverridesOutcome =
  | { ok: true; cleared: number }
  | { ok: false; reason: 'not-an-instance' };

/** 切换变体结果。 */
export type SwitchVariantOutcome =
  | { ok: true; componentId: ComponentId }
  | { ok: false; reason: 'not-an-instance' | 'no-variant-set' | 'no-variant' };

/** 命令历史标签（撤销菜单显示；集中在此避免文案漂移）。 */
export const COMPONENT_COMMAND_LABELS = {
  createComponent: '创建组件',
  createInstance: '创建实例',
  resetOverride: '重置覆盖',
  switchVariant: '切换变体',
} as const;

/** 取当前页面（pageId 不匹配时返回 null——宿主跨页切换期间调用的兜底）。 */
function pageOf(stack: CommandStack, pageId: PageId): ScenePage | null {
  return stack.document.pages.find((page) => page.id === pageId) ?? null;
}

/**
 * 从选中创建组件（C17「创建组件」，⌘⌥K）。
 * 前置与 `canCreateComponent` 同口径；引擎侧再做一次（命令构造时）校验。
 */
export function createComponentFromSelection(
  stack: CommandStack,
  pageId: PageId,
  selection: Selection,
  options: { name?: string; ids?: IdFactory } = {},
): CreateComponentOutcome {
  const page = pageOf(stack, pageId);
  if (page === null) return { ok: false, reason: 'empty' };
  const check = canCreateComponent(page, selection);
  if (!check.ok) return check;
  const commands = createComponentCommands(page, pageId, selection.ids, options);
  if (commands.length === 0) return { ok: false, reason: 'empty' };
  stack.dispatch(commands, { label: COMPONENT_COMMAND_LABELS.createComponent });
  const created = commands.find((command) => command.type === 'node.insert');
  const componentId = created?.type === 'node.insert' ? created.node.id : null;
  if (componentId === null) return { ok: false, reason: 'empty' };
  return { ok: true, componentId };
}

/** 由主组件创建实例（C17「创建实例」；实例不复制子树）。 */
export function createInstanceOfComponent(
  stack: CommandStack,
  pageId: PageId,
  componentId: ComponentId,
  options: { instanceId?: NodeId; x?: number; y?: number; ids?: IdFactory } = {},
): CreateInstanceOutcome {
  const page = pageOf(stack, pageId);
  if (page === null) return { ok: false, reason: 'not-a-component' };
  const component = page.nodes[componentId];
  if (!component || !isComponentNode(component)) {
    return { ok: false, reason: 'not-a-component' };
  }
  const commands = instantiateComponentCommands(page, pageId, componentId, options);
  stack.dispatch(commands, { label: COMPONENT_COMMAND_LABELS.createInstance });
  const inserted = commands[0];
  if (inserted?.type !== 'node.insert') {
    return { ok: false, reason: 'not-a-component' };
  }
  return { ok: true, instanceId: inserted.node.id };
}

/**
 * 重置实例覆盖：`paths` 省略 = 清空全部；给出路径 = 只清这些路径。
 * 幂等：无覆盖可清时不落命令（撤销栈不被空操作污染）。
 */
export function resetOverrides(
  stack: CommandStack,
  pageId: PageId,
  instanceId: NodeId,
  paths?: readonly NodeId[][],
): ResetOverridesOutcome {
  const page = pageOf(stack, pageId);
  if (page === null) return { ok: false, reason: 'not-an-instance' };
  const node = page.nodes[instanceId];
  if (!node || !isInstanceNode(node)) return { ok: false, reason: 'not-an-instance' };

  const targetPaths =
    paths === undefined
      ? Object.keys(node.overrides).map((key) => key.split('/'))
      : paths.filter((path) => {
          const key = path.join('/');
          return Object.hasOwn(node.overrides, key);
        });
  if (targetPaths.length === 0) return { ok: true, cleared: 0 };

  for (const path of targetPaths) {
    stack.dispatch([{ type: 'instance.resetOverride', pageId, instanceId, path: [...path] }], {
      label: COMPONENT_COMMAND_LABELS.resetOverride,
    });
  }
  return { ok: true, cleared: targetPaths.length };
}

/**
 * 切换实例变体：按属性在组件集内查找变体（引擎 `findVariant` 的部分匹配语义），
 * 覆盖表保留（引擎 `instance.switchVariant` 只改 componentId）。
 */
export function switchInstanceVariant(
  stack: CommandStack,
  pageId: PageId,
  instanceId: NodeId,
  properties: Record<string, string>,
): SwitchVariantOutcome {
  const page = pageOf(stack, pageId);
  if (page === null) return { ok: false, reason: 'not-an-instance' };
  const node = resolveNode(page, instanceId);
  if (node?.type !== 'instance') return { ok: false, reason: 'not-an-instance' };
  const main = page.nodes[node.componentId];
  if (!main || !isComponentNode(main) || main.componentSetId === null) {
    return { ok: false, reason: 'no-variant-set' };
  }
  const setId = main.componentSetId;
  let commands: Command[];
  try {
    commands = switchVariantCommands(page, pageId, instanceId, setId, properties);
  } catch {
    // 引擎在组件集内找不到匹配变体时抛领域错误——面板按「无匹配」处理（不冒泡成崩溃）
    return { ok: false, reason: 'no-variant' };
  }
  if (commands.length === 0) return { ok: false, reason: 'no-variant' };
  stack.dispatch(commands, { label: COMPONENT_COMMAND_LABELS.switchVariant });
  const command = commands[0];
  if (command?.type !== 'instance.switchVariant') {
    return { ok: false, reason: 'no-variant' };
  }
  return { ok: true, componentId: command.componentId };
}
