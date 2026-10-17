'use client';

/**
 * 四步引导（FE-09 · 清单 E4，自设计页：当前步高亮 / 已完成勾选 / 可跳过）。
 *
 * 结构：左侧步骤条（分区注册表定序 = 与设置页同源）+ 右侧当前步表单
 * （`SettingsSectionForm`，与设置分区**同一组件**）。
 *
 * 落库口径：每一步「下一步 / 完成」= 先按分区载荷映射（draft.ts）落库 daemon，
 * 成功才前进；「跳过」= 不落库、记 skipped 并前进。末步完成后进入完成卡，
 * 「进入工作台」跳冷启动页（缺省整页跳转；测试注入 onFinish）。
 *
 * 六态挂点：本组件带 `loading` / `error`（读配置失败）；`empty` 归冷启动页；
 * `hover` / `active` / `disabled` 归设置页与保存脚（挂点全 feature 可达即可，见门禁脚本）。
 */
import { Button, ErrorState, ICONS, Spinner } from '@dforge/ui';
import type { CSSProperties, ReactNode } from 'react';
import { useState } from 'react';

import { t } from '@/i18n';
import { withDaemonEndpoint } from '@/lib/daemon-endpoint';

import type { SettingsApi } from '../api/settings-api';
import {
  advanceOnboarding,
  backOnboarding,
  createOnboardingState,
  ONBOARDING_STEP_IDS,
  type OnboardingOutcome,
  type OnboardingState,
  type OnboardingStepStatus,
  onboardingProgress,
  stepStatus,
} from '../model/onboarding';
import { type SettingsSectionId, settingsSection } from '../model/sections';
import { useSettingsSession } from '../model/use-settings-session';

import { SaveFooter } from './save-footer';
import { SettingsSectionForm } from './section-form';

const styles = {
  page: {
    display: 'grid',
    // alignContent: start —— 行按内容高度排布，避免 minHeight:100vh 把页头行撑开
    alignContent: 'start',
    gap: 'var(--dfg-space-6)',
    padding: 'var(--dfg-space-8)',
    minHeight: '100vh',
    background: 'var(--dfg-color-surface)',
    color: 'var(--dfg-color-text-primary)',
    fontFamily: 'var(--dfg-font-sans)',
    fontSize: 'var(--dfg-font-size-13)',
  },
  header: { display: 'grid', gap: 'var(--dfg-space-2)' },
  title: {
    margin: 0,
    fontSize: 'var(--dfg-font-size-24)',
    fontWeight: 'var(--dfg-font-weight-bold)',
  },
  subtitle: {
    margin: 0,
    color: 'var(--dfg-color-text-secondary)',
    lineHeight: 'var(--dfg-line-height-relaxed)',
  },
  progress: {
    margin: 0,
    color: 'var(--dfg-color-text-secondary)',
    fontSize: 'var(--dfg-font-size-12)',
  },
  loading: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--dfg-space-2)',
    color: 'var(--dfg-color-text-secondary)',
  },
  body: { display: 'flex', gap: 'var(--dfg-space-8)', alignItems: 'flex-start' },
  steps: {
    display: 'grid',
    gap: 'var(--dfg-space-1)',
    width: 'var(--dfg-size-sidebar)',
    flexShrink: 0,
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  stepItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--dfg-space-2)',
    minHeight: 'var(--dfg-control-height-md)',
    paddingInline: 'var(--dfg-space-3)',
    borderRadius: 'var(--dfg-radius-md)',
    color: 'var(--dfg-color-text-secondary)',
  },
  stepItemCurrent: {
    background: 'var(--dfg-color-selection)',
    color: 'var(--dfg-color-selection-text)',
    fontWeight: 'var(--dfg-font-weight-medium)',
  },
  stepName: { flex: 1 },
  stepDone: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--dfg-space-1)',
    color: 'var(--dfg-color-success)',
    fontSize: 'var(--dfg-font-size-11)',
  },
  stepSkipped: { color: 'var(--dfg-color-text-disabled)', fontSize: 'var(--dfg-font-size-11)' },
  panel: {
    display: 'grid',
    gap: 'var(--dfg-space-5)',
    flex: 1,
    minWidth: 0,
    padding: 'var(--dfg-space-6)',
    background: 'var(--dfg-color-surface)',
    border: 'var(--dfg-border-width-hairline) solid var(--dfg-color-border)',
    borderRadius: 'var(--dfg-radius-lg)',
  },
  panelTitle: {
    margin: 0,
    fontSize: 'var(--dfg-font-size-18)',
    fontWeight: 'var(--dfg-font-weight-medium)',
  },
  panelDesc: {
    margin: 0,
    color: 'var(--dfg-color-text-secondary)',
    fontSize: 'var(--dfg-font-size-12)',
  },
  errorLine: { margin: 0, color: 'var(--dfg-color-danger)', fontSize: 'var(--dfg-font-size-12)' },
  panelWrap: { flex: 1, minWidth: 0 },
  done: {
    display: 'grid',
    gap: 'var(--dfg-space-4)',
    justifyItems: 'center',
    padding: 'var(--dfg-space-8)',
    textAlign: 'center',
  },
  doneTitle: { fontSize: 'var(--dfg-font-size-18)', fontWeight: 'var(--dfg-font-weight-medium)' },
} satisfies Record<string, CSSProperties>;

