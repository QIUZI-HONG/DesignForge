/**
 * 设置草稿与落库载荷映射（FE-09）。
 *
 * 草稿 = 「可编辑字段」的运行时形态（设置页与引导步骤共用一份结构）。
 * 纪律：**密钥草稿恒不回显**——`apiKey` 只承载用户本次输入，空串表示「本次不动凭据」；
 * 掩码摘要（CredentialSummary）是另一条只读通路，两者不混。
 * `patchesForSection` 是分区 → daemon 载荷的唯一定义：设置页「保存」与引导「下一步」
 * 由此保证逐字段一致（完成态落库 = 逐分区应用本映射）。
 */
import type { DaemonConfig, DaemonConfigPatch } from '@dforge/contracts';

import type { SettingsSectionId } from './sections';

/** 可编辑草稿。 */
export interface SettingsDraft {
  workspaceDir: string;
  comfyBaseUrl: string;
  telemetryEnabled: boolean;
  /** 编辑中的新 key（空串 = 本次不写凭据）。 */
  apiKey: string;
}

/** 空草稿。 */
export const EMPTY_DRAFT: SettingsDraft = {
  workspaceDir: '',
  comfyBaseUrl: '',
  telemetryEnabled: true,
  apiKey: '',
};

/** 配置 → 草稿（密钥草稿留空：凭据永不回显）。 */
export function draftFromConfig(config: DaemonConfig): SettingsDraft {
  return {
    workspaceDir: config.workspaceDir,
    comfyBaseUrl: config.comfy.baseUrl,
    telemetryEnabled: config.telemetry.enabled,
    apiKey: '',
  };
}

/** 分区落库载荷（config 补丁与/或凭据写入；都不含则本分区无落库动作）。 */
export interface SectionPersistence {
  config?: DaemonConfigPatch;
  /** 非空 = 写入该 key；null = 本分区不写凭据。 */
  apiKey?: string | null;
}

/** 分区 → 落库载荷（唯一映射，设置页与引导共用）。 */
export function patchesForSection(id: SettingsSectionId, draft: SettingsDraft): SectionPersistence {
  switch (id) {
    case 'workspace':
      return { config: { workspaceDir: draft.workspaceDir.trim() } };
    case 'ai': {
      const apiKey = draft.apiKey.trim();
      return { apiKey: apiKey.length > 0 ? apiKey : null };
    }
    case 'comfy':
      return { config: { comfy: { baseUrl: draft.comfyBaseUrl.trim() } } };
    case 'telemetry':
      return { config: { telemetry: { enabled: draft.telemetryEnabled } } };
  }
}
