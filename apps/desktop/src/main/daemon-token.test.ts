import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  appendTokenParam,
  DAEMON_TOKEN_FILE_BASENAME,
  DAEMON_TOKEN_QUERY_KEY,
  daemonTokenPathFor,
  readDaemonToken,
} from './daemon-token.js';

describe('壳 · daemon 令牌读取（audit-d02 · D-02）', () => {
  it('数据根解析：DF_DATA_ROOT 覆盖优先，否则 ~/.dforge', () => {
    expect(daemonTokenPathFor({ DF_DATA_ROOT: '/custom/root' })).toBe(
      `/custom/root/${DAEMON_TOKEN_FILE_BASENAME}`,
    );
    // 缺省路径落在用户数据根 `.dforge/` 下（不与真实家目录绑定断言）
    expect(daemonTokenPathFor({}).endsWith(`.dforge/${DAEMON_TOKEN_FILE_BASENAME}`)).toBe(true);
    // 纯空白覆盖视为未给：回落缺省（与显式未给同路径）
    expect(daemonTokenPathFor({ DF_DATA_ROOT: '   ' })).toBe(daemonTokenPathFor({}));
  });

  it('读令牌：文件存在返回去空白值；缺失/空白/不可读 → null（只读不写）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'df-shell-token-'));
    try {
      const env = { DF_DATA_ROOT: dir };
      // 缺失
      expect(await readDaemonToken(env)).toBeNull();
      // 存在（含换行）
      await writeFile(join(dir, DAEMON_TOKEN_FILE_BASENAME), ' abc123 \n', 'utf8');
      expect(await readDaemonToken(env)).toBe('abc123');
      // 空白文件
      await writeFile(join(dir, DAEMON_TOKEN_FILE_BASENAME), '  \n', 'utf8');
      expect(await readDaemonToken(env)).toBeNull();
      // 路径不存在（读失败）→ null，不炸
      expect(await readDaemonToken({ DF_DATA_ROOT: join(dir, 'nope') })).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it('appendTokenParam：追加/覆盖 dfToken，保留既有查询串与 hash；无效 URL 原样返回', () => {
    expect(appendTokenParam('http://localhost:3000/', 't1')).toBe(
      `http://localhost:3000/?${DAEMON_TOKEN_QUERY_KEY}=t1`,
    );
    expect(appendTokenParam('http://localhost:3000/editor?documentId=x#top', 't2')).toBe(
      `http://localhost:3000/editor?documentId=x&${DAEMON_TOKEN_QUERY_KEY}=t2#top`,
    );
    expect(appendTokenParam('http://localhost:3000/?dfToken=old', 't3')).toBe(
      `http://localhost:3000/?${DAEMON_TOKEN_QUERY_KEY}=t3`,
    );
    expect(appendTokenParam('not-a-url', 't4')).toBe('not-a-url');
  });
});
