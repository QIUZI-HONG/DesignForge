/**
 * 对抗测试（验证方 test/verify-web-b）· 外链白名单的**绕过尝试**。
 *
 * 任务书点名：`github.com.evil.tld` 仿冒域、`javascript:` URL。
 * 另补 URL 解析器的边角（大小写、尾点、userinfo、反斜杠、端口、空 host、控制字符）。
 */
import { describe, expect, it } from 'vitest';

import { decideExternalOpen, decideInPageNavigation, isAllowedExternalUrl } from './external-links';

describe('对抗 · 外链白名单绕过尝试', () => {
  it.each([
    ['仿冒域（白名单作前缀）', 'https://github.com.evil.tld/'],
    ['仿冒域（白名单作后缀）', 'https://evil-github.com/'],
    ['仿冒域（白名单作子串路径）', 'https://evil.tld/github.com'],
    ['白名单尾点（FQDN 形式）', 'https://github.com./'],
    ['userinfo 伪装', 'https://github.com@evil.tld/'],
    ['协议降级', 'http://github.com/'],
    ['javascript: URL', 'javascript:alert(document.cookie)'],
    ['JavaScript 大小写变体', 'JaVaScRiPt:alert(1)'],
    ['data: URL', 'data:text/html,<script>alert(1)</script>'],
    ['file: URL', 'file:///etc/passwd'],
    ['blob: URL', 'blob:https://github.com/x'],
    ['about:blank', 'about:blank'],
    ['空串', ''],
    ['相对路径（无协议）', 'github.com/foo'],
  ])('拒绝：%s', (_label, url) => {
    const decision = decideExternalOpen(url);
    if (decision.action !== 'deny') {
      // 仅白名单自身的 https 才允许；上面这些必须全 deny
      throw new Error(`未拦住：${url} → ${JSON.stringify(decision)}`);
    }
    expect(decision.action).toBe('deny');
  });

  it('放行：白名单域与子域的 https（含端口以外路径/查询）', () => {
    expect(decideExternalOpen('https://github.com/')).toEqual({
      action: 'allow-external',
      url: 'https://github.com/',
    });
    expect(isAllowedExternalUrl('https://gist.github.com/abc')).toBe(true);
    expect(isAllowedExternalUrl('https://github.com/org/repo/issues?q=1#x')).toBe(true);
  });

  it.each([
    ['白名单大写', 'https://GitHub.com/'],
    ['反斜杠混淆（URL 归一为 github.com 的路径）', 'https://github.com\\@evil.tld'],
    ['端口变体（仍是白名单主机）', 'https://github.com:0/'],
    ['控制字符前缀（解析器会剥离）', '\u0000https://github.com'],
    ['子域', 'https://gist.github.com/abc'],
    ['换行注入（换行被剥离，落到 github.com 路径）', 'https://github.com/\n.evil.tld'],
  ])('归一化后主机仍是白名单域才放行（不算绕过）：%s', (_label, url) => {
    const decision = decideExternalOpen(url);
    // 要么拒绝；要么放行时打开的目标必须确实解析到 github.com（白名单语义不被改写）
    if (decision.action === 'allow-external') {
      expect(
        new URL(decision.url).hostname === 'github.com' ||
          new URL(decision.url).hostname.endsWith('.github.com'),
      ).toBe(true);
    } else {
      expect(decision.action).toBe('deny');
    }
  });
});

describe('对抗 · 页内导航（will-navigate 口径）', () => {
  it('同源放行、跨源白名单转系统浏览器、其余拒绝', () => {
    expect(decideInPageNavigation('http://localhost:3000/', 'http://localhost:3000/settings')).toBe(
      'allow',
    );
    expect(decideInPageNavigation('http://localhost:3000/', 'https://github.com/org/repo')).toBe(
      'open-external',
    );
    expect(decideInPageNavigation('http://localhost:3000/', 'https://github.com.evil.tld/')).toBe(
      'deny',
    );
    expect(decideInPageNavigation('http://localhost:3000/', 'javascript:alert(1)')).toBe('deny');
  });

  it('file: 装载下跨路径拒绝（回退诊断页不得被顶到别的本地文件）', () => {
    expect(decideInPageNavigation('file:///app/fallback.html', 'file:///app/fallback.html')).toBe(
      'allow',
    );
    expect(decideInPageNavigation('file:///app/fallback.html', 'file:///etc/passwd')).toBe('deny');
  });

  it('畸形 URL → 拒绝（不抛异常）', () => {
    expect(decideInPageNavigation('http://localhost:3000/', 'http://[::1')).toBe('deny');
  });
});
