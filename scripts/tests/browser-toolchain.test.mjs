/**
 * scripts/lib/browser-toolchain.mjs 外部 daemon 转发路径自测（DEF-01 常绿回归）。
 *
 * 为什么在 Node 级钉死这条路径：`verify-canvas` / `lib/ui-mount` 走「页面相对前缀 →
 * Playwright `page.route` → Node 侧 fetch 真 daemon」的转发，浏览器门禁在 CI 里没有
 * Chromium 二进制、跑不起来；DEF-01（POST 体误入 headers）曾让门禁假红并逃过 CI。
 * 这里用本地 `node:http` 桩（`127.0.0.1` + 端口 0）直接断言**请求契约**：
 *   - POST 体原样到达上游且能 JSON 解码（不是塞进 header）；
 *   - **业务 404**（合法 JSON 且带 `error.code`）→ 原状态码 404 透传（`documents-client`
 *     依赖它显示「文档不存在」）；
 *   - **路由级 404**（无 code 的 JSON）/ 非 JSON 响应 → 受控 502 + JSON 错误信封；
 *   - GET / HEAD 不带 body（空字符串 body 也不行），上游收到的请求体长度为 0；
 *   - 合法 JSON 响应仍按原状态码透传（转发不是判定层）；
 *   - Playwright 适配层（`page.route` 注册 + `fulfill` 形状）用假 page/route 钉死，
 *     不启动浏览器。
 *
 * 用法：`node scripts/tests/browser-toolchain.test.mjs`（`pnpm test:scripts` 收录）。
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';

import {
  DAEMON_ROUTE_PREFIX,
  forwardDaemonRequest,
  forwardDaemonRequests,
} from '../lib/browser-toolchain.mjs';

/** 上游收到的请求快照（每个用例读最后一条；桩按 URL 分路）。 */
const seen = [];

let server;
let daemonUrl;

/** 读出完整请求体（GET/HEAD 时为空串）。 */
function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

before(async () => {
  server = createServer(async (request, response) => {
    const body = await readRequestBody(request);
    seen.push({
      method: request.method,
      url: request.url,
      headers: request.headers,
      body,
    });
    if (request.url === '/api/missing') {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end('{"ok":false,"message":"not found"}');
      return;
    }
    if (request.url === '/api/doc-missing') {
      // 业务 404：daemon 的合法 JSON 信封（文档不存在），必须原样透传给页面。
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end('{"ok":false,"error":{"code":"doc_not_found","message":"文档不存在"}}');
      return;
    }
    if (request.url === '/api/legacy') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<html><body>legacy</body></html>');
      return;
    }
    if (request.url === '/api/conflict') {
      response.writeHead(409, { 'content-type': 'application/json' });
      response.end('{"ok":false,"message":"name-taken"}');
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true, echo: body }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  daemonUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

/** 造一个 Playwright Request 的最小形状（`{ url, method, postData() }`）。 */
function makeRequest(pathname, method, postData = () => null) {
  return {
    url: `http://page.test${DAEMON_ROUTE_PREFIX}${pathname}`,
    method,
    postData,
  };
}

test('POST：请求体到达上游且能 JSON 解码（DEF-01：不是塞进 header）', async () => {
  const payload = { name: '样例文档' };
  const result = await forwardDaemonRequest(
    makeRequest('/api/documents?draft=1', 'POST', () => JSON.stringify(payload)),
    daemonUrl,
  );

  const upstream = seen.at(-1);
  assert.notEqual(upstream, undefined);
  assert.equal(upstream.method, 'POST');
  assert.equal(upstream.url, '/api/documents?draft=1', '前缀须剥掉、查询串须保留');
  assert.equal(upstream.body, JSON.stringify(payload));
  assert.deepEqual(JSON.parse(upstream.body), payload);
  assert.equal(
    Number(upstream.headers['content-length']),
    Buffer.byteLength(JSON.stringify(payload)),
    '请求体须以 body 传输（content-length 与体长一致），而不是 header 值',
  );
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.body), { ok: true, echo: JSON.stringify(payload) });
});

test('上游 404：返回受控 502 + JSON 错误信封（不原样透传）', async () => {
  const result = await forwardDaemonRequest(makeRequest('/api/missing', 'GET'), daemonUrl);

  assert.equal(result.status, 502);
  assert.match(result.headers['content-type'], /application\/json/);
  const envelope = JSON.parse(result.body);
  assert.equal(envelope.ok, false);
  assert.match(envelope.message, /404/);
});

test('业务 404（合法 JSON + error.code）：原状态码与信封透传，供页面显示「文档不存在」', async () => {
  const result = await forwardDaemonRequest(makeRequest('/api/doc-missing', 'GET'), daemonUrl);

  assert.equal(result.status, 404);
  assert.match(result.headers['content-type'], /application\/json/);
  const envelope = JSON.parse(result.body);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.error.code, 'doc_not_found');
  assert.equal(envelope.error.message, '文档不存在');
});

