import { describe, expect, it } from 'vitest';

import { resolveStaticFileRequest } from './static-server.js';

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
