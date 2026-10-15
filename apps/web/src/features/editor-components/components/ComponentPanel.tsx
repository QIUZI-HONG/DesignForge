'use client';

/**
 * ComponentPanel —— 组件面板（C17 组件创建 / 管理）。
 *
 * 内容随选中态切换（`model/reads` 的六类）：
 * - 普通节点 → 「创建组件」（前置不满足时禁用并给原因，F15）；
 * - 主组件 → 紫徽标「主组件」+ 实例计数 + 「创建实例」；
 * - 组件集 → 紫徽标「组件集」+ 变体数；
 * - 实例 → 紫徽标「实例」+ 主组件名（缺失主组件走独立提示）+ 覆盖清单与重置 + 变体切换下拉。
 *
 * 数据流：读 → `model/reads|overrides|variants`（纯函数投影）；写 → `model/actions`
 *（一律经引擎命令栈，面板不持有第二条写路径）。样式集中在 `editor-components.css`（禁裸值）。
 */

import {
  type CommandStack,
  findPage,
  type IdFactory,
  type PageId,
  type Selection,
} from '@dforge/engine';
import { Button, ComponentIcon, EmptyState } from '@dforge/ui';
import { useState } from 'react';

import { t } from '@/i18n';

// 面板样式（令牌变量；禁裸值——样式集中在 editor-components.css）
import '../editor-components.css';

import { useDocumentSnapshot } from '../hooks/useDocumentSnapshot';
import {
  COMPONENT_COMMAND_LABELS,
  createComponentFromSelection,
  createInstanceOfComponent,
  resetOverrides,
  switchInstanceVariant,
} from '../model/actions';
import { readOverrideEntries } from '../model/overrides';
import {
  type ComponentSelectionRead,
  type CreateComponentBlockedReason,
  canCreateComponent,
  readSelectionComponent,
} from '../model/reads';
import { shortcutById } from '../model/shortcuts';
import { readVariantState } from '../model/variants';
import { CreateComponentDialog } from './CreateComponentDialog';
import { OverrideList } from './OverrideList';
import { VariantSelect } from './VariantSelect';

/** 「创建组件」被挡的原因 → 文案键（编码稳定，文案真源在 messages）。 */
const BLOCKED_LABEL_KEYS: Record<CreateComponentBlockedReason, string> = {
  empty: 'editor.components.blocked.empty',
  'multiple-parents': 'editor.components.blocked.multipleParents',
  'instance-content': 'editor.components.blocked.instanceContent',
  'contains-component': 'editor.components.blocked.containsComponent',
};

/** 面板 props。 */
export interface ComponentPanelProps {
  stack: CommandStack;
  pageId: PageId;
  selection: Selection;
  /** 组件 id 生成器（宿主可注入确定性工厂；缺省用引擎的系统工厂）。 */
  ids?: IdFactory;
}

/** 组件面板。 */
export function ComponentPanel({ stack, pageId, selection, ids }: ComponentPanelProps) {
  const document = useDocumentSnapshot(stack);
  const [dialogOpen, setDialogOpen] = useState(false);
  const page = findPage(document, pageId);
  if (page === undefined) return null;

  const read = readSelectionComponent(page, selection);
  const check = canCreateComponent(page, selection);
  const instanceId = read.kind === 'instance' && read.node !== null ? read.node.id : null;
  const overrides = instanceId === null ? [] : readOverrideEntries(page, instanceId);
  const variants = instanceId === null ? null : readVariantState(page, instanceId);
  const shortcut = shortcutById('component.create');

  const resetPath = (path: readonly string[]): void => {
    if (instanceId === null) return;
    resetOverrides(stack, pageId, instanceId, [[...path]]);
  };

  return (
    <section
      className="dfc-panel"
      data-df-component="panel"
      aria-label={t('editor.components.panel.title')}
    >
      <header className="dfc-panel__head">
        <h2 className="dfc-panel__title">{t('editor.components.panel.title')}</h2>
        <ComponentBadge read={read} />
      </header>

      <div className="dfc-panel__body">
        {renderBody({
          read,
          blockedReason: check.ok ? null : t(BLOCKED_LABEL_KEYS[check.reason]),
          shortcutKeys: shortcut?.keys ?? null,
          overrides,
          variants,
          onOpenDialog: () => setDialogOpen(true),
          onCreateInstance: () => {
            if (read.mainComponent === null) return;
            createInstanceOfComponent(stack, pageId, read.mainComponent.id, {
              ...(ids === undefined ? {} : { ids }),
            });
          },
          onResetAll: () => {
            if (instanceId !== null) resetOverrides(stack, pageId, instanceId);
          },
          onResetPath: resetPath,
          onSelectVariant: (properties) => {
            if (instanceId !== null) switchInstanceVariant(stack, pageId, instanceId, properties);
          },
        })}
      </div>

      <CreateComponentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onConfirm={(name) => {
          createComponentFromSelection(stack, pageId, selection, {
            name,
            ...(ids === undefined ? {} : { ids }),
          });
        }}
      />
    </section>
  );
}