/** 步骤条单步（勾选 / 跳过 / 当前高亮由状态机给态）。 */
function StepItem({ id, status }: { id: SettingsSectionId; status: OnboardingStepStatus }) {
  const section = settingsSection(id);
  const Icon = ICONS[section.icon];
  return (
    <li
      aria-current={status === 'current' ? 'step' : undefined}
      style={{
        ...styles.stepItem,
        ...(status === 'current' ? styles.stepItemCurrent : null),
      }}
    >
      <Icon />
      <span style={styles.stepName}>{t(section.titleKey)}</span>
      {status === 'done' ? (
        <span style={styles.stepDone}>
          <ICONS.CheckIcon />
          {t('onboarding.status.done')}
        </span>
      ) : null}
      {status === 'skipped' ? (
        <span style={styles.stepSkipped}>{t('onboarding.status.skipped')}</span>
      ) : null}
    </li>
  );
}

/** 默认完成动作：进入冷启动页（空库 → 一键示例）；端点参数经单点续写（D-3/UX-01）。 */
function defaultFinish(): void {
  if (typeof window !== 'undefined') {
    window.location.assign(withDaemonEndpoint('/settings/welcome'));
  }
}

/** OnboardingWizard props。 */
export interface OnboardingWizardProps {
  /** 数据面注入（测试用）。 */
  api?: SettingsApi;
  /** 完成动作（缺省整页跳转 `/settings/welcome`）。 */
  onFinish?: () => void;
}

/** 四步引导。 */
export function OnboardingWizard({ api, onFinish }: OnboardingWizardProps) {
  const session = useSettingsSession(api);
  const [machine, setMachine] = useState<OnboardingState>(createOnboardingState);

  const currentId = ONBOARDING_STEP_IDS[machine.index];
  const section = currentId === undefined ? undefined : settingsSection(currentId);
  const progress = onboardingProgress(machine);
  const isLast = machine.index === ONBOARDING_STEP_IDS.length - 1;

  /** 前进：done = 先落库（失败即停，失败条给重试）；skipped = 不落库。 */
  const advance = async (result: OnboardingOutcome): Promise<void> => {
    if (currentId === undefined) return;
    if (result === 'done') {
      const ok = await session.saveSection(currentId);
      if (!ok) return;
    }
    setMachine((previous) => advanceOnboarding(previous, result));
  };

  let content: ReactNode = null;
  if (session.loadPhase === 'loading') {
    content = (
      <div style={styles.loading} data-df-state="loading">
        <Spinner label={t('settings.loading')} />
        <span>{t('settings.loading')}</span>
      </div>
    );
  } else if (session.loadPhase === 'error') {
    content = (
      <div data-df-state="error" style={{ display: 'grid', gap: 'var(--dfg-space-2)' }}>
        <ErrorState
          title={t('settings.loadError.title')}
          description={t('settings.loadError.description')}
          retryLabel={t('settings.action.reload')}
          onRetry={session.reload}
        />
        {session.loadError === null ? null : <p style={styles.errorLine}>{session.loadError}</p>}
      </div>
    );
  } else if (machine.finished) {
    content = (
      <div style={styles.done}>
        <ICONS.CheckCircleIcon size={48} />
        <div style={styles.doneTitle}>{t('onboarding.done.title')}</div>
        <p style={styles.panelDesc}>{t('onboarding.done.desc')}</p>
        <Button
          variant="primary"
          onClick={() => {
            (onFinish ?? defaultFinish)();
          }}
        >
          {t('onboarding.done.action')}
        </Button>
      </div>
    );
  } else if (section !== undefined) {
    content = (
      <section style={styles.panel}>
        <h2 style={styles.panelTitle}>{t(section.titleKey)}</h2>
        <p style={styles.panelDesc}>{t(section.descriptionKey)}</p>
        <SettingsSectionForm id={section.id} session={session} />
        <SaveFooter
          saveLabel={isLast ? t('onboarding.action.finish') : t('onboarding.action.next')}
          saveState={session.saveState}
          disabled={false}
          extraActions={
            <>
              <Button
                disabled={machine.index === 0}
                onClick={() => {
                  setMachine((previous) => backOnboarding(previous));
                }}
              >
                {t('onboarding.action.back')}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  void advance('skipped');
                }}
              >
                {t('onboarding.action.skip')}
              </Button>
            </>
          }
          onSave={() => {
            void advance('done');
          }}
        />
      </section>
    );
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.title}>{t('onboarding.title')}</h1>
        <p style={styles.subtitle}>{t('onboarding.subtitle')}</p>
        <p style={styles.progress}>
          {t('onboarding.progress', { completed: progress.completed, total: progress.total })}
        </p>
      </header>

      <div style={styles.body}>
        <ol aria-label={t('onboarding.stepsLabel')} style={styles.steps}>
          {ONBOARDING_STEP_IDS.map((id) => (
            <StepItem key={id} id={id} status={stepStatus(machine, id)} />
          ))}
        </ol>
        <div style={styles.panelWrap}>{content}</div>
      </div>
    </div>
  );
}
