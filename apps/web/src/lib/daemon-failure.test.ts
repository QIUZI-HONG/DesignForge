/**
 * 共享错误归类纯函数测试（票 06 / spec P1-2）。
 *
 * 断言口径：纯函数输入输出（spec 测试决策 ②）——「失败原文 → 呈现口径」的表驱动判定：
 * 网络层失败（fetch/TypeError 族，各运行时原文不同）统一命中 `isNetwork` 并归一错误码；
 * daemon 明确拒绝（有码有中文文案）原样透传，不被误判成网络失败。
 */
import { describe, expect, it } from 'vitest';

import { classifyDaemonFailure, DAEMON_UNREACHABLE_CODE } from './daemon-failure';

describe('classifyDaemonFailure · 网络层失败族（fetch/TypeError）', () => {
  it.each([
    ['Chromium', 'Failed to fetch'],
    ['Chromium（带 TypeError 前缀）', 'TypeError: Failed to fetch'],
    ['Firefox', 'NetworkError when attempting to fetch resource.'],
    ['WebKit', 'Load failed'],
    ['Node undici', 'fetch failed'],
  ])('%s 原文「%s」→ 网络失败 + 归一码 DAEMON_UNREACHABLE', (_runtime, message) => {
    const view = classifyDaemonFailure({ message });
    expect(view.isNetwork).toBe(true);
    expect(view.code).toBe(DAEMON_UNREACHABLE_CODE);
    expect(view.raw).toBe(message);
  });

  it('调用方已归一的 daemon_unreachable 码 → 网络失败（市场客户端的归一口径）', () => {
    const view = classifyDaemonFailure({
      message: '无法连接本地服务：TypeError: Failed to fetch',
      code: 'daemon_unreachable',
    });
    expect(view.isNetwork).toBe(true);
    expect(view.code).toBe(DAEMON_UNREACHABLE_CODE);
    expect(view.raw).toBe('无法连接本地服务：TypeError: Failed to fetch');
  });

  it('码匹配但文案不含英文特征串（如自述文案）→ 仍按网络失败归一', () => {
    const view = classifyDaemonFailure({ message: '连接未建立', code: 'daemon_unreachable' });
    expect(view.isNetwork).toBe(true);
    expect(view.code).toBe(DAEMON_UNREACHABLE_CODE);
  });
});

describe('classifyDaemonFailure · 非网络失败（daemon 明确拒绝等）', () => {
  it('daemon 错误码 + 中文文案 → 原样透传（不误判、不改写）', () => {
    const view = classifyDaemonFailure({
      message: '上游连接中断',
      code: 'ai_invalid_request',
    });
    expect(view.isNetwork).toBe(false);
    expect(view.code).toBe('ai_invalid_request');
    expect(view.raw).toBe('上游连接中断');
  });

  it('无码的普通失败（如「流式通道提前关闭」）→ 透传且码为 null', () => {
    const view = classifyDaemonFailure({ message: '流式通道提前关闭' });
    expect(view.isNetwork).toBe(false);
    expect(view.code).toBeNull();
    expect(view.raw).toBe('流式通道提前关闭');
  });

  it('HTTP 层失败（请求失败（HTTP 502））不算网络失败（daemon 有响应）', () => {
    const view = classifyDaemonFailure({ message: '请求失败（HTTP 502）' });
    expect(view.isNetwork).toBe(false);
  });

  it('文案里恰好提到 fetch 但语义是业务描述 → 不含英文特征串即不误判', () => {
    const view = classifyDaemonFailure({ message: '上游请求失败：fetch 配置无效', code: 'upstream' });
    expect(view.isNetwork).toBe(false);
    expect(view.code).toBe('upstream');
  });
});
