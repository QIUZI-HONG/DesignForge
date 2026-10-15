'use client';

/**
 * 保存脚（FE-09 · 清单 E3「保存态」的单点实现）。
 *
 * 设置页四个分区与引导步骤共用：按钮（保存中 = loading + 禁点）+ 状态行
 * （保存中 / 已保存）+ 失败条（daemon 文案原样 + 重试）。状态由 `save-state.ts`
 * 的状态机给出，本组件不自己攒 boolean。
 *
 * 六态挂点（验收标准 §6，供 `scripts/verify-self-designed.mjs` 与后续截图门禁定位）：
 * - `data-df-state="active"`：保存按钮——focus-visible 焦点环证据挂点；
 * - `data-df-state="disabled"`：按钮外层——禁用（无改动 / 保存中）证据挂点。
 */
import { AlertCircleIcon, Button, CheckCircleIcon } from '@dforge/ui';
import type { ReactNode } from 'react';

import { t } from '@/i18n';

import type { SaveState } from '../model/save-state';

/** SaveFooter props。 */
export interface SaveFooterProps {
  /** 主按钮文案（保存 / 保存密钥 / 下一步 / 完成）。 */
  saveLabel: string;
  saveState: SaveState;
  /** 无改动或保存中：按钮禁点。 */
  disabled: boolean;
  onSave: () => void;
  /** 主按钮前挂的附加动作（引导用：上一步 / 跳过）。 */
  extraActions?: ReactNode;
}

const styles = {
  footer: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--dfg-space-3)',
    flexWrap: 'wrap',
  },
  status: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--dfg-space-1)',
    color: 'var(--dfg-color-text-secondary)',
    fontSize: 'var(--dfg-font-size-12)',
  },
  failure: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--dfg-space-2)',
    paddingBlock: 'var(--dfg-space-2)',
    paddingInline: 'var(--dfg-space-3)',
    background: 'var(--dfg-color-danger-subtle)',
    borderRadius: 'var(--dfg-radius-md)',
    color: 'var(--dfg-color-text-primary)',
    fontSize: 'var(--dfg-font-size-12)',
  },
} satisfies Record<string, React.CSSProperties>;

/** 保存脚。 */
export function SaveFooter({
  saveLabel,
  saveState,
  disabled,
  onSave,
  extraActions,
}: SaveFooterProps) {
  const saving = saveState.phase === 'saving';
  return (
    <div style={{ display: 'grid', gap: 'var(--dfg-space-2)' }}>
      <div style={styles.footer}>
        {extraActions}
        <span data-df-state={disabled || saving ? 'disabled' : undefined}>
          <Button
            variant="primary"
            onClick={onSave}
            loading={saving}
            loadingLabel={t('settings.action.saving')}
            disabled={disabled}
            data-df-state="active"
          >
            {saveLabel}
          </Button>
        </span>
        <span style={styles.status} role="status" aria-live="polite">
          {saveState.phase === 'saved' ? (
            <>
              <CheckCircleIcon />
              {t('settings.action.saved')}
            </>
          ) : null}
        </span>
      </div>
      {saveState.phase === 'failed' ? (
        <div style={styles.failure} role="alert">
          <AlertCircleIcon />
          <span>{saveState.message}</span>
          <Button size="sm" onClick={onSave}>
            {t('settings.action.retry')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
