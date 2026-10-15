import { describe, expect, it } from 'vitest';

import {
  apiFailure,
  apiSuccess,
  DF_ERROR_CODES,
  DF_ERROR_HTTP_STATUS,
  ipcFailure,
  ipcSuccess,
  isApiFailure,
  isApiSuccess,
  isDaemonError,
  isDfErrorCode,
  makeError,
} from './index.ts';

describe('ipc · 错误码表', () => {
  it('每个错误码都有 HTTP 状态映射', () => {
    for (const code of DF_ERROR_CODES) {
      expect(DF_ERROR_HTTP_STATUS[code], code).toBeTypeOf('number');
    }
  });

  it('错误码表覆盖四条链路的关键错误（AI 降级、ComfyUI 未启动/缺模型、MCP ack、凭据）', () => {
    expect(DF_ERROR_CODES).toContain('comfy_unreachable');
    expect(DF_ERROR_CODES).toContain('comfy_model_missing');
    expect(DF_ERROR_CODES).toContain('mcp_ack_invalid');
    expect(DF_ERROR_CODES).toContain('credential_invalid');
    expect(DF_ERROR_CODES).toContain('config_invalid');
  });

  it('未启动态与缺模型态映射为非 2xx（前端可分支）', () => {
    expect(DF_ERROR_HTTP_STATUS.comfy_unreachable).toBe(503);
    expect(DF_ERROR_HTTP_STATUS.comfy_model_missing).toBe(422);
  });

  it('isDfErrorCode 只认已知错误码', () => {
    expect(isDfErrorCode('doc_not_found')).toBe(true);
    expect(isDfErrorCode('not_a_code')).toBe(false);
    expect(isDfErrorCode(42)).toBe(false);
  });
});

describe('ipc · 错误形状', () => {
  it('makeError 生成统一形状（含 details 时才带 details 键）', () => {
    const plain = makeError('bad_request', '参数不合法');
    expect(plain).toEqual({ code: 'bad_request', message: '参数不合法' });
    expect(Object.hasOwn(plain, 'details')).toBe(false);

    const detailed = makeError('comfy_unreachable', '未检测到本地服务', {
      baseUrl: 'http://127.0.0.1:8188',
    });
    expect(detailed.details).toEqual({ baseUrl: 'http://127.0.0.1:8188' });
  });

  it('isDaemonError 校验统一错误形状', () => {
    expect(isDaemonError({ code: 'internal', message: 'x' })).toBe(true);
    expect(isDaemonError({ code: 'internal' })).toBe(false);
    expect(isDaemonError({ code: 'nope', message: 'x' })).toBe(false);
    expect(isDaemonError(null)).toBe(false);
  });
});

describe('ipc · HTTP 响应信封（daemon 与前端共用）', () => {
  it('成功信封可判别', () => {
    const res = apiSuccess({ documents: [] });
    expect(res).toEqual({ ok: true, result: { documents: [] } });
    expect(isApiSuccess(res)).toBe(true);
    expect(isApiFailure(res)).toBe(false);
  });

  it('失败信封只携带统一错误形状', () => {
    const res = apiFailure('doc_not_found', '文档不存在', { documentId: 'x' });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unreachable');
    expect(res.error.code).toBe('doc_not_found');
    expect(res.error.details).toEqual({ documentId: 'x' });
    expect(isApiFailure(res)).toBe(true);
  });

  it('信封可判别联合收窄', () => {
    const raw: unknown = apiSuccess(1);
    expect(isApiSuccess<number>(raw)).toBe(true);
    if (isApiSuccess<number>(raw)) {
      expect(raw.result).toBe(1);
    }
  });
});

describe('ipc · stdio/SSE 通道信封（带 id 与 method）', () => {
  it('请求信封 { id, method, params } 与响应信封 { id, ok, result|error }', () => {
    const req = { id: 'r1', method: 'documents.list', params: {} };
    expect(ipcSuccess(req.id, { ok: true })).toEqual({ id: 'r1', ok: true, result: { ok: true } });
    expect(ipcFailure('r1', makeError('internal', 'boom'))).toEqual({
      id: 'r1',
      ok: false,
      error: { code: 'internal', message: 'boom' },
    });
  });
});
