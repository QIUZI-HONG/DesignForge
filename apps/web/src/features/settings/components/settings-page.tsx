'use client';

/**
 * 设置页（FE-09 · 清单 E3，对标页·结构：左分区导航 + 右表单，浅色首页族）。
 *
 * 结构：左导航列出四个分区（注册表 `SETTINGS_SECTIONS` 定序），右侧渲染当前分区
 * 表单 + 保存脚（保存中 → 已保存 → 失败重试）。数据流全部走 `useSettingsSession`。
 *
 * 六态挂点（验收标准 §6）：
 * - 本组件：`loading`（读取配置中）/ `error`（读配置失败，可重新加载）/ `hover`（左导航项）；
 * - 冷启动页：`empty`；保存脚：`active` / `disabled`（见各自组件注释）。
 *
 * 为什么导航项 hover 用 React 态而不是 CSS 伪类：内联令牌样式里没有伪类通道，
 * 本票不新增样式文件（避免与 FE-01/FE-11 的样式面重叠），故用 enter/leave 显式驱动。
 */
import { ErrorState, ICONS, Spinner } from '@dforge/ui';
import type { CSSProperties } from 'react';
import { useState } from 'react';

import { t } from '@/i18n';

import type { SettingsApi } from '../api/settings-api';
import { SETTINGS_SECTIONS, type SettingsSectionId, settingsSection } from '../model/sections';
import { useSettingsSession } from '../model/use-settings-session';

import { SaveFooter } from './save-footer';
import { SettingsSectionForm } from './section-form';

const styles = {
  page: {
    display: 'grid',
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
  loading: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--dfg-space-2)',
    color: 'var(--dfg-color-text-secondary)',
  },
  body: { display: 'flex', gap: 'var(--dfg-space-8)', alignItems: 'flex-start' },
  nav: {
    display: 'grid',
    gap: 'var(--dfg-space-1)',
    width: 'var(--dfg-size-sidebar)',
    flexShrink: 0,
  },
  navItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--dfg-space-2)',
    height: 'var(--dfg-control-height-md)',
    paddingInline: 'var(--dfg-space-3)',
    border: 'none',
    borderRadius: 'var(--dfg-radius-md)',
    background: 'transparent',
    color: 'var(--dfg-color-text-secondary)',
    fontFamily: 'inherit',
    fontSize: 'var(--dfg-font-size-13)',
    textAlign: 'left',
    cursor: 'pointer',
  },
  navItemActive: {
    background: 'var(--dfg-color-selection)',
    color: 'var(--dfg-color-selection-text)',
    fontWeight: 'var(--dfg-font-weight-medium)',
  },
  navItemHover: { background: 'var(--dfg-color-hover)' },
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
} satisfies Record<string, CSSProperties>;

/** 左导航项（hover 由 React 态驱动，见模块头注释）。 */
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
  const [hovered, setHovered] = useState(false);
  const Icon = ICONS[icon];
  return (
    <button
      type="button"
      // 六态挂点：hover —— 导航项悬停底色证据
      data-df-state="hover"
      aria-current={active ? 'true' : undefined}
      style={{
        ...styles.navItem,
        ...(active ? styles.navItemActive : null),
        ...(!active && hovered ? styles.navItemHover : null),
      }}
      onMouseEnter={() => {
        setHovered(true);
      }}
      onMouseLeave={() => {
        setHovered(false);
      }}
      onFocus={() => {
        setHovered(true);
      }}
      onBlur={() => {
        setHovered(false);
      }}
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
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('workspace');

  const section = settingsSection(activeSection);
  const sectionTitle = t(section.titleKey);

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.title}>{t('settings.title')}</h1>
        <p style={styles.subtitle}>{t('settings.subtitle')}</p>
      </header>

      {session.loadPhase === 'loading' ? (
        <div style={styles.loading} data-df-state="loading">
          <Spinner label={t('settings.loading')} />
          <span>{t('settings.loading')}</span>
        </div>
      ) : null}

      {session.loadPhase === 'error' ? (
        <div data-df-state="error" style={{ display: 'grid', gap: 'var(--dfg-space-2)' }}>
          <ErrorState
            title={t('settings.loadError.title')}
            description={t('settings.loadError.description')}
            retryLabel={t('settings.action.reload')}
            onRetry={session.reload}
          />
          {session.loadError === null ? null : <p style={styles.errorLine}>{session.loadError}</p>}
        </div>
      ) : null}

      {session.loadPhase === 'ready' && session.config !== null && session.credentials !== null ? (
        <div style={styles.body}>
          <nav aria-label={t('settings.nav.label')} style={styles.nav}>
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
          </nav>

          <section style={styles.panel}>
            <h2 style={styles.panelTitle}>{sectionTitle}</h2>
            <p style={styles.panelDesc}>{t(section.descriptionKey)}</p>

            <SettingsSectionForm id={activeSection} session={session} />

            <SaveFooter
              saveLabel={
                activeSection === 'ai' ? t('settings.action.saveKey') : t('settings.action.save')
              }
              saveState={session.saveState}
              disabled={!session.isDirty(activeSection)}
              onSave={() => {
                void session.saveSection(activeSection);
              }}
            />
          </section>
        </div>
      ) : null}
    </div>
  );
}
