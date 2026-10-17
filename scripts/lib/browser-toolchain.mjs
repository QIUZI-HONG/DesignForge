/**
 * 门禁浏览器工具链公共件（复核 J8：一处实现，不再第三份）。
 *
 * 此前两份最容易漂移的实现各自散落：
 * - **Chromium 解析**在 `verify-canvas` / `e2e-smoke` / `lib/ui-mount` / `verify-shell-parity`
 *   各存一份（`BENCH_CHROME_EXECUTABLE` → playwright 缓存探测）；
 * - **`/df-daemon` 请求转发**（页面相对前缀 → Playwright `page.route` → Node 侧 fetch 真 daemon，
 *   绕开浏览器 CORS 层）在 `verify-canvas` 与 `lib/ui-mount` 各存一份。
 * 本模块收口这两件：口径改动只在本文件生效。修复批次 5 · 工作包 E 已把
 * `verify-figma-*.mjs` 与 `verify-shell-parity.mjs` 的 Chromium 解析副本回抽到本模块
 * （O-07 销账，ADR-0004 债二补记），全仓不再有第 N 份实现。
 *
 * 转发路径另提供可测试的转发函数 {@link forwardSingleDaemonRequest}（`page.route` 回调只做适配），
 * 让「POST 体到达上游 / **业务 404 透传、路由级 404 与非 JSON 转受控 502**」在 **CI 无 Chromium**
 * 时也能回归（`scripts/tests/browser-toolchain.test.mjs`，DEF-01 的常绿防线）。
 */
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * 页面里的 daemon 相对前缀（Playwright 路由据此转发）。
 *
 * 为什么用相对前缀而不是绝对地址：客户端只做字符串拼接（`?daemon=/df-daemon`），
 * 相对前缀同样可用，且不由页面自己去连跨源 daemon（CORS 层交给 Node 侧转发绕开——
 * 被验证的仍是「客户端真实请求语义 + 真实 daemon」，同 verify-canvas 口径）。
 */
export const DAEMON_ROUTE_PREFIX = '/df-daemon';

/**
 * Chromium 可执行文件解析（playwright-core 需显式 `executablePath`）。
 *
 * 顺序：`BENCH_CHROME_EXECUTABLE`（存在才采用）→ `~/.cache/ms-playwright/chromium-<版本>/chrome-linux64/chrome`
 * （多版本时取排序后第一个存在的）。两者都没有 → `undefined`（调用方按「阻塞」处理，不得当通过）。
 */
export function resolveChromeExecutable() {
  const fromEnv = process.env.BENCH_CHROME_EXECUTABLE;
  if (fromEnv !== undefined && fromEnv !== '') {
    return existsSync(fromEnv) ? fromEnv : undefined;
  }
  const cacheRoot = join(homedir(), '.cache', 'ms-playwright');
  if (!existsSync(cacheRoot)) return undefined;
  const candidates = readdirSync(cacheRoot)
    .filter((name) => name.startsWith('chromium-'))
    .sort()
    .map((name) => join(cacheRoot, name, 'chrome-linux64', 'chrome'));
  return candidates.find((file) => existsSync(file));
}

/**
 * 取响应体里的业务错误 code（顶层 `code` 或 `error.code`）。
 *
 * 只认非空字符串；非合法 JSON / 无 code（含结构不符）→ `undefined`（判为路由级 404）。
 */
function businessErrorCode(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const code = parsed?.error?.code ?? parsed?.code;
  return typeof code === 'string' && code.trim() !== '' ? code : undefined;
}

