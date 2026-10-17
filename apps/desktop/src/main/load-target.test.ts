import { describe, expect, it } from 'vitest';

import {
  formatLoadTargetMarker,
  LOAD_TARGET_MARKER_PREFIX,
  resolveLoadPlan,
  SHELL_STATIC_ENV,
  SHELL_URL_ENV,
} from './load-target.js';

/** 造一个「只认给定文件存在」的存在谓词。 */
const existsOf = (...paths: string[]) => {
  const set = new Set(paths);
  return (p: string) => set.has(p);
};

const baseInput = (over: Partial<Parameters<typeof resolveLoadPlan>[0]> = {}) => ({
  env: {} as Record<string, string | undefined>,
  shellRoot: '/repo/apps/desktop',
  repoRoot: '/repo',
  exists: () => false,
  ...over,
});

describe('壳装载目标解析（dev / 静态产物 / 回退页）', () => {
  it('显式 dev URL 优先（开发态指向本地 dev server）', () => {
    const plan = resolveLoadPlan(
      baseInput({ env: { [SHELL_URL_ENV]: 'http://localhost:3000/editor' } }),
    );

    expect(plan).toEqual({
      kind: 'dev-server',
      url: 'http://localhost:3000/editor',
      reason: `env ${SHELL_URL_ENV}`,
    });
  });

  it('显式 dev URL 不是 http(s) 时不算数，退回后续解析', () => {
    const plan = resolveLoadPlan(
      baseInput({
        env: { [SHELL_URL_ENV]: 'file:///etc/passwd' },
        exists: existsOf('/repo/apps/desktop/resources/fallback.html'),
      }),
    );

    expect(plan.kind).toBe('fallback');
    expect(plan.reason).toContain(SHELL_URL_ENV);
    expect(plan.reason).toContain('非 http');
  });

  it('静态产物目录（env 指定，指向 index.html 亦接受）', () => {
    const plan = resolveLoadPlan(
      baseInput({
        env: { [SHELL_STATIC_ENV]: '/build/web/index.html' },
        exists: existsOf('/build/web/index.html'),
      }),
    );

    expect(plan).toEqual({
      kind: 'static-export',
      rootDir: '/build/web',
      reason: `env ${SHELL_STATIC_ENV}`,
    });
  });

  it('未指定时取仓库内 apps/web/out（Next 导出口径）', () => {
    const plan = resolveLoadPlan(baseInput({ exists: existsOf('/repo/apps/web/out/index.html') }));

    expect(plan).toEqual({
      kind: 'static-export',
      rootDir: '/repo/apps/web/out',
      reason: 'apps/web/out（静态产物）',
    });
  });

  it('静态产物缺失时回落壳内诊断页（带 file URL）', () => {
    const plan = resolveLoadPlan(
      baseInput({ exists: existsOf('/repo/apps/desktop/resources/fallback.html') }),
    );

    expect(plan.kind).toBe('fallback');
    expect(plan).toEqual({
      kind: 'fallback',
      fileUrl: 'file:///repo/apps/desktop/resources/fallback.html',
      reason: expect.stringContaining('web 产物缺失'),
    });
  });

  it('连回退页都缺失时仍给出确定的目标（不抛异常）', () => {
    const plan = resolveLoadPlan(baseInput());

    if (plan.kind !== 'fallback') {
      throw new Error(`期望回退目标，实际 ${plan.kind}`);
    }
    expect(plan.fileUrl).toContain('fallback.html');
  });
});

describe('装载目标标记（门禁存活段的 target 证据来源）', () => {
  it('一行 JSON、前缀固定、url 缺省归 null（stub/门禁解析口径）', () => {
    const line = formatLoadTargetMarker({ kind: 'fallback', url: 'file:///tmp/fallback.html' });
    expect(line.startsWith(LOAD_TARGET_MARKER_PREFIX)).toBe(true);
    expect(line).not.toContain('\n');
    expect(JSON.parse(line.slice(LOAD_TARGET_MARKER_PREFIX.length))).toEqual({
      kind: 'fallback',
      url: 'file:///tmp/fallback.html',
    });
    expect(
      JSON.parse(
        formatLoadTargetMarker({ kind: 'dev-server' }).slice(LOAD_TARGET_MARKER_PREFIX.length),
      ),
    ).toEqual({ kind: 'dev-server', url: null });
  });
});
