'use client';

/**
 * AlignRow —— 对齐/分布工具行（C6）。
 *
 * 计算全走引擎选择模型：对齐基准多选时取选择集并集、单选时取父容器；
 * 分布保持首尾不动、等分间隙（`@dforge/engine` 的 `alignCommands` / `distributeCommands`）。
 * 可用性由引擎的 `alignAvailability` 派生：顶层单选节点没有父级基准 → 对齐禁用；
 * 分布要求 ≥3 个节点（Figma 同构）。
 */

import {
  type AlignOp,
  alignAvailability,
  alignCommands,
  type CommandStack,
  type DistributeOp,
  distributeCommands,
  findPage,
  type PageId,
  parentIdOf,
  type Selection,
} from '@dforge/engine';
import { useMemo } from 'react';

import { t } from '@/i18n';

import { useDocumentSnapshot } from '../hooks/useDocumentSnapshot';
import {
  AlignBottomIcon,
  AlignHCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  AlignTopIcon,
  AlignVCenterIcon,
  DistributeHorizontalIcon,
  DistributeVerticalIcon,
} from './align-icons';

/** 对齐行 props。 */
export interface AlignRowProps {
  stack: CommandStack;
  pageId: PageId;
  selection: Selection;
}

/** 对齐档（六向）。 */
const ALIGN_OPS: readonly { op: AlignOp; labelKey: string; icon: typeof AlignLeftIcon }[] = [
  { op: 'left', labelKey: 'inspector.align.left', icon: AlignLeftIcon },
  { op: 'hcenter', labelKey: 'inspector.align.hcenter', icon: AlignHCenterIcon },
  { op: 'right', labelKey: 'inspector.align.right', icon: AlignRightIcon },
  { op: 'top', labelKey: 'inspector.align.top', icon: AlignTopIcon },
  { op: 'vcenter', labelKey: 'inspector.align.vcenter', icon: AlignVCenterIcon },
  { op: 'bottom', labelKey: 'inspector.align.bottom', icon: AlignBottomIcon },
];

/** 分布档（两轴）。 */
const DISTRIBUTE_OPS: readonly {
  op: DistributeOp;
  labelKey: string;
  icon: typeof AlignLeftIcon;
}[] = [
  { op: 'horizontal', labelKey: 'inspector.align.distributeH', icon: DistributeHorizontalIcon },
  { op: 'vertical', labelKey: 'inspector.align.distributeV', icon: DistributeVerticalIcon },
];

/** 对齐/分布工具行。 */
export function AlignRow({ stack, pageId, selection }: AlignRowProps) {
  const document = useDocumentSnapshot(stack);
  const page = findPage(document, pageId);
  const ids = selection.ids;

  const multi = ids.length >= 2;
  // 单选的基准是父容器：顶层节点没有父级基准 → 六向对齐不可用（引擎同口径）
  const singleHasParent =
    ids.length === 1 && page !== undefined && parentIdOf(page, ids[0] as string) !== null;
  const alignEnabled =
    page !== undefined &&
    alignAvailability(ids.length, multi ? 'selection' : 'parent') &&
    (multi || singleHasParent);
  const distributeEnabled = ids.length >= 3;

  const alignLabel = t('inspector.align.label');
  const memoIds = useMemo(() => [...ids], [ids]);

  if (ids.length === 0 || page === undefined) return null;

  const runAlign = (op: AlignOp): void => {
    const commands = alignCommands(page, pageId, memoIds, op, {
      relativeTo: multi ? 'selection' : 'parent',
    });
    if (commands.length > 0) stack.dispatch(commands, { label: t('inspector.history.align') });
  };

  const runDistribute = (op: DistributeOp): void => {
    const commands = distributeCommands(page, pageId, memoIds, op);
    if (commands.length > 0) stack.dispatch(commands, { label: t('inspector.history.distribute') });
  };

  return (
    <div
      className="dfi-alignrow"
      data-df-inspector="align-row"
      role="toolbar"
      aria-label={alignLabel}
    >
      {ALIGN_OPS.map(({ op, labelKey, icon: Icon }) => (
        <button
          key={op}
          type="button"
          className="dfi-alignrow__button"
          data-df-align={op}
          aria-label={t(labelKey)}
          disabled={!alignEnabled}
          onClick={() => runAlign(op)}
        >
          <Icon />
        </button>
      ))}
      <span className="dfi-alignrow__gap" aria-hidden="true" />
      {DISTRIBUTE_OPS.map(({ op, labelKey, icon: Icon }) => (
        <button
          key={op}
          type="button"
          className="dfi-alignrow__button"
          data-df-align={op === 'horizontal' ? 'distribute-h' : 'distribute-v'}
          aria-label={t(labelKey)}
          disabled={!distributeEnabled}
          onClick={() => runDistribute(op)}
        >
          <Icon />
        </button>
      ))}
    </div>
  );
}
