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

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readlinkSync } from 'node:fs';
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
 * 缺失的共享库清单（`ldd` 的 `=> not found` 行）。
 *
 * 为什么需要：playwright 的 Chromium 二进制与系统库解耦，宿主没装 NSS/NSPr 等依赖时
 * 二进制在、launch 却失败（`libnspr4.so: cannot open shared object file`）。
 * 这是「前置不成立」的机器状态，门禁必须能判定成 exit 2，而不是把它当产品缺陷。
 *
 * @param {string} chromePath Chromium 可执行文件绝对路径
 * @returns {string[]} 缺失库文件名（无缺失 → 空数组）
 */
export function missingChromeLibraries(chromePath) {
  const result = spawnSync('ldd', [chromePath], { encoding: 'utf8' });
  if (result.status !== 0 && typeof result.stdout !== 'string') return [];
  const missing = [];
  for (const line of result.stdout.split('\n')) {
    const match = /=> not found/.exec(line);
    if (match === null) continue;
    const name = line.trim().split(/\s+/)[0];
    if (name !== undefined && name !== '') missing.push(name);
  }
  return [...new Set(missing)];
}

/**
 * 本机共享库目录候选（仓外，按顺序探测）。
 *
 * `~/.cache/ms-playwright` 只装二进制；宿主缺库时本仓历史做法是把一套解包库放在
 * `~/opt/playwright-libs`（figma 基线取证时落地）。显式环境变量优先，便于换机/CI。
 */
function chromeLibraryCandidates() {
  const fromEnv = process.env.DF_CHROME_LIB_DIR;
  const candidates = [
    join(homedir(), 'opt', 'playwright-libs', 'root', 'usr', 'lib', 'x86_64-linux-gnu'),
  ];
  if (fromEnv !== undefined && fromEnv !== '') candidates.unshift(fromEnv);
  return candidates;
}

/**
 * 让 Chromium 能跑起来：缺库时把可用的库目录前置进 `LD_LIBRARY_PATH`（仅本进程 + 子进程）。
 *
 * 返回 `{ ok, missing }`：`ok=false` 表示**宿主缺库且本机无可补目录**，调用方必须按
 * 「前置不成立」exit 2（禁当通过，也不得静默用缺依赖的二进制硬跑）。
 *
 * @param {string} chromePath Chromium 可执行文件绝对路径
 * @returns {{ ok: boolean, missing: string[], libraryPath: string | null }}
 */
export function ensureChromeLibraries(chromePath) {
  const missing = missingChromeLibraries(chromePath);
  if (missing.length === 0) return { ok: true, missing, libraryPath: null };
  for (const dir of chromeLibraryCandidates()) {
    if (!existsSync(dir)) continue;
    const covers = missing.every((name) => existsSync(join(dir, name)) || hasLinkFor(dir, name));
    if (!covers) continue;
    const current = process.env.LD_LIBRARY_PATH;
    process.env.LD_LIBRARY_PATH =
      current === undefined || current === '' ? dir : `${dir}:${current}`;
    const stillMissing = missingChromeLibraries(chromePath);
    if (stillMissing.length === 0) return { ok: true, missing, libraryPath: dir };
  }
  return { ok: false, missing, libraryPath: null };
}

/** 目录里是否存在该库（含「无后缀名字的软链」形态，如 `libnspr4.so -> libnspr4.so.0d`）。 */
function hasLinkFor(dir, name) {
  const base = name.replace(/\.so(\..*)?$/, '.so');
  if (!existsSync(join(dir, base))) return false;
  try {
    return readlinkSync(join(dir, base)).length > 0 || existsSync(join(dir, base));
  } catch {
    return existsSync(join(dir, base));
  }
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
        headers: { 'content-type': 'application/json' },
        ...(hasBody ? { body: request.postData() ?? '{}' } : {}),
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
