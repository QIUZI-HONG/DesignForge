/**
 * 草稿与校验测试（FE-09）。
 *
 * 覆盖三件事：
 * 1. 表单校验（工作目录 / ComfyUI 地址）——纯函数，错误以**枚举码**返回（文案归 i18n）；
 * 2. 配置 → 草稿的映射（含「密钥草稿恒为空」的纪律）；
 * 3. 分区 → 落库载荷的映射（设置页与引导步骤共用，保证「完成态落库」逐字段一致）。
 */
import type { DaemonConfig } from '@dforge/contracts';
import { describe, expect, it } from 'vitest';

import { draftFromConfig, EMPTY_DRAFT, isSectionDirty, patchesForSection } from './draft';
import { validateComfyBaseUrl, validateWorkspaceDir } from './validation';

const CONFIG: DaemonConfig = {
  workspaceDir: '/home/u/设界',
  ai: { provider: 'deepseek', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com' },
  comfy: { baseUrl: 'http://127.0.0.1:8188', installPath: null },
  telemetry: { enabled: true },
};

describe('表单校验', () => {
  it('工作目录：空与纯空白都拒（错误码 empty）', () => {
    expect(validateWorkspaceDir('')).toBe('empty');
    expect(validateWorkspaceDir('   ')).toBe('empty');
  });

  it('工作目录：非空串放行（可写性由 daemon 归一与校验，前端不越权判目录）', () => {
    expect(validateWorkspaceDir('~/设计')).toBeNull();
    expect(validateWorkspaceDir('/home/u/设界')).toBeNull();
  });

  it('ComfyUI 地址：空拒（empty），非 http(s) 拒（invalid-url），http 本地地址放行', () => {
    expect(validateComfyBaseUrl('')).toBe('empty');
    expect(validateComfyBaseUrl('127.0.0.1:8188')).toBe('invalid-url');
    expect(validateComfyBaseUrl('ftp://127.0.0.1')).toBe('invalid-url');
    expect(validateComfyBaseUrl('http://127.0.0.1:8188')).toBeNull();
  });
});

describe('草稿', () => {
  it('空草稿：密钥段恒为空（凭据不回显，编辑中的 key 不落任何存储）', () => {
    expect(EMPTY_DRAFT.apiKey).toBe('');
    expect(EMPTY_DRAFT.workspaceDir).toBe('');
  });

  it('配置 → 草稿：只带可编辑字段，密钥草稿留空', () => {
    const draft = draftFromConfig(CONFIG);
    expect(draft).toEqual({
      workspaceDir: '/home/u/设界',
      comfyBaseUrl: 'http://127.0.0.1:8188',
      telemetryEnabled: true,
      apiKey: '',
    });
  });
});

describe('分区 → 落库载荷（设置页与引导共用）', () => {
  const draft = {
    ...EMPTY_DRAFT,
    workspaceDir: '~/设计',
    comfyBaseUrl: 'http://x:1',
    apiKey: 'sk-abcdefgh1234',
  };

  it('工作目录分区：产 config.workspaceDir 补丁', () => {
    expect(patchesForSection('workspace', draft)).toEqual({
      config: { workspaceDir: '~/设计' },
    });
  });

  it('AI 分区：产 apiKey（非空才落库；由调用方先 trim）', () => {
    expect(patchesForSection('ai', draft)).toEqual({ apiKey: 'sk-abcdefgh1234' });
    expect(patchesForSection('ai', { ...draft, apiKey: '' })).toEqual({ apiKey: null });
  });

  it('出图分区：产 config.comfy.baseUrl 补丁', () => {
    expect(patchesForSection('comfy', draft)).toEqual({
      config: { comfy: { baseUrl: 'http://x:1' } },
    });
  });

  it('埋点分区：产 config.telemetry.enabled 补丁（默认仅本地，开关即授权口径）', () => {
    expect(patchesForSection('telemetry', { ...draft, telemetryEnabled: false })).toEqual({
      config: { telemetry: { enabled: false } },
    });
  });
});

describe('分区脏检查（决定保存按钮可用性）', () => {
  it('与配置一致 = clean；任一字段改动 = dirty', () => {
    const clean = draftFromConfig(CONFIG);
    expect(isSectionDirty('workspace', clean, CONFIG)).toBe(false);
    expect(isSectionDirty('comfy', clean, CONFIG)).toBe(false);
    expect(isSectionDirty('telemetry', clean, CONFIG)).toBe(false);
    expect(isSectionDirty('workspace', { ...clean, workspaceDir: '~/另一个' }, CONFIG)).toBe(true);
    expect(
      isSectionDirty('comfy', { ...clean, comfyBaseUrl: 'http://127.0.0.1:9000' }, CONFIG),
    ).toBe(true);
    expect(isSectionDirty('telemetry', { ...clean, telemetryEnabled: false }, CONFIG)).toBe(true);
  });

  it('AI 分区：只有输入了非空 key 才算 dirty（空白输入不启用保存）', () => {
    const clean = draftFromConfig(CONFIG);
    expect(isSectionDirty('ai', clean, CONFIG)).toBe(false);
    expect(isSectionDirty('ai', { ...clean, apiKey: '   ' }, CONFIG)).toBe(false);
    expect(isSectionDirty('ai', { ...clean, apiKey: 'sk-abcdefgh1234' }, CONFIG)).toBe(true);
  });
});