/** 紫徽标（主组件 / 组件集 / 实例 / 缺失主组件）。 */
function ComponentBadge({ read }: { read: ComponentSelectionRead }) {
  const kind = badgeKindOf(read);
  if (kind === null) return null;
  const labelKey =
    kind === 'component'
      ? 'editor.components.badge.component'
      : kind === 'component-set'
        ? 'editor.components.badge.componentSet'
        : kind === 'instance'
          ? 'editor.components.badge.instance'
          : 'editor.components.badge.missing';
  return (
    <span className="dfc-badge" data-df-component="badge" data-df-kind={kind}>
      {t(labelKey)}
    </span>
  );
}

/** 徽标种类（无组件语义时不出徽标）。 */
function badgeKindOf(
  read: ComponentSelectionRead,
): 'component' | 'component-set' | 'instance' | 'missing' | null {
  if (read.kind === 'component') return 'component';
  if (read.kind === 'component_set') return 'component-set';
  if (read.kind === 'instance') return read.detached ? 'missing' : 'instance';
  return null;
}

/** 面板主体（按选中态分派；拆成纯函数便于审阅分支覆盖）。 */
function renderBody(props: {
  read: ComponentSelectionRead;
  blockedReason: string | null;
  shortcutKeys: string | null;
  overrides: ReturnType<typeof readOverrideEntries>;
  variants: ReturnType<typeof readVariantState>;
  onOpenDialog: () => void;
  onCreateInstance: () => void;
  onResetAll: () => void;
  onResetPath: (path: readonly string[]) => void;
  onSelectVariant: (properties: Record<string, string>) => void;
}) {
  const { read, blockedReason, shortcutKeys, overrides, variants } = props;

  const createEntry = (
    <div className="dfc-panel__action">
      <Button
        variant="secondary"
        icon={<ComponentIcon />}
        disabled={blockedReason !== null}
        {...(blockedReason === null ? {} : { disabledReason: blockedReason })}
        onClick={props.onOpenDialog}
        data-df-component="create-component"
      >
        {t('editor.components.action.create')}
      </Button>
      {shortcutKeys === null ? null : (
        <span className="dfc-panel__shortcut">
          {t('editor.components.shortcut.hint', { keys: shortcutKeys })}
        </span>
      )}
    </div>
  );

  if (read.kind === 'none' || read.kind === 'plain') {
    return (
      <>
        {read.kind === 'none' ? (
          <EmptyState title={t('editor.components.selection.none')} />
        ) : (
          <p className="dfc-panel__meta">
            {t('editor.components.instance.count', { count: read.count })}
          </p>
        )}
        {createEntry}
      </>
    );
  }

  if (read.kind === 'mixed') {
    return (
      <>
        <p className="dfc-panel__meta">
          {t('editor.inspect.selection.multiple', { count: read.count })}
        </p>
        {createEntry}
      </>
    );
  }

  if (read.kind === 'component') {
    return (
      <>
        <p className="dfc-panel__name">{read.mainComponentName}</p>
        <p className="dfc-panel__meta">{t('editor.components.component.hint')}</p>
        <p className="dfc-panel__meta" data-df-component="instance-count">
          {t('editor.components.instance.count', { count: read.instanceCount })}
        </p>
        <div className="dfc-panel__action">
          <Button
            variant="secondary"
            disabled={read.detached}
            onClick={props.onCreateInstance}
            data-df-component="create-instance"
          >
            {t('editor.components.action.createInstance')}
          </Button>
        </div>
      </>
    );
  }

  if (read.kind === 'component_set') {
    return (
      <>
        <p className="dfc-panel__name">{read.node?.name}</p>
        <p className="dfc-panel__meta" data-df-component="variant-count">
          {t('editor.components.set.variantCount', { count: read.variantCount })}
        </p>
      </>
    );
  }

  // instance（含缺失主组件）
  return (
    <>
      <p className="dfc-panel__name">{read.node?.name}</p>
      {read.mainComponentName === null ? (
        <p className="dfc-panel__meta dfc-panel__meta--warn" data-df-component="main-missing">
          {t('editor.components.badge.missing')}
        </p>
      ) : (
        <p className="dfc-panel__meta" data-df-component="main-name">
          {t('editor.components.instance.main', { name: read.mainComponentName })}
        </p>
      )}

      {variants === null ? null : (
        <VariantSelect state={variants} onSelect={props.onSelectVariant} />
      )}

      <div className="dfc-panel__section" data-df-component="overrides-section">
        <div className="dfc-panel__section-head">
          <h3 className="dfc-panel__section-title">{t('editor.components.overrides.title')}</h3>
          {overrides.length === 0 ? null : (
            <Button size="sm" variant="ghost" onClick={props.onResetAll}>
              {t('editor.components.action.resetOverrides')}
            </Button>
          )}
        </div>
        <OverrideList entries={overrides} onResetPath={props.onResetPath} />
      </div>
    </>
  );
}

/** 面板用的命令标签（供宿主在撤销菜单等处引用，保持文案单源）。 */
export { COMPONENT_COMMAND_LABELS };
