import { describe, expect, it } from 'vitest';

import { EXTERNAL_LINK_ALLOWLIST, decideExternalOpen, isAllowedExternalUrl } from './external-links';

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
