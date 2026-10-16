/**
 * 诊断 · 环境快照与日志尾部测试（seam：纯函数——输入环境/事件 → 数据快照 / 日志行）。
 *
 * 断言口径：快照只含**数据**（无界面文案，文案由面板取 i18n）；日志尾部按时间序取最后 N 条
 * 并带名称与载荷摘要（限长）。
 */
import type { TelemetryEvent } from '@dforge/contracts';
import { describe, expect, it } from 'vitest';

import { detectPlatform, environmentSnapshot, isElectron, uptimeParts } from './environment';
import { formatLogLine, logTail } from './logs';

const HEALTH = {
  name: '@dforge/daemon',
  version: '0.1.0',
  startedAt: '2026-10-15T00:00:00.000Z',
  uptimeMs: 3_723_000,
  dataRoot: '/home/user/.dforge',
  workspaceDir: '/home/user/designs',
};

describe('诊断 · 环境快照', () => {
  it('daemon 已连接：版本/时长/数据目录/工作目录进快照（面板逐行渲染）', () => {
    const snapshot = environmentSnapshot({
      health: HEALTH,
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
      language: 'zh-CN',
      devicePixelRatio: 1.5,
      viewport: { width: 1440, height: 900 },
    });
    expect(snapshot.daemon).toEqual({
      name: '@dforge/daemon',
      version: '0.1.0',
      uptimeMs: 3_723_000,
      dataRoot: '/home/user/.dforge',
      workspaceDir: '/home/user/designs',
    });
    expect(snapshot.renderer).toBe('browser');
    expect(snapshot.platform).toBe('linux');
    expect(snapshot.locale).toBe('zh-CN');
    expect(snapshot.viewport).toEqual({ width: 1440, height: 900 });
    expect(snapshot.dpr).toBe(1.5);
  });

  it('daemon 未连接：快照为 null（面板渲染「未连接」而非空白）', () => {
    const snapshot = environmentSnapshot({
      health: null,
      userAgent: 'Mozilla/5.0',
      language: 'zh-CN',
      devicePixelRatio: 1,
      viewport: { width: 1280, height: 800 },
    });
    expect(snapshot.daemon).toBeNull();
    expect(snapshot.renderer).toBe('browser');
  });

  it('平台与渲染环境识别只看 UA 家族（浏览器 / Electron 壳）', () => {
    expect(detectPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('windows');
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('macos');
    expect(detectPlatform('其它')).toBe('unknown');
    expect(isElectron('Mozilla/5.0 Electron/38.0.0')).toBe(true);
    expect(isElectron('Mozilla/5.0 (X11; Linux x86_64)')).toBe(false);
  });

  it('运行时长分段（面板用 ICU 消息拼中文，纯逻辑不做本地化字符串）', () => {
    expect(uptimeParts(45_000)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 45 });
    expect(uptimeParts(3_723_000)).toEqual({ days: 0, hours: 1, minutes: 2, seconds: 3 });
    expect(uptimeParts(90_000_000)).toEqual({ days: 1, hours: 1, minutes: 0, seconds: 0 });
  });
});

describe('诊断 · 日志尾部', () => {
  const events: TelemetryEvent[] = [
    {
      id: 'e1',
      name: 'doc.saved',
      at: '2026-10-15T00:00:01.000Z',
      sessionId: null,
      appVersion: null,
      payload: { documentId: 'd1' },
    },
    {
      id: 'e2',
      name: 'ai.degraded',
      at: '2026-10-15T00:00:02.000Z',
      sessionId: null,
      appVersion: null,
      payload: { runId: 'ai_1', degradedReason: 'no-credentials' },
    },
    {
      id: 'e3',
      name: 'mcp.ack',
      at: '2026-10-15T00:00:03.000Z',
      sessionId: null,
      appVersion: null,
      payload: { proposalId: 'prop_1', decision: 'approved' },
    },
  ];

  it('取最后 N 条且保持时间序（尾部语义：最新在最后）', () => {
    const lines = logTail(events, 2);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('ai.degraded');
    expect(lines[1]).toContain('mcp.ack');
  });

  it('单行格式：UTC 时间 + 事件名 + 载荷摘要（含关键字段）', () => {
    const line = formatLogLine(events[1] as TelemetryEvent);
    expect(line).toBe(
      '2026-10-15 00:00:02  ai.degraded  {"runId":"ai_1","degradedReason":"no-credentials"}',
    );
  });

  it('载荷摘要限长（超大载荷不把诊断面板撑爆）', () => {
    const big: TelemetryEvent = {
      ...(events[0] as TelemetryEvent),
      payload: { text: 'x'.repeat(500) },
    };
    const line = formatLogLine(big, 40);
    expect(line.length).toBeLessThan(80);
    expect(line.endsWith('…')).toBe(true);
  });

  it('空日志 → 空数组（面板走空态）', () => {
    expect(logTail([], 5)).toEqual([]);
  });
});
