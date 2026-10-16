import { describe, expect, it } from 'vitest';

import {
  armsSelfCheckTimeout,
  readArg,
  resolveRunMode,
  SELF_CHECK_TIMEOUT_MS,
} from './run-mode.js';

/** 交互壳的真实 argv 形状（`electron <appDir> [开关]`；无自检开关即正常交互模式）。 */
const APP_DIR = '/repo/apps/desktop';

describe('壳运行模式解析（argv → 模式判据）', () => {
  it('无任何自检开关 → 交互模式', () => {
    expect(resolveRunMode(['electron', APP_DIR])).toEqual({ kind: 'interactive' });
  });

  it('只有 --df-dpr（对照态用的显示口径开关）→ 仍是交互模式', () => {
    expect(resolveRunMode(['electron', APP_DIR, '--df-dpr=1.5'])).toEqual({
      kind: 'interactive',
    });
  });

  it('--df-shell-smoke=<路径> → 冒烟模式（带报告路径）', () => {
    expect(resolveRunMode(['electron', APP_DIR, '--df-shell-smoke=/ev/report.json'])).toEqual({
      kind: 'smoke',
      reportPath: '/ev/report.json',
    });
  });

  it('--df-shell-smoke 与 --df-capture 同给 → 截图模式（报告与 PNG 同批）', () => {
    expect(
      resolveRunMode([
        'electron',
        APP_DIR,
        '--df-shell-smoke=/ev/report.json',
        '--df-capture=/ev/shell.png',
      ]),
    ).toEqual({ kind: 'smoke', reportPath: '/ev/report.json', capturePath: '/ev/shell.png' });
  });

  it('--df-baseline-probe → 探针模式（优先于其余开关）', () => {
    expect(resolveRunMode(['electron', APP_DIR, '--df-baseline-probe', '--df-dpr=1.5'])).toEqual({
      kind: 'probe',
    });
  });

  it('--df-capture 单独出现 → 用法错误（截图必须与冒烟报告同批，exit 2 口径）', () => {
    const mode = resolveRunMode(['electron', APP_DIR, '--df-capture=/ev/shell.png']);
    expect(mode.kind).toBe('usage-error');
  });

  it('readArg 取 --name=value 形式的值（无该开关则为 undefined）', () => {
    expect(readArg(['electron', '--df-dpr=1.5'], 'df-dpr')).toBe('1.5');
    expect(readArg(['electron'], 'df-dpr')).toBeUndefined();
  });
});

describe('自检硬超时的武装判据（D-8：交互壳不得被超时误杀）', () => {
  it('交互模式**不武装**自检硬超时——壳是要长期存活的进程', () => {
    expect(armsSelfCheckTimeout(resolveRunMode(['electron', APP_DIR]))).toBe(false);
  });

  it('冒烟模式武装硬超时——装载卡死或渲染崩掉时不能无限等', () => {
    expect(armsSelfCheckTimeout(resolveRunMode(['electron', '--df-shell-smoke=/ev/r.json']))).toBe(
      true,
    );
  });

  it('截图模式武装硬超时（与冒烟同批）', () => {
    expect(
      armsSelfCheckTimeout(
        resolveRunMode(['electron', '--df-shell-smoke=/ev/r.json', '--df-capture=/ev/s.png']),
      ),
    ).toBe(true);
  });

  it('探针模式武装硬超时', () => {
    expect(armsSelfCheckTimeout(resolveRunMode(['electron', '--df-baseline-probe']))).toBe(true);
  });

  it('用法错误模式不武装（它立即退出，无需兜底）', () => {
    expect(armsSelfCheckTimeout(resolveRunMode(['electron', '--df-capture=/ev/s.png']))).toBe(
      false,
    );
  });

  it('硬超时窗口是 30s（门禁存活段的等待窗口据此设定：35s）', () => {
    expect(SELF_CHECK_TIMEOUT_MS).toBe(30_000);
  });
});
