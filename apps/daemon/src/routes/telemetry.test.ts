import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createTestDaemon, injectJson } from '../testing/harness.ts';

const EVENTS_PATH_SUFFIX = 'telemetry/events.jsonl';

describe('telemetry · 本地 JSONL（默认仅本地）', () => {
  it('写入 → 落盘并回读（最新在前）；一键删除清空', async () => {
    const daemon = await createTestDaemon();
    try {
      const first = await injectJson(daemon.app, {
        method: 'POST',
        url: '/telemetry/events',
        payload: { name: 'doc.created', payload: { documentId: 'a' } },
      });
      expect(first.statusCode).toBe(200);
      const firstResult = (first.payload as { result: { stored: boolean; id: string } }).result;
      expect(firstResult.stored).toBe(true);
      expect(firstResult.id).toMatch(/^evt_/);

      await injectJson(daemon.app, {
        method: 'POST',
        url: '/telemetry/events',
        payload: { name: 'page.saved', payload: { documentId: 'a', pageId: 'page-1' } },
      });

      const query = await injectJson(daemon.app, { method: 'GET', url: '/telemetry/events' });
      const result = (query.payload as { result: { events: { name: string }[]; total: number } })
        .result;
      expect(result.total).toBe(2);
      expect(result.events.map((event) => event.name)).toEqual(['page.saved', 'doc.created']);

      const cleared = await injectJson(daemon.app, { method: 'DELETE', url: '/telemetry/events' });
      expect(
        (cleared.payload as { result: { cleared: boolean; removed: number } }).result.removed,
      ).toBe(2);
      const after = await injectJson(daemon.app, { method: 'GET', url: '/telemetry/events' });
      expect((after.payload as { result: { events: unknown[] } }).result.events).toEqual([]);
    } finally {
      await daemon.cleanup();
    }
  });

  it('敏感键脱敏：payload 里的 apiKey 值不落盘（键名保留 + 占位符）', async () => {
    const daemon = await createTestDaemon();
    try {
      await injectJson(daemon.app, {
        method: 'POST',
        url: '/telemetry/events',
        payload: {
          name: 'ai.run',
          payload: {
            apiKey: 'sk-hidden-secret-123456',
            nested: { authorization: 'Bearer xyz' },
            model: 'deepseek-chat',
          },
        },
      });
      const raw = await readFile(join(daemon.dataRoot, EVENTS_PATH_SUFFIX), 'utf8');
      expect(raw).not.toContain('sk-hidden-secret-123456');
      expect(raw).not.toContain('Bearer xyz');
      expect(raw).toContain('[redacted]');
      expect(raw).toContain('deepseek-chat');
    } finally {
      await daemon.cleanup();
    }
  });

  it('埋点开关关闭：只回执不落盘（stored=false, reason=disabled）', async () => {
    const daemon = await createTestDaemon();
    try {
      await injectJson(daemon.app, {
        method: 'PUT',
        url: '/config',
        payload: { telemetry: { enabled: false } },
      });
      const { payload } = await injectJson(daemon.app, {
        method: 'POST',
        url: '/telemetry/events',
        payload: { name: 'doc.opened', payload: {} },
      });
      const result = (payload as { result: { stored: boolean; reason: string } }).result;
      expect(result.stored).toBe(false);
      expect(result.reason).toBe('disabled');

      // 文件不存在或为空（未落任何事件）
      const query = await injectJson(daemon.app, { method: 'GET', url: '/telemetry/events' });
      expect((query.payload as { result: { total: number } }).result.total).toBe(0);
    } finally {
      await daemon.cleanup();
    }
  });

  it('未知事件名 / payload 非对象 → 400 telemetry_invalid_event', async () => {
    const daemon = await createTestDaemon();
    try {
      const unknown = await injectJson(daemon.app, {
        method: 'POST',
        url: '/telemetry/events',
        payload: { name: 'evil.tracker', payload: {} },
      });
      expect(unknown.statusCode).toBe(400);
      expect((unknown.payload as { error: { code: string } }).error.code).toBe(
        'telemetry_invalid_event',
      );

      const badPayload = await injectJson(daemon.app, {
        method: 'POST',
        url: '/telemetry/events',
        payload: { name: 'doc.opened', payload: 'not-an-object' },
      });
      expect(badPayload.statusCode).toBe(400);
    } finally {
      await daemon.cleanup();
    }
  });
});
