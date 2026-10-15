import { describe, expect, it } from 'vitest';

import {
  evaluateBaselineProbe,
  evaluateSelfCheck,
  SHELL_SELF_CHECK_SCHEMA,
  type ShellBaselineProbeReport,
  type ShellSelfCheckReport,
  splitSecurityFindings,
} from './shell-selfcheck.js';
import { SECURITY_BASELINE } from './window-options.js';

/** 造一个「未测得」描述串（避免在断言里复述实现句式）。 */
const stringMatchingUndetermined = (key: string) => expect.stringContaining(key);

/** 合规基线样本；各反例在它之上「只改一处」。 */
const report = (over: Partial<ShellSelfCheckReport> = {}): ShellSelfCheckReport => ({
  schema: SHELL_SELF_CHECK_SCHEMA,
  mode: 'smoke',
  target: {
    kind: 'static-export',
    url: 'http://127.0.0.1:45678/index.html',
    reason: 'apps/web/out（静态产物）',
  },
  window: { width: 1440, height: 900, devicePixelRatio: 1.5 },
  security: { ...SECURITY_BASELINE },
  page: {
    href: 'http://127.0.0.1:45678/index.html',
    title: '设界',
    readyState: 'complete',
    bodyChildren: 3,
    marker: null,
  },
  ...over,
});

describe('壳自检判据（冒烟段的地基）', () => {
  it('全合规时无失败项', () => {
    expect(evaluateSelfCheck(report())).toEqual([]);
  });

  it('安全基线被放宽 → 逐项点名', () => {
    const failures = evaluateSelfCheck(
      report({ security: { ...SECURITY_BASELINE, sandbox: false, webSecurity: false } }),
    );

    expect(failures).toHaveLength(2);
    expect(failures.join()).toContain('sandbox');
    expect(failures.join()).toContain('webSecurity');
  });

  it('页面未装载完（readyState）或空文档 → 失败', () => {
    const failures = evaluateSelfCheck(
      report({ page: { ...report().page, readyState: 'loading', bodyChildren: 0 } }),
    );

    expect(failures.join()).toContain('readyState');
    expect(failures.join()).toContain('bodyChildren');
  });

  it('装载落点与目标不同源 → 失败（防「装到别处」）', () => {
    const failures = evaluateSelfCheck(
      report({ page: { ...report().page, href: 'https://example.com/' } }),
    );

    expect(failures.join()).toContain('同源');
  });

  it('窗口尺寸/DPR 与验收基准不符 → 点名（DPR 仅对照态约束）', () => {
    const failures = evaluateSelfCheck(
      report({ window: { width: 1280, height: 800, devicePixelRatio: 1 } }),
      {
        expectViewport: { width: 1440, height: 900, dpr: 1.5 },
      },
    );

    expect(failures.join()).toContain('窗口尺寸');
    expect(failures.join()).toContain('devicePixelRatio');
  });

  it('未给基准时不做尺寸约束（普通启动冒烟只看装载与基线）', () => {
    expect(
      evaluateSelfCheck(report({ window: { width: 1280, height: 800, devicePixelRatio: 1 } })),
    ).toEqual([]);
  });

  it('基线探针只比五项（守卫的运行时兜底口径）', () => {
    const probe: ShellBaselineProbeReport = {
      schema: SHELL_SELF_CHECK_SCHEMA,
      mode: 'probe',
      security: { ...SECURITY_BASELINE },
    };

    expect(evaluateBaselineProbe(probe)).toEqual([]);
    expect(
      evaluateBaselineProbe({
        ...probe,
        security: { ...SECURITY_BASELINE, nodeIntegration: true },
      }),
    ).toEqual(['安全基线 nodeIntegration 期望 false 实际 true']);
  });

  it('运行时读不到某键（null）→ 拆到 undetermined（守卫据此退 2，不当作通过）', () => {
    const probe: ShellBaselineProbeReport = {
      schema: SHELL_SELF_CHECK_SCHEMA,
      mode: 'probe',
      security: { ...SECURITY_BASELINE, sandbox: null, allowRunningInsecureContent: null },
    };

    expect(splitSecurityFindings(probe.security)).toEqual({
      violations: [],
      undetermined: [
        '安全基线 sandbox 运行时未测得（期望 true）',
        stringMatchingUndetermined('allowRunningInsecureContent'),
      ],
    });
    expect(evaluateBaselineProbe(probe)).toHaveLength(2);
  });

  it('冒烟口径（requireAll=false）只看实测不符，未测得项交给静态守卫', () => {
    const findings = evaluateSelfCheck(
      report({
        security: {
          ...SECURITY_BASELINE,
          webSecurity: null,
          allowRunningInsecureContent: null,
          sandbox: false,
        },
      }),
    );

    expect(findings).toContain('安全基线 sandbox 期望 true 实际 false');
    expect(findings.join()).not.toContain('未测得');
  });
});
