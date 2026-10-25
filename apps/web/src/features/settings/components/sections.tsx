'use client';

/**
 * 设置分区表单（FE-09 · 清单 E3；引导步骤 E4 复用同一组组件）。
 *
 * 设计口径：分区组件是**受控**的——值/回调/校验文案/禁用由容器（设置页或引导）给，
 * 组件自身只做呈现与交互（含 Toast 提示），不直接发请求。容器共用
 * `use-settings-session`，因此设置页与引导的行为逐字段一致。
 *
 * 文案全部走 ICU 消息；样式全部走 `@dforge/ui` 令牌（组件禁裸值，`guard-tokens` 守卫）。
 * 凭据输入框固定 `type="password"`：既是掩码纪律，也让截图门禁天然拿不到明文。
 */
import type { ConnectivityItem, ConnectivityStatus, CredentialSummary } from '@dforge/contracts';
import { Button, Input, SegmentedControl, useToast } from '@dforge/ui';

import { t } from '@/i18n';

import { copyTextToClipboard } from './clipboard';

import './settings.css';

/* ---------- 连通性状态片 ---------- */

const CHIP_LABEL_KEY: Record<ConnectivityStatus, string> = {
  ok: 'settings.connectivity.status.ok',
  degraded: 'settings.connectivity.status.degraded',
  unavailable: 'settings.connectivity.status.unavailable',
  'not-configured': 'settings.connectivity.status.notConfigured',
};

/** 状态片（正常 / 降级 / 不可用 / 未配置；色调由 data-df-connectivity 在 CSS 承接）。 */
function StatusChip({ status }: { status: ConnectivityStatus }) {
  return (
    <span className="dfg-settings__chip" data-df-connectivity={status}>
      {t(CHIP_LABEL_KEY[status])}
    </span>
  );
}

/** daemon 建议动作 → 中文（未知动作原样透出：契约扩展时前端不静默吞掉）。 */
function connectivityActionLabel(action: string): string {
  const known: Record<string, string> = {
    'retry-probe': t('settings.connectivity.action.retry-probe'),
    'set-base-url': t('settings.connectivity.action.set-base-url'),
    'configure-credentials': t('settings.connectivity.action.configure-credentials'),
  };
  return known[action] ?? action;
}

/** 连通性条目展示（状态片 + daemon 原文 + 建议动作）。 */
function ConnectivityLine({ item }: { item: ConnectivityItem }) {
  return (
    <div className="dfg-settings__status-row">
      <StatusChip status={item.status} />
      {item.detail === null ? null : <span>{item.detail}</span>}
      {item.actions.map((action) => (
        <span key={action} className="dfg-settings__chip dfg-settings__chip--neutral">
          {connectivityActionLabel(action)}
        </span>
      ))}
    </div>
  );
}

/* ---------- 工作目录 ---------- */

/** WorkspaceSection props。 */
export interface WorkspaceSectionProps {
  value: string;
  onChange: (value: string) => void;
  error: string | null;
  disabled: boolean;
}

/** 工作目录分区（文本输入；可写性由 daemon 保存时校验）。 */
export function WorkspaceSection({ value, onChange, error, disabled }: WorkspaceSectionProps) {
  return (
    <div className="dfg-settings__form">
      <Input
        fieldLabel={t('settings.field.workspaceDir')}
        placeholder={t('settings.field.workspaceDir.placeholder')}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        hint={t('settings.field.workspaceDir.hint')}
        errorMessage={error ?? undefined}
        disabled={disabled}
      />
    </div>
  );
}

/* ---------- DeepSeek ---------- */

/** AiSection props。 */
export interface AiSectionProps {
  summary: CredentialSummary;
  apiKey: string;
  onApiKeyChange: (value: string) => void;
  error: string | null;
  disabled: boolean;
  onClearKey: () => void;
  clearing: boolean;
  clearError: string | null;
  onTestConnectivity: () => void;
  checking: boolean;
  /** 最近一次探测的 AI 条目（未探测为 null）。 */
  aiItem: ConnectivityItem | null;
  probeError: string | null;
}

