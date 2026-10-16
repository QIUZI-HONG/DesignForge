// @vitest-environment node
/**
 * 网关统一超时的**文案口径**用例（修复批次 3 · code-review #5）。
 *
 * 为什么需要它：超时消息是首页错误态**直渲染**的用户可见文案（`HomeView` 把
 * `DocumentApiError.message` 原样交给 `HomeErrorState.description`），按 `_shared.md` §3
 * 「界面文案一律经 i18n 目录」必须取自 `apps/web/messages/*.json`，不得在 API 层硬编码中文。
 * 本用例把「目录键 ↔ 错误消息」钉在一起：改文案只改目录，改目录必然带动本用例。
 */
import { describe, expect, it } from 'vitest';

import { t } from '@/i18n';

import { GATEWAY_TIMEOUT_MS, GatewayTimeoutError } from './gateway-timeout';

describe('gateway-timeout · 用户可见文案经 i18n', () => {
  it('超时消息取自目录键 home.error.daemonTimeout（含毫秒数，不数字分组）', () => {
    const error = new GatewayTimeoutError(3000);

    expect(error.message).toBe(t('home.error.daemonTimeout', { ms: 3000 }));
    expect(error.message).toContain('3000');
    expect(error.message).toContain('请求超时');
    expect(error.timeoutMs).toBe(3000);
  });

  it('缺省上限同口径：文案仍经目录（不是第二份硬编码串）', () => {
    expect(new GatewayTimeoutError(GATEWAY_TIMEOUT_MS).message).toBe(
      t('home.error.daemonTimeout', { ms: GATEWAY_TIMEOUT_MS }),
    );
  });

  it('目录键在 zh-CN 与 en 双目录齐备（en 为工程兜底，缺键会露裸键）', () => {
    const zh = t('home.error.daemonTimeout', { ms: 20 }, 'zh-CN');
    const en = t('home.error.daemonTimeout', { ms: 20 }, 'en');

    expect(zh).not.toBe('home.error.daemonTimeout');
    expect(en).not.toBe('home.error.daemonTimeout');
    expect(zh).not.toBe(en);
  });
});
