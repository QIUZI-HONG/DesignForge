'use client';

import type { SettingsSectionId } from '../model/sections';
/**
 * 分区表单装配（FE-09）：把「分区 id + 会话」装配成受控表单。
 *
 * 设置页（E3）与四步引导（E4）共用本组件——「四步与设置分区同源」在此落到实处：
 * 步骤体与设置分区不是两份相似的表单，而是**同一个组件**。
 */
import type { SettingsSession } from '../model/use-settings-session';

import { AiSection, ComfySection, TelemetrySection, WorkspaceSection } from './sections';

/** SettingsSectionForm props。 */
export interface SettingsSectionFormProps {
  id: SettingsSectionId;
  session: SettingsSession;
}

/** 按分区 id 渲染对应表单。 */
export function SettingsSectionForm({ id, session }: SettingsSectionFormProps) {
  const saving = session.saveState.phase === 'saving';
  const { draft } = session;

  switch (id) {
    case 'workspace':
      return (
        <WorkspaceSection
          value={draft.workspaceDir}
          onChange={(value) => {
            session.updateDraft({ workspaceDir: value });
          }}
          error={session.fieldError}
          disabled={saving}
        />
      );
    case 'ai':
      if (session.credentials === null) return null;
      return (
        <AiSection
          summary={session.credentials}
          apiKey={draft.apiKey}
          onApiKeyChange={(value) => {
            session.updateDraft({ apiKey: value });
          }}
          error={session.fieldError}
          disabled={saving}
          onClearKey={() => {
            void session.clearKey();
          }}
          clearing={session.clearingKey}
          clearError={session.keyError}
          onTestConnectivity={() => {
            void session.runProbe();
          }}
          checking={session.probe.checking}
          aiItem={session.probe.report?.items.find((item) => item.id === 'ai') ?? null}
          probeError={session.probe.error}
        />
      );
    case 'comfy':
      return (
        <ComfySection
          value={draft.comfyBaseUrl}
          onChange={(value) => {
            session.updateDraft({ comfyBaseUrl: value });
          }}
          error={session.fieldError}
          disabled={saving}
          onProbe={() => {
            void session.runProbe();
          }}
          checking={session.probe.checking}
          comfyItem={session.probe.report?.items.find((item) => item.id === 'comfyui') ?? null}
          probeError={session.probe.error}
        />
      );
    case 'telemetry':
      return (
        <TelemetrySection
          enabled={draft.telemetryEnabled}
          onChange={(enabled) => {
            session.updateDraft({ telemetryEnabled: enabled });
          }}
          disabled={saving}
          dataRoot={session.dataRoot}
        />
      );
  }
}
