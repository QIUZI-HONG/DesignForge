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
 * 进度持久化（票 17 · spec P2）：状态机每次变化后落本地（localStorage，本地优先纪律：
 * 不联网、不上云），刷新/后退后从原进度续作，不回第 1 步、进度不归零。
 *
 * 六态挂点：本组件带 `loading` / `error`（读配置失败）；`empty` 归冷启动页；
 * `hover` / `active` / `disabled` 归设置页与保存脚（挂点全 feature 可达即可，见门禁脚本）。
 */
import { Button, ErrorState, ICONS, Spinner } from '@dforge/ui';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

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
import { createOnboardingPersistence } from '../model/onboarding-storage';
import { type SettingsSectionId, settingsSection } from '../model/sections';
import { useSettingsSession } from '../model/use-settings-session';

import { SaveFooter } from './save-footer';
import { SettingsSectionForm } from './section-form';

import './settings.css';

/** 步骤条单步（勾选 / 跳过 / 当前高亮由状态机给态；当前步走 aria-current 在 CSS 承接）。 */
function StepItem({ id, status }: { id: SettingsSectionId; status: OnboardingStepStatus }) {
  const section = settingsSection(id);
  const Icon = ICONS[section.icon];
  return (
    <li
      aria-current={status === 'current' ? 'step' : undefined}
      className="dfg-settings__step-item"
    >
      <Icon />
      <span className="dfg-settings__step-name">{t(section.titleKey)}</span>
      {status === 'done' ? (
        <span className="dfg-settings__step-done">
          <ICONS.CheckIcon />
          {t('onboarding.status.done')}
        </span>
      ) : null}
      {status === 'skipped' ? (
        <span className="dfg-settings__step-skipped">{t('onboarding.status.skipped')}</span>
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
  // 进度本地持久化（票 17 · spec P2）：刷新/后退后从原进度续作，不回第 1 步。
  // 后端省略时走浏览器 localStorage（SSR 下为空操作）；坏数据/写失败不炸界面（见 storage 模块契约）。
  const [persistence] = useState(() => createOnboardingPersistence());
  // 恢复完成前不写本地：否则挂载首帧的初始态会把已存进度盖掉。
  const [hydrated, setHydrated] = useState(false);

  // 挂载后恢复本地进度（SSR 不读 localStorage，避免水合不一致；口径同 theme-toggle 先例）。
  useEffect(() => {
    const stored = persistence.load();
    if (stored !== null) setMachine(stored);
    setHydrated(true);
  }, [persistence]);

  // 状态机每次变化（前进/回退/完成/续作）后落本地；保存失败只丢持久化，不影响本次会话。
  useEffect(() => {
    if (!hydrated) return;
    persistence.save(machine);
  }, [hydrated, machine, persistence]);

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
      <div className="dfg-settings__loading" data-df-state="loading">
        <Spinner label={t('settings.loading')} />
        <span>{t('settings.loading')}</span>
      </div>
    );
  } else if (session.loadPhase === 'error') {
    content = (
      <div data-df-state="error" className="dfg-settings__stack">
        <ErrorState
          title={t('settings.loadError.title')}
          description={t('settings.loadError.description')}
          retryLabel={t('settings.action.reload')}
          onRetry={session.reload}
        />
        {session.loadError === null ? null : (
          <p className="dfg-settings__error-line">{session.loadError}</p>
        )}
      </div>
    );
  } else if (machine.finished) {
    content = (
      <div className="dfg-settings__done">
        <ICONS.CheckCircleIcon size={48} />
        <div className="dfg-settings__done-title">{t('onboarding.done.title')}</div>
        <p className="dfg-settings__panel-desc">{t('onboarding.done.desc')}</p>
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
      <section className="dfg-settings__panel">
        <h2 className="dfg-settings__panel-title">{t(section.titleKey)}</h2>
        <p className="dfg-settings__panel-desc">{t(section.descriptionKey)}</p>
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
    <div className="dfg-settings__page">
      <header className="dfg-settings__header">
        <h1 className="dfg-settings__title">{t('onboarding.title')}</h1>
        <p className="dfg-settings__subtitle">{t('onboarding.subtitle')}</p>
        <p className="dfg-settings__progress">
          {t('onboarding.progress', { completed: progress.completed, total: progress.total })}
        </p>
      </header>

      <div className="dfg-settings__body">
        <ol aria-label={t('onboarding.stepsLabel')} className="dfg-settings__steps">
          {ONBOARDING_STEP_IDS.map((id) => (
            <StepItem key={id} id={id} status={stepStatus(machine, id)} />
          ))}
        </ol>
        <div className="dfg-settings__panel-wrap">{content}</div>
      </div>
    </div>
  );
}
