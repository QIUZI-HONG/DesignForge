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

  it('写路径超时哨兵文案（daemon.requestTimeout）→ 网络失败（audit-d04 · D-04：超时与连不上同一恢复动作——重试）', () => {
    const view = classifyDaemonFailure({
      message: '本地服务请求超时：30000 毫秒内未响应——请稍后重试。',
    });
    expect(view.isNetwork).toBe(true);
    expect(view.code).toBe(DAEMON_UNREACHABLE_CODE);
  });

  it('读路径超时哨兵（home.error.daemonTimeout，同含「请求超时」短语）→ 网络失败', () => {
    const view = classifyDaemonFailure({ message: '本地服务 3000 毫秒内没有响应（请求超时）。' });
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

  it('网关族 5xx（502/503/504）→ 网络失败（audit-d04 · D-10：网关活着但上游 daemon 不可达的 HTTP 形态，失败文案统一单形态）', () => {
    // 同源网关在 daemon 失联时代理成 502（正文非 JSON）→ documents-client 两种原文形态：
    for (const message of [
      '响应不是合法 JSON（HTTP 502）',
      'HTTP 502：请求失败',
      'HTTP 503：请求失败',
      'HTTP 504：请求失败',
    ]) {
      const view = classifyDaemonFailure({ message });
      expect(view.isNetwork, message).toBe(true);
      expect(view.code).toBe(DAEMON_UNREACHABLE_CODE);
    }
  });

  it('daemon 有响应的非网关状态（400/500）不算网络失败（是明确拒绝/内部错误，不是传输失败）', () => {
    expect(classifyDaemonFailure({ message: 'HTTP 400：请求失败' }).isNetwork).toBe(false);
    expect(classifyDaemonFailure({ message: 'HTTP 500：请求失败' }).isNetwork).toBe(false);
  });

  it('文案里恰好提到 fetch 但语义是业务描述 → 不含英文特征串即不误判', () => {
    const view = classifyDaemonFailure({
      message: '上游请求失败：fetch 配置无效',
      code: 'upstream',
    });
    expect(view.isNetwork).toBe(false);
    expect(view.code).toBe('upstream');
  });
});
