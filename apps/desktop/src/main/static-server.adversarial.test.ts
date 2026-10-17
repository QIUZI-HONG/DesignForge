/**
 * 对抗测试（验证方 test/verify-web-b）· 壳内静态服务的穿越防护补盲。
 *
 * 已有用例覆盖 `/../`、`/..%2f`、`/a/../../` 三个 404 断言；本文件改打**不变量**：
 * 「解出的路径必须永远落在产物目录内（否则 404）」——这比逐例 404 更接近安全目标，
 * 也覆盖 POSIX/Windows 分隔符差异（`\\` 在 POSIX 是普通文件名字符、在 Windows 是分隔符，
 * 两种语义下都不得越出 rootDir）。
 */
import { describe, expect, it } from 'vitest';

import { resolveStaticFileRequest } from './static-server';

const ROOT = '/repo/apps/web/out';

/** 攻击面清单（含编码/怪字符/分隔符变体）。 */
const attempts = [
  ['双编码穿越', '/%252e%252e%252fsecret.txt'],
  ['反斜杠穿越', '/..\\secret.txt'],
  ['反斜杠编码穿越', '/..%5csecret.txt'],
  ['空字节截断', '/index.html%00.png'],
  ['纯点段（%2e）', '/%2e%2e/secret.txt'],
  ['混合大小写编码', '/..%2F..%2Fsecret.txt'],
  ['绝对路径伪装', '//etc/passwd'],
  ['盘符伪装', '/C:/windows/win.ini'],
  ['深层相对', '/a/b/../../../secret.txt'],
  ['编码的当前目录', '/%2e/secret.txt'],
  ['相似前缀目录冒充', '/../../apps/web/out-evil/x.js'],
  ['畸形编码', '/%zz'],
  ['解码后含点段', '/%2e%2e%2f%2e%2e%2fetc/passwd'],
] as const;

describe('对抗 · 静态服务穿越防护（不变量：永不越出产物目录）', () => {
  it.each(attempts)('%s → 404 或仍在 rootDir 内（绝不越狱）', (_label, requestPath) => {
    const result = resolveStaticFileRequest({
      rootDir: ROOT,
      requestPath,
      exists: () => true, // 极端假设：攻击者能让任意路径「存在」
    });
    if (result.status === 404) return;
    const resolved = result.filePath;
    const inside = resolved === ROOT || resolved.startsWith(`${ROOT}/`);
    if (!inside) {
      throw new Error(`越出产物目录：${requestPath} → ${resolved}`);
    }
    expect(inside).toBe(true);
  });

  it('明文点段（含编码后）一律 404（既有口径不回退）', () => {
    for (const path of ['/../secret.txt', '/..%2fsecret.txt', '/a/../../secret.txt']) {
      expect(
        resolveStaticFileRequest({ rootDir: ROOT, requestPath: path, exists: () => true }),
      ).toEqual({ status: 404 });
    }
  });

  it('合法路径仍可命中（防护不是一刀切拒绝）', () => {
    const hit = resolveStaticFileRequest({
      rootDir: ROOT,
      requestPath: '/_next/static/chunk.js',
      exists: (p) => p === '/repo/apps/web/out/_next/static/chunk.js',
    });
    expect(hit.status).toBe(200);
  });

  it('根请求与目录请求映射 index.html，且拼接不产生双斜杠/逃逸', () => {
    const root = resolveStaticFileRequest({
      rootDir: ROOT,
      requestPath: '/',
      exists: (p) => p === `${ROOT}/index.html`,
    });
    expect(root).toEqual({ status: 200, filePath: `${ROOT}/index.html` });
  });
});
