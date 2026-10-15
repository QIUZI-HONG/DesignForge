'use client';

/**
 * 设置会话（FE-09）：加载 → 草稿 → 逐分区落库 → 保存态。
 *
 * 为什么把这段逻辑收进一个 hook：设置页（E3）与四步引导（E4）共用同一套
 * 「读配置 / 改草稿 / 落库 / 展示保存态」行为——分区 → 载荷映射（draft.ts）
 * 保证两侧逐字段一致，本 hook 保证两侧的加载与失败处理一致。
 *
 * 边界：明文 key 只存在于 `draft.apiKey`（本次输入）与在飞请求的调用栈里；
 * 展示通路一律走 `credentials.maskedKey`（掩码摘要）。
 */
import type { ConnectivityReport, CredentialSummary, DaemonConfig } from '@dforge/contracts';
import { isPlausibleApiKey } from '@dforge/contracts';
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';

import { t } from '@/i18n';

import { createSettingsApi, type SettingsApi } from '../api/settings-api';
import {
  draftFromConfig,
  EMPTY_DRAFT,
  isSectionDirty,
  patchesForSection,
  type SettingsDraft,
} from './draft';
import {
  INITIAL_SAVE_STATE,
  reduceSaveState,
  type SaveState,
  saveErrorMessage,
} from './save-state';
import type { SettingsSectionId } from './sections';
import { type FieldErrorCode, validateComfyBaseUrl, validateWorkspaceDir } from './validation';

/** 加载相。 */
export type SessionLoadPhase = 'loading' | 'ready' | 'error';

/** 连通性探测态。 */
export interface ProbeState {
  checking: boolean;
  report: ConnectivityReport | null;
  error: string | null;
}

/** 会话接口（设置页 / 引导共用的唯一容器能力）。 */
export interface SettingsSession {
  loadPhase: SessionLoadPhase;
  loadError: string | null;
  config: DaemonConfig | null;
  credentials: CredentialSummary | null;
  /** daemon 数据目录（「埋点与数据」展示真源）。 */
  dataRoot: string;
  draft: SettingsDraft;
  /** 改草稿（同时把保存指示让位回 idle）。 */
  updateDraft: (patch: Partial<SettingsDraft>) => void;
  saveState: SaveState;
  /** 当前分区的表单校验文案（无错误为 null）。 */
  fieldError: string | null;
  /** 分区是否有未落库改动（决定保存按钮可用性）。 */
  isDirty: (id: SettingsSectionId) => boolean;
  /** 落库该分区（本地校验 → 写 daemon；成功同步草稿与凭据摘要）。 */
  saveSection: (id: SettingsSectionId) => Promise<boolean>;
  reload: () => void;
  probe: ProbeState;
  runProbe: () => Promise<void>;
  clearingKey: boolean;
  keyError: string | null;
  clearKey: () => Promise<void>;
}

/** 字段错误码 → 文案。 */
function fieldErrorText(code: FieldErrorCode): string {
  return code === 'empty' ? t('settings.error.empty') : t('settings.error.invalidUrl');
}

/** 分区本地校验（形态层；可写性 / URL 语义由 daemon 兜底）。 */
function sectionFieldError(id: SettingsSectionId, draft: SettingsDraft): string | null {
  if (id === 'workspace') {
    const code = validateWorkspaceDir(draft.workspaceDir);
    return code === null ? null : fieldErrorText(code);
  }
  if (id === 'comfy') {
    const code = validateComfyBaseUrl(draft.comfyBaseUrl);
    return code === null ? null : fieldErrorText(code);
  }
  if (id === 'ai') {
    const key = draft.apiKey.trim();
    if (key.length === 0) return null;
    return isPlausibleApiKey(key) ? null : t('settings.error.apiKeyShape');
  }
  return null;
}

