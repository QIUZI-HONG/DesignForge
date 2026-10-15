import { describe, expect, it } from 'vitest';

import { createTestDaemon } from '../testing/harness.ts';

describe('daemon · 健康检查（基座冒烟）', () => {
  it('GET /health 返回成功信封与数据目录信息', async () => {
    const daemon = await createTestDaemon();
    try {
      const response = await daemon.app.inject({ method: 'GET', url: '/health' });
      expect(response.statusCode).toBe(200);
      const payload = response.json() as {
        ok: boolean;
        result: { name: string; version: string; dataRoot: string; workspaceDir: string };
      };
      expect(payload.ok).toBe(true);
      expect(payload.result.name).toBe('@dforge/daemon');
      expect(payload.result.dataRoot).toBe(daemon.dataRoot);
      expect(payload.result.workspaceDir).toBe(daemon.workspaceDir);
    } finally {
      await daemon.cleanup();
    }
  });

  it('未知路由返回统一错误形状（not_found）', async () => {
    const daemon = await createTestDaemon();
    try {
      const response = await daemon.app.inject({ method: 'GET', url: '/nope' });
      expect(response.statusCode).toBe(404);
      const payload = response.json() as { ok: boolean; error: { code: string } };
      expect(payload.ok).toBe(false);
      expect(payload.error.code).toBe('not_found');
    } finally {
      await daemon.cleanup();
    }
  });

  it('非法 JSON 请求体返回统一错误形状（bad_request）', async () => {
    const daemon = await createTestDaemon();
    try {
      const response = await daemon.app.inject({
        method: 'PUT',
        url: '/config',
        headers: { 'content-type': 'application/json' },
        payload: '{oops',
      });
      expect(response.statusCode).toBe(400);
      const payload = response.json() as { ok: boolean; error: { code: string } };
      expect(payload.ok).toBe(false);
      expect(payload.error.code).toBe('bad_request');
    } finally {
      await daemon.cleanup();
    }
  });
});