/** DeepSeek 分区：掩码展示 / 写入 / 清除 / 连通性自检。 */
export function AiSection({
  summary,
  apiKey,
  onApiKeyChange,
  error,
  disabled,
  onClearKey,
  clearing,
  clearError,
  onTestConnectivity,
  checking,
  aiItem,
  probeError,
}: AiSectionProps) {
  const configured = summary.hasKey && summary.maskedKey !== null;
  const fromEnv = summary.source === 'env';
  return (
    <div className="dfg-settings__form">
      <p className="dfg-settings__hint">
        {configured
          ? t(fromEnv ? 'settings.credential.configuredEnv' : 'settings.credential.configured', {
              masked: summary.maskedKey ?? '',
            })
          : t('settings.credential.missing')}
      </p>
      <Input
        fieldLabel={t('settings.field.apiKey')}
        // 掩码纪律：凭据输入框固定 password，截图门禁与肉眼都拿不到明文
        type="password"
        autoComplete="off"
        placeholder={t('settings.field.apiKey.placeholder')}
        value={apiKey}
        onChange={(event) => {
          onApiKeyChange(event.target.value);
        }}
        hint={t('settings.field.apiKey.hint')}
        errorMessage={error ?? undefined}
        disabled={disabled}
      />
      <div className="dfg-settings__actions">
        {configured && !fromEnv ? (
          <Button onClick={onClearKey} loading={clearing}>
            {t('settings.action.clearKey')}
          </Button>
        ) : null}
        <Button onClick={onTestConnectivity} loading={checking}>
          {t('settings.action.testConnectivity')}
        </Button>
      </div>
      {clearError === null ? null : <p className="dfg-settings__error">{clearError}</p>}
      {probeError === null ? null : (
        <p className="dfg-settings__error">
          {t('settings.connectivity.probeFailed', { message: probeError })}
        </p>
      )}
      {aiItem === null ? null : <ConnectivityLine item={aiItem} />}
    </div>
  );
}

/* ---------- ComfyUI ---------- */

/** ComfySection props。 */
export interface ComfySectionProps {
  value: string;
  onChange: (value: string) => void;
  error: string | null;
  disabled: boolean;
  onProbe: () => void;
  checking: boolean;
  /** 最近一次探测的 ComfyUI 条目（未探测为 null → 未启动判定不成立，见文案）。 */
  comfyItem: ConnectivityItem | null;
  probeError: string | null;
}

/** ComfyUI 分区：地址配置 + 探测（未启动是一等状态，不报错）。 */
export function ComfySection({
  value,
  onChange,
  error,
  disabled,
  onProbe,
  checking,
  comfyItem,
  probeError,
}: ComfySectionProps) {
  return (
    <div className="dfg-settings__form">
      <Input
        fieldLabel={t('settings.field.comfyUrl')}
        placeholder={t('settings.field.comfyUrl.placeholder')}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        hint={t('settings.field.comfyUrl.hint')}
        errorMessage={error ?? undefined}
        disabled={disabled}
      />
      <div className="dfg-settings__actions">
        <Button onClick={onProbe} loading={checking}>
          {t('settings.action.reprobe')}
        </Button>
      </div>
      {probeError === null ? null : (
        <p className="dfg-settings__error">
          {t('settings.connectivity.probeFailed', { message: probeError })}
        </p>
      )}
      {comfyItem === null ? (
        probeError === null ? (
          <p className="dfg-settings__hint">{t('settings.comfy.unprobed')}</p>
        ) : null
      ) : (
        <ConnectivityLine item={comfyItem} />
      )}
    </div>
  );
}

/* ---------- 埋点与数据 ---------- */

/** TelemetrySection props。 */
export interface TelemetrySectionProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  disabled: boolean;
  /** daemon 数据目录（GET /health 的 dataRoot）。 */
  dataRoot: string;
}

/** 埋点与数据分区：仅本地开关（默认开）+ 数据目录展示与复制。 */
export function TelemetrySection({ enabled, onChange, disabled, dataRoot }: TelemetrySectionProps) {
  const toast = useToast();
  return (
    <div className="dfg-settings__form">
      <SegmentedControl
        label={t('settings.telemetry.label')}
        value={enabled ? 'local' : 'off'}
        onChange={(value) => {
          onChange(value === 'local');
        }}
        options={[
          { value: 'local', label: t('settings.telemetry.localOnly'), disabled },
          { value: 'off', label: t('settings.telemetry.off'), disabled },
        ]}
      />
      <p className="dfg-settings__hint">{t('settings.telemetry.hint')}</p>
      <div className="dfg-settings__status-row">
        <span>{t('settings.dataDir.label')}</span>
        <span className="dfg-settings__path">{dataRoot}</span>
        <Button
          size="sm"
          onClick={() => {
            void copyTextToClipboard(dataRoot).then((ok) => {
              toast.show({
                message: ok ? t('settings.dataDir.copied') : t('settings.dataDir.copyFailed'),
                tone: ok ? 'success' : 'error',
              });
            });
          }}
        >
          {t('settings.action.copyPath')}
        </Button>
      </div>
      <p className="dfg-settings__hint">{t('settings.dataDir.hint')}</p>
    </div>
  );
}
