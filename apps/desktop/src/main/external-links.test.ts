import { describe, expect, it } from 'vitest';

import {
  decideExternalOpen,
  decideInPageNavigation,
  EXTERNAL_LINK_ALLOWLIST,
  isAllowedExternalUrl,
} from './external-links.js';

describe('外链决策（setWindowOpenHandler 白名单口径）', () => {
  it('白名单域（含子域）的 https 外链放行到系统浏览器', () => {
    expect(decideExternalOpen('https://github.com/QIUZI-HONG/DesignForge')).toEqual({
      action: 'allow-external',
      url: 'https://github.com/QIUZI-HONG/DesignForge',
    });
    expect(decideExternalOpen('https://gist.github.com/abc')).toEqual({
      action: 'allow-external',
      url: 'https://gist.github.com/abc',
    });
  });

  it('非白名单域一律拒绝', () => {
    expect(decideExternalOpen('https://example.com/')).toEqual({ action: 'deny' });
    expect(decideExternalOpen('https://evil.com/github.com')).toEqual({ action: 'deny' });
  });

  it('仿冒域（白名单域作后缀）拒绝', () => {
    expect(decideExternalOpen('https://github.com.evil.com/')).toEqual({ action: 'deny' });
    expect(decideExternalOpen('https://notgithub.com/')).toEqual({ action: 'deny' });
  });

  it('非 https 协议拒绝（含 http / file / data / javascript）', () => {
    expect(decideExternalOpen('http://github.com/')).toEqual({ action: 'deny' });
    expect(decideExternalOpen('file:///etc/passwd')).toEqual({ action: 'deny' });
    expect(decideExternalOpen('data:text/html,<h1>x</h1>')).toEqual({ action: 'deny' });
    expect(decideExternalOpen('javascript:alert(1)')).toEqual({ action: 'deny' });
    expect(decideExternalOpen('about:blank')).toEqual({ action: 'deny' });
  });

  it('畸形 URL 拒绝（不抛异常）', () => {
    expect(decideExternalOpen('')).toEqual({ action: 'deny' });
    expect(decideExternalOpen('not a url')).toEqual({ action: 'deny' });
  });

  it('白名单常量是唯一扩展点（非空且为纯域名字面量）', () => {
    expect(EXTERNAL_LINK_ALLOWLIST.length).toBeGreaterThan(0);
    for (const host of EXTERNAL_LINK_ALLOWLIST) {
      expect(host).toMatch(/^[a-z0-9.-]+$/);
    }
  });

  it('isAllowedExternalUrl 与决策函数同口径', () => {
    expect(isAllowedExternalUrl('https://github.com/x')).toBe(true);
    expect(isAllowedExternalUrl('https://example.com/')).toBe(false);
  });
});

describe('页内导航决策（will-navigate 口径）', () => {
  it('同源导航放行（壳内应用自身跳转不得被拦）', () => {
    expect(decideInPageNavigation('http://127.0.0.1:45678/', 'http://127.0.0.1:45678/editor')).toBe(
      'allow',
    );
    expect(decideInPageNavigation('http://localhost:3000/', 'http://localhost:3000/market')).toBe(
      'allow',
    );
  });

  it('devtools 协议放行（开发者工具自身导航）', () => {
    expect(
      decideInPageNavigation('http://localhost:3000/', 'devtools://devtools/bundled/x.html'),
    ).toBe('allow');
  });

  it('白名单外链转系统浏览器，且不留在壳内', () => {
    expect(
      decideInPageNavigation('http://localhost:3000/', 'https://github.com/QIUZI-HONG/DesignForge'),
    ).toBe('open-external');
  });

  it('其余（跨源 http、仿冒域、file、畸形）一律拒绝', () => {
    expect(decideInPageNavigation('http://localhost:3000/', 'http://evil.com/')).toBe('deny');
    expect(decideInPageNavigation('http://localhost:3000/', 'https://github.com.evil.com/')).toBe(
      'deny',
    );
    expect(decideInPageNavigation('http://localhost:3000/', 'file:///etc/passwd')).toBe('deny');
    expect(decideInPageNavigation('http://localhost:3000/', '::::')).toBe('deny');
  });

  it('file: 装载（回退诊断页）下同路径放行，跨路径拒绝', () => {
    const target = 'file:///repo/apps/desktop/resources/fallback.html';

    expect(decideInPageNavigation(target, target)).toBe('allow');
    expect(decideInPageNavigation(target, 'file:///etc/passwd')).toBe('deny');
  });
});