/**
 * 转发单次请求到真实 daemon（Node 侧 fetch），返回可直接 fulfill 的 `{ status, headers, body }`。
 *
 * 这是**可测试的转发函数（fetch 可注入）**，不是纯函数：默认走全局 fetch，测试可传
 * `fetchImpl` 或对本地 HTTP 桩发真实请求。为什么从 `page.route` 回调里抽出来：浏览器门禁
 * 在 CI 没有 Chromium 二进制，转发语义（尤其 DEF-01：POST 体误入 headers）过去只能靠人工
 * 或一次性机器人发现。本函数只依赖 `{ url, method, postData() }` 形状与 fetch，可被
 * `node:test` 直接钉死。
 *
 * 语义：
 * - 路径前缀替换为目标 daemon 的同一路径 + 原查询串；
 * - 带 body 的方法（非 GET/HEAD）原样透传请求体；GET/HEAD **不发送 body**（空字符串也不行，
 *   否则 Node fetch 会拒绝或上游会误判为有体）；
 * - 合法 JSON 响应按**原状态码**透传（转发不是判定层，400/409 等业务错误照常到达页面）；
 * - **业务 404**（合法 JSON 且 `error.code` 或顶层 `code` 是非空字符串）→ **原 404 透传**：
 *   daemon 的业务错误是页面语义的一部分（`documents-client` 依赖 `doc_not_found` 显示
 *   「文档不存在」，市场侧同理 `market_asset_not_found`），不得改写成「接线错误」；
 * - **路由级 404**（非 JSON / 无 code 的 JSON）或非 JSON 响应 → 受控 **502** + `{ ok: false, message }` 信封；
 * - fetch 失败（daemon 掉线）→ 同样 502 信封。页面按「连不上」处理，不静默。
 *
 * 为什么要区分两种 404：本路径是「复用外部 daemon」的接线（页面相对前缀 → 真 daemon）。
 * 带业务 code 的 404 是 daemon **正常应答**（资源不存在），原样透传才是页面要的语义；
 * 无 code 的 404 才表示前缀剥离或目标 daemon 接错，非 JSON 表示对面不是预期的那条 API——
 * 两者都是**接线错误**，受控报错比把一本错误页/HTML 原样喂给页面、让页面误判为业务失败更可诊断。
 *
 * @param {{ url: string, method: string, postData?: () => string | null }} request
 * @param {string} daemonUrl 真 daemon 基址（如 http://127.0.0.1:4318）
 * @param {string} [prefix] 页面里的相对前缀（默认 {@link DAEMON_ROUTE_PREFIX}）
 * @param {typeof fetch} [fetchImpl] 测试注入（默认全局 fetch）
 * @returns {Promise<{ status: number, headers: Record<string, string>, body: string }>}
 */
export async function forwardSingleDaemonRequest(
  request,
  daemonUrl,
  prefix = DAEMON_ROUTE_PREFIX,
  fetchImpl = fetch,
) {
  const fail = (message) => ({
    status: 502,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ok: false, message }),
  });
  try {
    const url = new URL(request.url);
    const target = `${daemonUrl}${url.pathname.slice(prefix.length)}${url.search}`;
    const method = request.method.toUpperCase();
    const hasBody = method !== 'GET' && method !== 'HEAD';
    const response = await fetchImpl(target, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(hasBody ? { body: request.postData?.() ?? '{}' } : {}),
    });
    const text = method === 'HEAD' ? '' : await response.text();
    if (response.status === 404) {
      // 业务 404（daemon 合法 JSON 信封 + 非空 code）原状态码透传；路由级 404 才转 502。
      if (businessErrorCode(text) !== undefined) {
        return { status: 404, headers: { 'content-type': 'application/json' }, body: text };
      }
      return fail(`上游 daemon 未找到转发路径（404）：${method} ${url.pathname}`);
    }
    // HEAD 无响应体（HTTP 语义）；204/205/304 同样允许空体，不得按「非 JSON」转 502。
    if (
      method === 'HEAD' ||
      response.status === 204 ||
      response.status === 205 ||
      response.status === 304
    ) {
      return { status: response.status, headers: { 'content-type': 'application/json' }, body: '' };
    }
    try {
      JSON.parse(text);
    } catch {
      return fail(`上游 daemon 响应不是合法 JSON（${response.status}）：${method} ${url.pathname}`);
    }
    return { status: response.status, headers: { 'content-type': 'application/json' }, body: text };
  } catch (error) {
    return fail(`转发到外部 daemon 失败：${request.method} ${request.url}：${String(error)}`);
  }
}

/**
 * 把页面里 `**\/<prefix>/**` 的请求转发给真实 daemon（Node 侧 fetch）。
 *
 * 本函数只做 Playwright 侧的适配与 `page.route` 注册，单次转发语义在
 * {@link forwardSingleDaemonRequest}（可测试转发函数；业务 404 透传、路由级 404 / 非 JSON → 受控 502）。
 *
 * @param {import('playwright-core').Page} page
 * @param {string} daemonUrl 真 daemon 基址（如 http://127.0.0.1:4318）
 * @param {string} [prefix] 页面里的相对前缀（默认 {@link DAEMON_ROUTE_PREFIX}）
 */
export async function forwardDaemonRequests(page, daemonUrl, prefix = DAEMON_ROUTE_PREFIX) {
  await page.route(`**${prefix}/**`, async (route) => {
    const request = route.request();
    const result = await forwardSingleDaemonRequest(
      {
        url: request.url(),
        method: request.method(),
        postData: () => request.postData(),
      },
      daemonUrl,
      prefix,
    );
    await route.fulfill({
      status: result.status,
      contentType: result.headers['content-type'] ?? 'application/json',
      body: result.body,
    });
  });
}
