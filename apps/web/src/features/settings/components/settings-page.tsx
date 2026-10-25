'use client';

/**
 * 设置页（FE-09 · 清单 E3，对标页·结构：左分区导航 + 右表单，浅色首页族）。
 *
 * 结构：左导航列出表单分区（注册表 `SETTINGS_SECTIONS` 定序）+ **诊断**（D1 · FE-06
 * 既有声明落点：诊断面板归设置页），右侧渲染当前分区表单 + 保存脚
 * （保存中 → 已保存 → 失败重试）或诊断分区（只读观察面，无保存脚）。数据流全部走
 * `useSettingsSession`。
 *
 * 六态挂点（验收标准 §6）：
 * - 本组件：`loading`（读取配置中）/ `error`（读配置失败，可重新加载）/ `hover`（左导航项）；
 * - 冷启动页：`empty`；保存脚：`active` / `disabled`（见各自组件注释）。
 *
 * 导航项 hover 由 CSS 伪类承接（工单 06 样式单轨：域内 settings.css 已有伪类通道；
 * `data-df-state="hover"` 静态挂点保留给截图门禁取样）。
 */
import { Button, ErrorState, ICONS, Spinner } from '@dforge/ui';
import { useState } from 'react';

import { DiagnosticsPanel } from '@/features/diagnostics';
import { t } from '@/i18n';

import type { SettingsApi } from '../api/settings-api';
import {
  SETTINGS_DIAGNOSTICS_NAV,
  SETTINGS_SECTIONS,
  type SettingsNavId,
  settingsSection,
} from '../model/sections';
import { useSettingsSession } from '../model/use-settings-session';

import { SaveFooter } from './save-footer';
import { SettingsSectionForm } from './section-form';

import './settings.css';

/** 左导航项（激活态走 aria-current；hover 走 CSS 伪类）。 */
function NavItem({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: keyof typeof ICONS;
  label: string;
  onClick: () => void;
}) {
  const Icon = ICONS[icon];
  return (
    <button
      type="button"
      // 六态挂点：hover —— 导航项悬停底色证据（截图门禁复现非默认态用）
      data-df-state="hover"
      aria-current={active ? 'true' : undefined}
      className="dfg-settings__nav-item"
      onClick={onClick}
    >
      <Icon />
      {label}
    </button>
  );
}

/** SettingsPage props。 */
export interface SettingsPageProps {
  /** 数据面注入（测试用；缺省走环境变量 baseUrl + 全局 fetch）。 */
  api?: SettingsApi;
}

/** 设置页。 */
export function SettingsPage({ api }: SettingsPageProps) {
  const session = useSettingsSession(api);
  const [activeSection, setActiveSection] = useState<SettingsNavId>('workspace');
  // 诊断抽屉开合：选导航项即打开；关闭（Esc/遮罩/关闭按钮）后停在分区（再入口可重开）
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);

  const isDiagnostics = activeSection === SETTINGS_DIAGNOSTICS_NAV.id;
  const section = isDiagnostics ? null : settingsSection(activeSection);
  const sectionTitle =
    section === null ? t(SETTINGS_DIAGNOSTICS_NAV.titleKey) : t(section.titleKey);
  const sectionDescription =
    section === null ? t(SETTINGS_DIAGNOSTICS_NAV.descriptionKey) : t(section.descriptionKey);

  return (
    <div className="dfg-settings__page">
      <header className="dfg-settings__header">
        <h1 className="dfg-settings__title">{t('settings.title')}</h1>
        <p className="dfg-settings__subtitle">{t('settings.subtitle')}</p>
      </header>

      {session.loadPhase === 'loading' ? (
        <div className="dfg-settings__loading" data-df-state="loading">
          <Spinner label={t('settings.loading')} />
          <span>{t('settings.loading')}</span>
        </div>
      ) : null}

      {session.loadPhase === 'error' ? (
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
      ) : null}

      {session.loadPhase === 'ready' && session.config !== null && session.credentials !== null ? (
        <div className="dfg-settings__body">
          <nav aria-label={t('settings.nav.label')} className="dfg-settings__nav">
            {SETTINGS_SECTIONS.map((item) => (
              <NavItem
                key={item.id}
                active={item.id === activeSection}
                icon={item.icon}
                label={t(item.titleKey)}
                onClick={() => {
                  setActiveSection(item.id);
                }}
              />
            ))}
            {/* 诊断分区（D1）：表单分区之外的第 5 项——点击即打开诊断抽屉（FE-06 声明落点） */}
            <NavItem
              key={SETTINGS_DIAGNOSTICS_NAV.id}
              active={isDiagnostics}
              icon={SETTINGS_DIAGNOSTICS_NAV.icon}
              label={t(SETTINGS_DIAGNOSTICS_NAV.titleKey)}
              onClick={() => {
                setActiveSection(SETTINGS_DIAGNOSTICS_NAV.id);
                setDiagnosticsOpen(true);
              }}
            />
          </nav>

          <section className="dfg-settings__panel" data-df-settings-section={activeSection}>
            <h2 className="dfg-settings__panel-title">{sectionTitle}</h2>
            <p className="dfg-settings__panel-desc">{sectionDescription}</p>

            {isDiagnostics ? (
              <>
                <Button
                  onClick={() => {
                    setDiagnosticsOpen(true);
                  }}
                >
                  {t('settings.action.openDiagnostics')}
                </Button>
                <DiagnosticsPanel open={diagnosticsOpen} onOpenChange={setDiagnosticsOpen} />
              </>
            ) : (
              <>
                <SettingsSectionForm id={activeSection} session={session} />

                <SaveFooter
                  saveLabel={
                    activeSection === 'ai'
                      ? t('settings.action.saveKey')
                      : t('settings.action.save')
                  }
                  saveState={session.saveState}
                  disabled={!session.isDirty(activeSection)}
                  onSave={() => {
                    void session.saveSection(activeSection);
                  }}
                />
              </>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
