import { describe, expect, it } from 'vitest';

import {
  isBoolean,
  isFiniteNumber,
  isHexSha256,
  isIsoDateString,
  isNonEmptyString,
  isRecord,
  isSha256Digest,
  isStringArray,
} from './guards.ts';
import { DAEMON_PORT_BASE, DAEMON_ROUTES } from './routes.ts';

describe('ipc · 基础守卫', () => {
  it('isRecord 排除 null 与数组', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord('x')).toBe(false);
  });

  it('isNonEmptyString 拒绝空白串', () => {
    expect(isNonEmptyString('  ')).toBe(false);
    expect(isNonEmptyString(' 页面 1 ')).toBe(true);
    expect(isNonEmptyString(1)).toBe(false);
  });

  it('isFiniteNumber 拒绝 NaN/Infinity', () => {
    expect(isFiniteNumber(Number.NaN)).toBe(false);
    expect(isFiniteNumber(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isFiniteNumber(0)).toBe(true);
  });

  it('isBoolean / isStringArray 逐项校验', () => {
    expect(isBoolean(false)).toBe(true);
    expect(isBoolean('false')).toBe(false);
    expect(isStringArray([])).toBe(true);
    expect(isStringArray(['a', 'b'])).toBe(true);
    expect(isStringArray(['a', 1])).toBe(false);
  });

  it('isIsoDateString 接受带时区的 ISO 时间，拒绝垃圾串', () => {
    expect(isIsoDateString('2026-10-15T12:00:00Z')).toBe(true);
    expect(isIsoDateString('2026-10-15T20:00:00+08:00')).toBe(true);
    expect(isIsoDateString('2026/10/15')).toBe(false);
    expect(isIsoDateString('not-a-date')).toBe(false);
  });

  it('isHexSha256 / isSha256Digest 形态', () => {
    const hex = 'a'.repeat(64);
    expect(isHexSha256(hex)).toBe(true);
    expect(isHexSha256('A'.repeat(64))).toBe(false);
    expect(isHexSha256(hex.slice(0, 63))).toBe(false);
    expect(isSha256Digest(`sha256:${hex}`)).toBe(true);
    expect(isSha256Digest(hex)).toBe(false);
  });
});

describe('ipc · 路由表', () => {
  it('端口探测起点冻结为 4318（架构 v1.1 / 骨架约定）', () => {
    expect(DAEMON_PORT_BASE).toBe(4318);
  });

  it('每条路由的路径以 / 开头且方法合法', () => {
    for (const [key, route] of Object.entries(DAEMON_ROUTES)) {
      expect(route.path.startsWith('/'), key).toBe(true);
      expect(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], key).toContain(route.method);
    }
  });

  it('凭据写入与健康检查等消费方关键路由存在', () => {
    expect(DAEMON_ROUTES.configCredentialsSet.path).toBe('/config/credentials');
    expect(DAEMON_ROUTES.exportDocument.path).toBe('/export');
    expect(DAEMON_ROUTES.imageRunsCreate.path).toBe('/image/runs');
    expect(DAEMON_ROUTES.marketQuery.path).toBe('/market/query');
  });
});
