import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveStaticFileRequest, startStaticServer } from './static-server.js';

const ROOT = '/repo/apps/web/out';
const existing = new Set([
  `${ROOT}/index.html`,
  `${ROOT}/assets/app.css`,
  `${ROOT}/assets/app.js`,
  `${ROOT}/sub/index.html`,
]);

describe('内置静态服务的请求解析（web 产物装载口径）', () => {
  it('根路径映射到 index.html', () => {
    expect(
      resolveStaticFileRequest({ rootDir: ROOT, requestPath: '/', exists: (p) => existing.has(p) }),
    ).toEqual({ status: 200, filePath: `${ROOT}/index.html` });
  });

  it('目录路径映射到该目录 index.html', () => {
    expect(
      resolveStaticFileRequest({
        rootDir: ROOT,
        requestPath: '/sub/',
        exists: (p) => existing.has(p),
      }),
    ).toEqual({ status: 200, filePath: `${ROOT}/sub/index.html` });
  });

  it('静态资源按原路径映射（保留 Next 导出的绝对资源路径口径）', () => {
    expect(
      resolveStaticFileRequest({
        rootDir: ROOT,
        requestPath: '/assets/app.css',
        exists: (p) => existing.has(p),
      }),
    ).toEqual({ status: 200, filePath: `${ROOT}/assets/app.css` });
  });

  it('不存在的资源 404', () => {
    expect(
      resolveStaticFileRequest({
        rootDir: ROOT,
        requestPath: '/nope.js',
        exists: (p) => existing.has(p),
      }),
    ).toEqual({ status: 404 });
  });

  it('路径穿越一律 404（含编码穿越）', () => {
    const exists = () => true;
    expect(
      resolveStaticFileRequest({ rootDir: ROOT, requestPath: '/../secret.txt', exists }),
    ).toEqual({
      status: 404,
    });
    expect(
      resolveStaticFileRequest({ rootDir: ROOT, requestPath: '/..%2fsecret.txt', exists }),
    ).toEqual({
      status: 404,
    });
    expect(
      resolveStaticFileRequest({ rootDir: ROOT, requestPath: '/a/../../secret.txt', exists }),
    ).toEqual({
      status: 404,
    });
  });
});

describe('内置静态服务 · 目录请求不得打断服务（产物里的目录是真实存在的）', () => {
  it('请求已存在的目录（无尾斜杠）→ 404，且服务仍能继续响应（不把 EISDIR 抛成未捕获异常）', async () => {
    const root = await mkdtemp(join(tmpdir(), 'df-static-server-'));
    try {
      await mkdir(join(root, 'assets'));
      await writeFile(join(root, 'index.html'), '<!doctype html>');
      const { server, origin } = await startStaticServer(root);
      try {
        // 目录请求：产物里 `assets` 是目录 → 不能当文件读（readFileSync 抛 EISDIR 会打断主进程）
        const dirResponse = await fetch(`${origin}/assets`);
        expect(dirResponse.status).toBe(404);
        // 服务没被打断：后续正常文件请求照常 200
        const fileResponse = await fetch(`${origin}/index.html`);
        expect(fileResponse.status).toBe(200);
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) reject(error);
            else resolve();
          });
        });
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