test('上游非 JSON：返回受控 502 + JSON 错误信封（不抛未捕获异常）', async () => {
  const result = await forwardDaemonRequest(makeRequest('/api/legacy', 'GET'), daemonUrl);

  assert.equal(result.status, 502);
  const envelope = JSON.parse(result.body);
  assert.equal(envelope.ok, false);
  assert.match(envelope.message, /JSON/);
});

test('合法 JSON 响应：原状态码与响应体透传（转发不是判定层）', async () => {
  const result = await forwardDaemonRequest(makeRequest('/api/conflict', 'GET'), daemonUrl);

  assert.equal(result.status, 409);
  assert.deepEqual(JSON.parse(result.body), { ok: false, message: 'name-taken' });
});

test('GET / HEAD：不发送 body（空字符串也不行），上游收到的请求体长度为 0', async () => {
  for (const method of ['GET', 'HEAD']) {
    const calls = [];
    /** 注入 fetch 桩：观察转发层交给 fetch 的 init 形状。 */
    const fakeFetch = async (_url, init) => {
      calls.push(init);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const result = await forwardDaemonRequest(
      makeRequest('/api/ping', method, () => ''),
      daemonUrl,
      DAEMON_ROUTE_PREFIX,
      fakeFetch,
    );
    assert.equal(calls[0]?.method, method);
    assert.equal('body' in calls[0], false, `${method} 不得带 body（即使空字符串）`);
    assert.equal(result.status, 200);

    await forwardDaemonRequest(
      makeRequest('/api/ping', method, () => ''),
      daemonUrl,
    );
    const upstream = seen.at(-1);
    assert.equal(upstream.method, method);
    assert.equal(upstream.body.length, 0, `${method} 上游不得收到空字符串 body`);
    assert.equal(
      upstream.headers['content-length'] === undefined ||
        Number(upstream.headers['content-length']) === 0,
      true,
    );
    if (method === 'HEAD') assert.equal(result.body, '');
  }
});

test('适配层：注册 **/df-daemon/** 路由，并把转发结果按 { status, contentType, body } fulfill', async () => {
  let captured;
  /** 假 page：只收集 route 注册（不启动浏览器）。 */
  const fakePage = {
    route: async (pattern, handler) => {
      captured = { pattern, handler };
    },
  };
  await forwardDaemonRequests(fakePage, daemonUrl);
  assert.equal(captured?.pattern, '**/df-daemon/**');

  const calls = [];
  /** 假 route：`request()` 给 Playwright Request 的最小形状（url/method 是方法），`fulfill` 收集参数。 */
  const makeRoute = (pathname, method, postData = () => null) => ({
    request: () => ({
      url: () => `http://page.test${DAEMON_ROUTE_PREFIX}${pathname}`,
      method: () => method,
      postData,
    }),
    fulfill: async (options) => {
      calls.push(options);
    },
  });

  const payload = { name: '适配层文档' };
  await captured.handler(
    makeRoute('/api/documents?draft=1', 'POST', () => JSON.stringify(payload)),
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].status, 200);
  assert.match(calls[0].contentType, /application\/json/);
  assert.deepEqual(JSON.parse(calls[0].body), {
    ok: true,
    echo: JSON.stringify(payload),
  });
  assert.equal(seen.at(-1).body, JSON.stringify(payload), 'POST 体经适配层原样到达上游');

  await captured.handler(makeRoute('/api/conflict', 'GET'));
  assert.equal(calls.length, 2);
  assert.equal(calls[1].status, 409);
  assert.deepEqual(JSON.parse(calls[1].body), { ok: false, message: 'name-taken' });
});
