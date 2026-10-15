import { describe, expect, it } from 'vitest';

import { buildWindowOptions, SECURITY_BASELINE, WINDOW_SIZE } from './window-options.js';

describe('安全基线与窗口口径', () => {
  it('四项硬断言齐备，且不得放宽（含 allowRunningInsecureContent）', () => {
    expect(SECURITY_BASELINE).toEqual({
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
    });
  });

  it('窗口尺寸取验收基准 1440×900', () => {
    expect(WINDOW_SIZE).toEqual({ width: 1440, height: 900 });
  });

  it('窗口选项带上基线开关与 preload 路径', () => {
    const options = buildWindowOptions({ preloadPath: '/opt/df-preload.cjs' });

    expect(options.webPreferences).toMatchObject({
      ...SECURITY_BASELINE,
      preload: '/opt/df-preload.cjs',
    });
  });

  it('宽高按内容区口径（useContentSize）——视口必须等于 1440×900，不含窗口装饰', () => {
    const options = buildWindowOptions({ preloadPath: '/opt/df-preload.cjs' });

    expect(options.useContentSize).toBe(true);
  });

  it('窗口先隐藏、就绪后再显示（避免白屏闪烁，同 Figma 口径）', () => {
    const options = buildWindowOptions({ preloadPath: '/opt/df-preload.cjs' });

    expect(options.show).toBe(false);
    expect(options.width).toBe(WINDOW_SIZE.width);
    expect(options.height).toBe(WINDOW_SIZE.height);
  });

  it('窄窗下限取 1024×768（验收标准 §3 断点）', () => {
    const options = buildWindowOptions({ preloadPath: '/opt/df-preload.cjs' });

    expect(options.minWidth).toBe(1024);
    expect(options.minHeight).toBe(768);
  });
});
