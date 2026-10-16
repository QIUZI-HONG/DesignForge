/**
 * 门禁浏览器工具链公共件（复核 J8：一处实现，不再第三份）。
 *
 * 此前两份最容易漂移的实现各自散落：
 * - **Chromium 解析**在 `verify-canvas` / `e2e-smoke` / `lib/ui-mount` / `verify-shell-parity`
 *   各存一份（`BENCH_CHROME_EXECUTABLE` → playwright 缓存探测）；
 * - **`/df-daemon` 请求转发**（页面相对前缀 → Playwright `page.route` → Node 侧 fetch 真 daemon，
 *   绕开浏览器 CORS 层）在 `verify-canvas` 与 `lib/ui-mount` 各存一份。
 * 本模块收口这两件：口径改动只在本文件生效（figma 系列门禁的同名副本留待其票收口，
 * 不在本批范围内——见 code-review 汇报的偏离说明）。
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
 * 把页面里 `**\/<prefix>/**` 的请求转发给真实 daemon（Node 侧 fetch）。
 *
 * 语义：路径前缀替换为目标 daemon 的同一路径 + 原查询串；带 body 的方法原样透传
 * （POST/PUT）；转发失败（daemon 掉线）→ 502 + 失败信封（页面按「连不上」处理，不静默）。
 *
 * @param {import('playwright-core').Page} page
 * @param {string} daemonUrl 真 daemon 基址（如 http://127.0.0.1:4318）
 * @param {string} [prefix] 页面里的相对前缀（默认 {@link DAEMON_ROUTE_PREFIX}）
 */
export async function forwardDaemonRequests(page, daemonUrl, prefix = DAEMON_ROUTE_PREFIX) {
  await page.route(`**${prefix}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const target = `${daemonUrl}${url.pathname.slice(prefix.length)}${url.search}`;
    const hasBody = request.method() !== 'GET' && request.method() !== 'HEAD';
    try {
      const response = await fetch(target, {
        method: request.method(),
        headers: {
          'content-type': 'application/json',
          ...(hasBody ? { body: request.postData() ?? '{}' } : {}),
        },
      });
      await route.fulfill({
        status: response.status,
        contentType: 'application/json',
        body: await response.text(),
      });
    } catch (error) {
      await route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, message: String(error) }),
      });
    }
  });
}
