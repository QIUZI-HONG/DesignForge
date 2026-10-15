/**
 * 能力词表与守门口径测试（接缝：`@/features/market/capabilities`）。
 *
 * 断言规格 §7.1 的授权口径逐词落地、词表外能力**按最保守处理**（需显式授权）、
 * license 三档与安装按钮三态的映射不透支乐观默认。
 */

import { describe, expect, it } from 'vitest';

import {
  describeCapabilities,
  describeCapability,
  describeInstallButton,
  describeLicenseGate,
} from './capabilities';

describe('capabilities · 词表（§7.1，不新增词）', () => {
  it('prompt:inject 默认授予、不需显式授权', () => {
    const descriptor = describeCapability('prompt:inject');
    expect(descriptor.risk).toBe('granted');
    expect(descriptor.ackRequired).toBe(false);
    expect(descriptor.labelKey).toBe('market.capability.promptInject.label');
  });

  it('subprocess/bash 默认拒绝：红标 + 必须显式授权', () => {
    for (const id of ['subprocess', 'bash']) {
      const descriptor = describeCapability(id);
      expect(descriptor.risk).toBe('denied');
      expect(descriptor.ackRequired).toBe(true);
    }
  });

  it('network 与 connector:* 属「需声明」（域名白名单/凭据库）且必须显式授权', () => {
    expect(describeCapability('network')).toMatchObject({ risk: 'declared', ackRequired: true });
    expect(describeCapability('connector:notion')).toMatchObject({
      risk: 'declared',
      ackRequired: true,
      labelKey: 'market.capability.connector.label',
    });
  });

  it('fs:read/fs:write/mcp/comfy:generate/llm:call 属受限范围（不需单次授权）', () => {
    for (const id of ['fs:read', 'fs:write', 'mcp', 'comfy:generate', 'llm:call']) {
      expect(describeCapability(id).risk).toBe('scoped');
      expect(describeCapability(id).ackRequired).toBe(false);
    }
  });

  it('词表外能力 → unknown 且按最保守：需显式授权、标签回落原始 id', () => {
    const descriptor = describeCapability('browser:automate');
    expect(descriptor.risk).toBe('unknown');
    expect(descriptor.ackRequired).toBe(true);
    expect(descriptor.labelKey).toBeNull();
  });
});

describe('capabilities · 清单汇总（D4 确认条输入）', () => {
  it('高风险在前排序，授权清单 = 词表判定 ∪ 索引声明', () => {
    const { items, ackList } = describeCapabilities(
      ['prompt:inject', 'fs:read', 'subprocess', 'network'],
      ['connector:lark'],
    );
    expect(items.map((item) => item.id)).toEqual([
      'subprocess',
      'network',
      'fs:read',
      'prompt:inject',
    ]);
    expect(ackList).toEqual(['connector:lark', 'network', 'subprocess']);
  });

  it('重复 id 去重（同一能力不重复列）', () => {
    const { items } = describeCapabilities(['fs:read', 'fs:read']);
    expect(items).toHaveLength(1);
  });

  it('索引声明了但词表判无需授权的项也进授权清单（不乐观默认）', () => {
    const { ackList } = describeCapabilities(['fs:read'], ['fs:write']);
    expect(ackList).toEqual(['fs:write']);
  });
});

describe('capabilities · license 三档与安装按钮三态', () => {
  it('license 三档各自的人话口径与色调', () => {
    expect(describeLicenseGate('loadable')).toMatchObject({ tone: 'ok' });
    expect(describeLicenseGate('view-only')).toMatchObject({ tone: 'warn' });
    expect(describeLicenseGate('blocked')).toMatchObject({ tone: 'danger' });
    for (const gate of ['loadable', 'view-only', 'blocked'] as const) {
      expect(describeLicenseGate(gate).labelKey.length).toBeGreaterThan(0);
      expect(describeLicenseGate(gate).noticeKey.length).toBeGreaterThan(0);
    }
  });

  it('安装按钮：可装载可点；仅看/禁灰化且给原因（F15）', () => {
    expect(describeInstallButton('loadable', false)).toMatchObject({
      disabled: false,
      disabledReasonKey: null,
    });
    expect(describeInstallButton('view-only', false)).toMatchObject({
      disabled: true,
      disabledReasonKey: 'market.install.viewOnlyReason',
    });
    expect(describeInstallButton('blocked', false)).toMatchObject({
      disabled: true,
      disabledReasonKey: 'market.install.blockedReason',
    });
  });

  it('已装载覆盖为「已装载」且可再次进入确认（更新/重装路径）', () => {
    expect(describeInstallButton('loadable', true)).toMatchObject({
      labelKey: 'market.install.loaded',
      disabled: false,
    });
  });
});