/** 创建设置会话。 */
export function useSettingsSession(api?: SettingsApi): SettingsSession {
  const client = useMemo(() => api ?? createSettingsApi(), [api]);

  const [loadPhase, setLoadPhase] = useState<SessionLoadPhase>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [config, setConfig] = useState<DaemonConfig | null>(null);
  const [credentials, setCredentials] = useState<CredentialSummary | null>(null);
  const [dataRoot, setDataRoot] = useState('');
  const [draft, setDraft] = useState<SettingsDraft>(EMPTY_DRAFT);
  const [saveState, dispatchSave] = useReducer(reduceSaveState, INITIAL_SAVE_STATE);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [probe, setProbe] = useState<ProbeState>({ checking: false, report: null, error: null });
  const [clearingKey, setClearingKey] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoadPhase('loading');
    setLoadError(null);
    try {
      const [response, health] = await Promise.all([client.loadConfig(), client.loadHealth()]);
      setConfig(response.config);
      setCredentials(response.credentials.deepseek);
      setDataRoot(health.dataRoot);
      setDraft(draftFromConfig(response.config));
      setLoadPhase('ready');
    } catch (error) {
      setLoadError(saveErrorMessage(error));
      setLoadPhase('error');
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateDraft = useCallback((patch: Partial<SettingsDraft>): void => {
    setDraft((previous) => ({ ...previous, ...patch }));
    setFieldError(null);
    dispatchSave({ type: 'edit' });
  }, []);

  const isDirty = useCallback(
    (id: SettingsSectionId): boolean =>
      config === null ? false : isSectionDirty(id, draft, config),
    [config, draft],
  );

  const saveSection = useCallback(
    async (id: SettingsSectionId): Promise<boolean> => {
      const validation = sectionFieldError(id, draft);
      if (validation !== null) {
        setFieldError(validation);
        return false;
      }
      setFieldError(null);
      const persistence = patchesForSection(id, draft);
      dispatchSave({ type: 'start' });
      try {
        let nextConfig: DaemonConfig | null = null;
        if (persistence.config !== undefined) {
          const response = await client.patchConfig(persistence.config);
          nextConfig = response.config;
          setConfig(response.config);
          setCredentials(response.credentials.deepseek);
        }
        if (persistence.apiKey !== undefined && persistence.apiKey !== null) {
          setCredentials(await client.setApiKey(persistence.apiKey));
        }
        // 落库成功：只同步本分区字段（其他分区未保存的编辑不动）+ AI 分区清空密钥草稿
        setDraft((previous) => {
          const next = { ...previous };
          if (id === 'ai') next.apiKey = '';
          if (nextConfig !== null && id === 'workspace') {
            next.workspaceDir = nextConfig.workspaceDir;
          }
          if (nextConfig !== null && id === 'comfy') {
            next.comfyBaseUrl = nextConfig.comfy.baseUrl;
          }
          if (nextConfig !== null && id === 'telemetry') {
            next.telemetryEnabled = nextConfig.telemetry.enabled;
          }
          return next;
        });
        dispatchSave({ type: 'succeeded' });
        return true;
      } catch (error) {
        dispatchSave({ type: 'failed', message: saveErrorMessage(error) });
        return false;
      }
    },
    [client, draft],
  );

  const runProbe = useCallback(async (): Promise<void> => {
    setProbe((previous) => ({ ...previous, checking: true, error: null }));
    try {
      const report = await client.checkConnectivity();
      setProbe({ checking: false, report, error: null });
    } catch (error) {
      setProbe({ checking: false, report: null, error: saveErrorMessage(error) });
    }
  }, [client]);

  const clearKey = useCallback(async (): Promise<void> => {
    setClearingKey(true);
    setKeyError(null);
    try {
      setCredentials(await client.clearApiKey());
    } catch (error) {
      setKeyError(saveErrorMessage(error));
    } finally {
      setClearingKey(false);
    }
  }, [client]);

  return {
    loadPhase,
    loadError,
    config,
    credentials,
    dataRoot,
    draft,
    updateDraft,
    saveState,
    fieldError,
    isDirty,
    saveSection,
    reload: () => {
      void load();
    },
    probe,
    runProbe,
    clearingKey,
    keyError,
    clearKey,
  };
}
