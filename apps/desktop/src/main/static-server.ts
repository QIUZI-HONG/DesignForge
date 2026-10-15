/**
 * 壳内置静态服务 —— 用 http://127.0.0.1:<随机端口> 装载 `apps/web` 静态产物。
 *
 * 为什么不用 `file://`：Next 导出产物的资源是**绝对路径**（`/_next/...`），file:// 下会 404；
 * 且验收标准 §3 要求「同一产物在浏览器与壳内一致」——浏览器侧走 http，壳内也就走 http。
 *
 * 测试面：请求解析（`resolveStaticFileRequest`）是纯函数，含路径穿越防护；
 * `startStaticServer` 只是 node:http 的薄壳，行为由启动冒烟段（scripts/verify-shell-parity.mjs）端到端覆盖。
 */
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize } from 'node:path';

/** 单次请求的解析结果。 */
export type StaticRequestResolution = { status: 200; filePath: string } | { status: 404 };

/** 显式 MIME 表：静态导出产物必须带正确 Content-Type（ESM/CSS 无正确类型会被浏览器拒绝执行）。 */
const MIME_BY_EXT: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
};

/** 取 Content-Type（未知扩展名按二进制流，不猜）。 */
export function contentTypeFor(filePath: string): string {
  return MIME_BY_EXT[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * 把请求路径解析到产物目录内的文件。
 *
 * 口径：`/` 与目录路径 → 该目录 `index.html`；其余按原路径取文件；
 * 任何含 `..`/`.` 段或解码失败/空字节的请求**一律 404**（穿越防护），且结果必须落在 rootDir 内。
 */
export function resolveStaticFileRequest(input: {
  rootDir: string;
  requestPath: string;
  exists: (path: string) => boolean;
}): StaticRequestResolution {
  const { rootDir, requestPath, exists } = input;

  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return { status: 404 };
  }
  if (decoded.includes('\0')) {
    return { status: 404 };
  }

  // 查询串不属于路径（Electron 侧已剥离，这里兜底）。
  const pathOnly = decoded.split('?')[0] ?? '';
  const segments = pathOnly.split('/').filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment === '..' || segment === '.')) {
    return { status: 404 };
  }

  const root = normalize(rootDir);
  const relative = segments.join('/');
  const base = relative === '' ? root : join(root, relative);
  /** 目录请求（或根请求）直接找 index.html；文件请求先试原路径。 */
  const candidates =
    relative === '' || pathOnly.endsWith('/')
      ? [join(base, 'index.html')]
      : [base, join(base, 'index.html')];

  for (const candidate of candidates) {
    const resolved = normalize(candidate);
    if (resolved !== root && !resolved.startsWith(`${root}/`)) {
      continue; // 越出产物目录：拒绝
    }
    if (exists(resolved)) {
      return { status: 200, filePath: resolved };
    }
  }
  return { status: 404 };
}

/** 启动内置静态服务；返回监听地址（端口为 0 时由系统分配，避免与 daemon 抢口）。 */
export function startStaticServer(rootDir: string): Promise<{ server: Server; origin: string }> {
  const server = createServer((request, response) => {
    const resolved = resolveStaticFileRequest({
      rootDir,
      requestPath: request.url ?? '/',
      exists: existsSync,
    });
    if (resolved.status !== 200) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('404');
      return;
    }
    response.writeHead(200, { 'content-type': contentTypeFor(resolved.filePath) });
    response.end(readFileSync(resolved.filePath));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

/**
 * 起一个**故意不发 CORS 头**的本地端口，用于 webSecurity 反证：
 * 页面（另一 origin）去 fetch 它——同源策略生效则必然被拒（webSecurity=true），
 * 若成功则说明 webSecurity 被关（违规证据）。等价于「浏览器侧的 CORS 生效性」实测。
 */
export function startCorsProbeServer(): Promise<{ server: Server; origin: string }> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('probe');
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}
