/**
 * 诊断日志尾部纯逻辑测试（票 10 · spec P1-6：重复 key 清零）。
 *
 * 背景（巡检实测）：面板日志列表曾以**格式化行**作 React key——重复事件
 * （如连开两次同一文档：同时间戳（秒）+ 同事件名 + 同载荷摘要）产生相同行文本，
 * 触发「Encountered two children with the same key」。修复口径：`logTail` 返回
 * 「事件 id + 格式化行」，列表按 daemon 生成的**事件 id**（唯一）作 key，
 * 行文本可读性不变。
 */
import type { TelemetryEvent } from '@dforge/contracts';
import { describe, expect, it } from 'vitest';

import { formatLogLine, logTail } from './logs';

/** 造一条同内容事件（id 不同、其余全同——真实场景：连开同一文档）。 */
function event(id: string): TelemetryEvent {
  return {
    id,
    name: 'doc.opened',
    at: '2026-10-15T00:00:01.000Z',
    sessionId: null,
    appVersion: null,
    payload: { docId: 'doc-1' },
  };
}

describe('日志尾部 · key 唯一性（票 10）', () => {
  it('重复事件（同时间/同名/同载荷）的行 id 仍互异——列表不得以格式化行作 key', () => {
    const rows = logTail([event('e1'), event('e2'), event('e3')], 8);
    expect(rows).toHaveLength(3);
    const ids = rows.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('行文本仍是格式化日志（时间 + 事件名 + 载荷），可读性不变', () => {
    const rows = logTail([event('e1')], 8);
    expect(rows[0]?.line).toBe(formatLogLine(event('e1')));
    expect(rows[0]?.line).toContain('doc.opened');
  });
});
