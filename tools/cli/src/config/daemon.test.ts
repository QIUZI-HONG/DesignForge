/**
 * 工作包 F · `df config` 的 daemon 地址解析（对齐 web 单点口径，ADR-0004 裁决 ①）。
 *
 * 这里只钉「解析顺序与归一」这条纯逻辑（无 I/O、不触网）；端到端落点由
 * `config-cli.test.ts` 的子进程缝用输出 `daemon` 字段佐证。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { CLI_DAEMON_DEFAULT_URL, resolveDaemonBaseUrl } from './daemon.ts';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('daemon 地址解析（--daemon > env > 缺省 4318）', () => {
  it('显式 --daemon 优先；未给时读 NEXT_PUBLIC_DF_DAEMON_URL；都没有则缺省端口窗起点', () => {
    vi.stubEnv('NEXT_PUBLIC_DF_DAEMON_URL', '');
    expect(resolveDaemonBaseUrl('http://127.0.0.1:4991')).toBe('http://127.0.0.1:4991');
    expect(resolveDaemonBaseUrl(null)).toBe(CLI_DAEMON_DEFAULT_URL);

    vi.stubEnv('NEXT_PUBLIC_DF_DAEMON_URL', 'http://127.0.0.1:4992');
    expect(resolveDaemonBaseUrl(null)).toBe('http://127.0.0.1:4992');
    // 显式参数仍压过 env
    expect(resolveDaemonBaseUrl('http://127.0.0.1:4991')).toBe('http://127.0.0.1:4991');
  });

  it('空白（空串/纯空格）视为未给；尾部斜杠归一', () => {
    vi.stubEnv('NEXT_PUBLIC_DF_DAEMON_URL', '   ');
    expect(resolveDaemonBaseUrl(null)).toBe(CLI_DAEMON_DEFAULT_URL);
    expect(resolveDaemonBaseUrl('  ')).toBe(CLI_DAEMON_DEFAULT_URL);

    vi.stubEnv('NEXT_PUBLIC_DF_DAEMON_URL', ' http://127.0.0.1:4993/ ');
    expect(resolveDaemonBaseUrl(null)).toBe('http://127.0.0.1:4993');
  });
});
