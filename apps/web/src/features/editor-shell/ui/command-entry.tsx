'use client';

/**
 * 命令入口（顶栏/工具条上的按钮）——**「入口先于实现」的统一形态**。
 *
 * 为什么需要它：壳层的分享 / 演示 / 评论 / 版本入口由本票渲染，实现归 FE-07 等票。
 * 约定是：**入口跟着命令表亮**——对应票注册命令（同 id）后，入口自动变为可点；
 * 未注册则渲染为**禁用 + 原因提示**（tooltip 说明「功能尚未接入」），
 * 而不是渲染一个点了没反应的假按钮。
 */
import { Button, IconButton } from '@dforge/ui';
import type { ReactNode } from 'react';

import { t } from '@/i18n';

import { executeCommand } from '../commands/execute';
import type { Command } from '../commands/registry';
import { useCommand } from '../commands/use-commands';
import { cx } from '../utils/cx';

/** 入口状态（按钮族共用）。 */
export interface CommandEntryState {
  /** 命令是否已注册（未注册 → 入口禁用）。 */
  registered: boolean;
  /** 当前是否可点（已注册且未置灰）。 */
  available: boolean;
  /** 禁用原因（未注册给「尚未接入」；置灰命令给标题）。 */
  disabledReason: string;
  /** 运行（未注册/置灰时是 no-op，按钮本身已禁用）。 */
  run: () => void;
}

/** 取入口状态。 */
export function useCommandEntry(id: string): CommandEntryState {
  const command: Command | undefined = useCommand(id);
  return {
    registered: command !== undefined,
    available: command !== undefined && command.enabled?.() !== false,
    disabledReason: command === undefined ? t('editor.action.pending') : (command.title ?? ''),
    run: () => {
      void executeCommand(id);
    },
  };
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
  return (
    <IconButton
      label={label}
      icon={icon}
      size="sm"
      className={cx('dfg-editor-entry', className)}
      data-df-command={id}
      disabled={!entry.available}
      {...(entry.available ? {} : { disabledReason: entry.disabledReason })}
      onClick={entry.run}
    />
  );
}
