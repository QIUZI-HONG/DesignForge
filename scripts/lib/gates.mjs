/**
 * 门禁公共件（FE-02）：同源网关 + 夹具 daemon。
 *
 * 为什么需要「同源网关」：架构 v1.1 §3.1 把 Web 应用与 daemon 的关系定为**同源 HTTP**
 * （生产形态是 daemon / 桌面壳把前端与 API 放在同一源下）。而 dev / 门禁里站点与 daemon
 * 各占一个端口，浏览器直连 daemon 会因缺 CORS 响应头被拦——CORS 开关属 daemon（INF-01）
 * 的口径，不在本票范围。因此门禁侧用极简反向代理把两者还原成一个源：
 * `/df/*` → daemon（剥掉前缀），其余 → 站点。被代理的请求与生产同源形态等价。
 *
 * 为什么需要「夹具 daemon」：页面级截图要能对上参照集，就必须让页面显示**指定的样例数据**
 * （参照集是采集会话按演示文件截的）。`startFixtureDaemon` 用临时数据根起一个真 daemon，
 * 并把工作目录指向给定夹具目录——取样与判定都跑在真链路上。
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 取一个空闲端口（先 listen 0 再关，交给子进程用）。 */
export function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

/** 逐跳头与长度类头交给 fetch/传输层自行决定。 */
const HOP_BY_HOP = new Set([
  'host',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'content-length',
]);

/**
 * 起一个同源网关：站点挂在 `/`，daemon 挂在 `/df`。
 *
 * @param {{ webUrl: string, daemonUrl: string, port?: number }} options
 * @returns {Promise<{ url: string, close: () => Promise<void> }>}
 */
export async function startSameOriginGateway({ webUrl, daemonUrl, port }) {
  const listenPort = port ?? (await freePort());
  const server = createServer((request, response) => {
    const isDaemon = (request.url ?? '').startsWith('/df');
    const upstreamBase = isDaemon ? daemonUrl : webUrl;
    const path = isDaemon ? (request.url ?? '').slice('/df'.length) : (request.url ?? '/');
    const target = `${upstreamBase}${path.startsWith('/') ? path : `/${path}`}`;

    const headers = {};
    for (const [key, value] of Object.entries(request.headers)) {
      if (HOP_BY_HOP.has(key.toLowerCase())) continue;
      if (value !== undefined) headers[key] = value;
    }

    const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
    fetch(target, {
      method: request.method,
      headers,
      ...(hasBody ? { body: Readable.toWeb(request), duplex: 'half' } : {}),
      redirect: 'manual',
    })
      .then((upstream) => {
        // undici 已透明解压上游响应体：必须去掉 content-encoding/content-length，
        // 否则浏览器按「已压缩」的元数据去解一段未压缩字节 → ERR_CONTENT_DECODING_FAILED
        const outHeaders = {};
        for (const [key, value] of upstream.headers.entries()) {
          const lower = key.toLowerCase();
          if (lower === 'content-encoding' || lower === 'content-length') continue;
          if (lower === 'transfer-encoding') continue;
          outHeaders[key] = value;
        }
        response.writeHead(upstream.status, outHeaders);
        if (upstream.body === null) response.end();
        else Readable.fromWeb(upstream.body).pipe(response);
      })
      .catch((error) => {
        response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
        response.end(`gateway: ${String(error)}`);
      });
  });

  await new Promise((resolveListen, rejectListen) => {
    server.on('error', rejectListen);
    server.listen(listenPort, '127.0.0.1', resolveListen);
  });

  return {
    url: `http://127.0.0.1:${String(listenPort)}`,
    close: () => new Promise((resolveClose) => server.close(() => resolveClose())),
  };
}

/**
 * 起一个夹具 daemon（真子进程）：数据根与工作目录可指定，端口自动取空闲值。
 *
 * @param {{ dataRoot: string, workspaceDir: string, timeoutMs?: number }} options
 * @returns {Promise<{ url: string, output: string, close: () => Promise<void> }>}
 */
export async function startFixtureDaemon({ dataRoot, workspaceDir, timeoutMs = 20_000 }) {
  const port = await freePort();
  const child = spawn(process.execPath, [join(repoRoot, 'apps/daemon/src/main.ts')], {
    cwd: repoRoot,
    env: {
      ...process.env,
      DF_DATA_ROOT: dataRoot,
      DF_WORKSPACE_DIR: workspaceDir,
      DF_PORT: String(port),
      DF_HOST: '127.0.0.1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  const url = await new Promise((resolveUrl) => {
    const timer = setTimeout(() => resolveUrl(null), timeoutMs);
    child.stdout.on('data', (chunk) => {
      output += String(chunk);
      const match = /listening on (http:\/\/[^\s]+)/.exec(output);
      if (match !== null) {
        clearTimeout(timer);
        resolveUrl(match[1]);
      }
    });
    child.stderr.on('data', (chunk) => {
      output += String(chunk);
    });
    child.on('exit', () => {
      clearTimeout(timer);
      resolveUrl(null);
    });
  });

  if (url === null) {
    child.kill('SIGTERM');
    throw new Error(`夹具 daemon 起不来（末 2000 字符输出）：${output.slice(-2000)}`);
  }

  return {
    url,
    output,
    close: () =>
      new Promise((resolveClose) => {
        if (child.exitCode !== null) {
          resolveClose();
          return;
        }
        child.on('exit', () => resolveClose());
        child.kill('SIGTERM');
      }),
  };
}
