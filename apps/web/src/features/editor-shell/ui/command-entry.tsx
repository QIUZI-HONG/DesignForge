'use client';

/**
 * 命令入口（顶栏/工具条上的按钮）——**「入口先于实现」的统一形态**。
 *
 * 为什么需要它：壳层的分享 / 演示 / 评论 / 版本入口由本票渲染，实现归 FE-07 等票。
 * 约定是：**入口跟着命令表亮**——对应票注册命令（同 id）后，入口自动变为可点；
 * 未注册则渲染为**禁用 + 原因提示**（tooltip 说明「功能尚未接入」），
 * 而不是渲染一个点了没反应的假按钮。
 *
 * 状态刷新（工作包 C 修复）：`enabled` / `pressed` 由命令闭包从**外部 store** 读
 * （画布文档、评论模式），命令表本身不会变——因此入口订阅 `subscribeCommandStates`
 * 并按**等值判定**取快照：外部状态变化时重算，值没变就不重渲染
 * （文档高频编辑 → 入口不跟着空转，但「画布上出现第一个画板」这类真变化立刻反映）。
 */
import { Button, IconButton } from '@dforge/ui';
import type { ReactNode } from 'react';
import { useSyncExternalStore } from 'react';

import { t } from '@/i18n';

import { executeCommand } from '../commands/execute';
import { getCommand, subscribeCommandStates } from '../commands/registry';
import { cx } from '../utils/cx';

/** 入口状态（按钮族共用）。 */
export interface CommandEntryState {
  /** 命令是否已注册（未注册 → 入口禁用）。 */
  registered: boolean;
  /** 当前是否可点（已注册且未置灰）。 */
  available: boolean;
  /** 命令是否声明了按下态（开关类入口才渲染 `aria-pressed`）。 */
  toggle: boolean;
  /** 当前按下态（仅 `toggle` 为真时有意义）。 */
  pressed: boolean;
  /** 按下态文案（按下时的入口名，如「退出评论模式」）；缺省 `undefined` = 沿用入口文案。 */
  pressedLabel: string | undefined;
  /** 禁用原因（未注册给「尚未接入」；置灰命令给 `disabledReason()` 或标题）。 */
  disabledReason: string;
  /** 运行（未注册/置灰时是 no-op，按钮本身已禁用）。 */
  run: () => void;
}

/**
 * 入口快照缓存：`useSyncExternalStore` 的 getSnapshot 必须**引用稳定**——
 * 每次通知都新建对象会「快照一直在变」而无限重渲染；等值判定把「没变」折叠回同一对象。
 */
const entrySnapshots = new Map<string, CommandEntryState>();

/** 读入口状态（含等值缓存）。 */
function readEntrySnapshot(id: string): CommandEntryState {
  const command = getCommand(id);
  const registered = command !== undefined;
  const available = registered && command.enabled?.() !== false;
  const toggle = command?.pressed !== undefined;
  const pressed = command?.pressed?.() === true;
  const pressedLabel = pressed ? command?.pressedTitle?.() : undefined;
  let disabledReason = t('editor.action.pending');
  if (command !== undefined) {
    disabledReason = available ? '' : (command.disabledReason?.() ?? command.title);
  }

  const previous = entrySnapshots.get(id);
  if (
    previous !== undefined &&
    previous.registered === registered &&
    previous.available === available &&
    previous.toggle === toggle &&
    previous.pressed === pressed &&
    previous.pressedLabel === pressedLabel &&
    previous.disabledReason === disabledReason
  ) {
    return previous;
  }
  const next: CommandEntryState = {
    registered,
    available,
    toggle,
    pressed,
    pressedLabel,
    disabledReason,
    run: () => {
      void executeCommand(id);
    },
  };
  entrySnapshots.set(id, next);
  return next;
}

/** 取入口状态（订阅命令状态变化自动重算）。 */
export function useCommandEntry(id: string): CommandEntryState {
  return useSyncExternalStore(
    subscribeCommandStates,
    () => readEntrySnapshot(id),
    () => readEntrySnapshot(id), // SSR：与客户端首帧同源
  );
}

/** 带文案的命令按钮（如「分享」）。 */
export function CommandButton({
  id,
  label,
  icon,
  variant = 'secondary',
}: {
  id: string;
  label: string;
  icon?: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost';
}) {
  const entry = useCommandEntry(id);
  return (
    <Button
      variant={variant}
      size="sm"
      data-df-command={id}
      disabled={!entry.available}
      // exactOptionalPropertyTypes：禁用原因只在可用性为假时给（不给 undefined）
      {...(entry.available ? {} : { disabledReason: entry.disabledReason })}
      {...(icon === undefined ? {} : { icon })}
      onClick={entry.run}
    >
      {label}
    </Button>
  );
}

/** 纯图标命令按钮（评论/演示/版本等）。 */
export function CommandIconButton({
  id,
  label,
  icon,
  className,
}: {
  id: string;
  label: string;
  icon: ReactNode;
  className?: string;
}) {
  const entry = useCommandEntry(id);
  // 开关类命令：按下时入口名切到「退出…」，让可访问名与视觉态一致
  const accessibleLabel =
    entry.toggle && entry.pressed && entry.pressedLabel !== undefined ? entry.pressedLabel : label;
  return (
    <IconButton
      label={accessibleLabel}
      icon={icon}
      size="sm"
      className={cx('dfg-editor-entry', className)}
      data-df-command={id}
      disabled={!entry.available}
      {...(entry.available ? {} : { disabledReason: entry.disabledReason })}
      {...(entry.toggle ? { pressed: entry.pressed } : {})}
      onClick={entry.run}
    />
  );
}
