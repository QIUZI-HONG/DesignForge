#!/usr/bin/env node
/**
 * verify-command-palette —— 票 04（spec P0-4 断点三）浏览器门禁挂点：命令面板成品形态。
 *
 * 为什么必须是浏览器门禁：jsdom 不加载外部 CSS——「样式表已引入、计算样式生效、
 * 卡片真居中、速查卡真在视口内」这类断言在组件测试里永远看不见（巡检的根因
 * 「25 条规则全仓无 import」正是组件测试测不出的故障类）。
 *
 * 断言（全部走真实 Chromium + 生产构建，**禁用 next dev**——见 implementation-workflow）：
 *   ① 首页按 Ctrl+K（⌘K 的 Windows/Linux 口径）呼出面板：容器有遮罩底色（非透明）、
 *      卡片居中（水平中心 ≈ 视口中心）、卡片有圆角/海拔阴影/描边（样式表真生效）；
 *   ② 编辑器 ⌘K 与 ⌘/（别名）都能呼出，Esc 关闭；
 *   ③ 长按 Ctrl ≥ 400ms：速查卡出现且 **boundingBox 完整落在视口内**
 *      （巡检实测 y≈916 / 视口高 900，完全不可见——本断言即其回归钉）；
 *   ④ 设置页 Ctrl+K 呼出（全局入口的第三页）。
 *
 * **挂点（随票接入）**：本门禁未接 CI；断言脚本与证据落盘已就绪，浏览器级复核由
 * 主会话在集成分支统一执行（`humanReview.verdict` 恒为 pending，直到复核登记）。
 *
 * 退出码（三态，禁止假绿）：0 全过 / 1 断言违规 / 2 阻塞（构建失败 / 站点不可达 /
 * Chromium 缺失 / 用例异常）。
 *
 * 用法（仓库根执行）：
 *   node scripts/verify-command-palette.mjs
 *   DF_WEB_URL=http://127.0.0.1:<port> node scripts/verify-command-palette.mjs   # 复用已起站点
 *
 * 环境变量：DF_WEB_URL / DF_EVIDENCE_DIR / BENCH_CHROME_EXECUTABLE。
 * 端口纪律：空闲端口（4460 起），不碰 3000/4318；不起 daemon（面板断言不依赖数据面）。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveChromeExecutable } from './lib/browser-toolchain.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEB_APP_DIR = join(REPO_ROOT, 'apps', 'web');
const EVIDENCE_DIR = resolve(
  process.env.DF_EVIDENCE_DIR ?? join(homedir(), 'df-evidence', '04-command-palette'),
);

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const flagValue = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
let webUrl = flagValue('--web-url') ?? process.env.DF_WEB_URL ?? null;

const startedAt = new Date();
const stamp = startedAt.toISOString().replaceAll(':', '-').replace(/\..+$/, '');
const evidencePath = join(EVIDENCE_DIR, `verify-command-palette-${stamp}.json`);

/** 证据对象（验收标准 §4 字段族；humanReview 恒待主会话登记）。 */
const evidence = {
  ticket: '04-command-palette',
  gate: 'verify-command-palette',
  level: 'A（几何/计算样式/视口内可见性——jsdom 不可达的样式事实）',
  viewport: { width: 1440, height: 900 },
  startedAt: startedAt.toISOString(),
  webUrl: null,
  assertions: [],
  notes: [],
  humanReview: {
    verdict: 'pending',
    reviewer: null,
    reason:
      '挂点（随票接入）：断言脚本已就绪；浏览器级复核（视觉观感/主题两态）由主会话在集成分支统一执行。',
  },
  exitCode: 2,
};

function record(id, ok, detail) {
  evidence.assertions.push({ id, ok, detail });
  const mark = ok === true ? 'ok' : 'FAIL';
  console.log(`  [${mark}] ${id} —— ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
}

/** 子进程登记：任何退出路径都整组回收（独立进程组），不留 next 残留。 */
const children = new Set();
const groupLeaderPids = new Set();
function track(child, detached = false) {
  children.add(child);
  if (detached && child.pid !== undefined) groupLeaderPids.add(child.pid);
  child.on('exit', () => children.delete(child));
  return child;
}
function signalChildren(signal) {
  for (const child of children) {
    try {
      if (child.pid !== undefined && groupLeaderPids.has(child.pid)) {
        process.kill(-child.pid, signal);
      } else {
        child.kill(signal);
      }
    } catch {
      // 已退出
    }
  }
}
process.on('exit', () => signalChildren('SIGTERM'));
for (const [signal, code] of [
  ['SIGINT', 130],
  ['SIGTERM', 143],
]) {
  process.on(signal, () => {
    signalChildren(signal);
    // 手动中断也要兜底 SIGKILL（同 finish 的两段回收口径）
    setTimeout(() => {
      signalChildren('SIGKILL');
      process.exit(code);
    }, 300);
  });
}

async function finish(code, message) {
  evidence.finishedAt = new Date().toISOString();
  evidence.exitCode = code;
  evidence.webUrl = webUrl;
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(`证据：${evidencePath}`);
  if (message) console.error(message);
  // 两段回收：SIGTERM 给优雅收尾的机会（next start 的宽限窗口实测可越过直接退出），
  // 800ms 后 SIGKILL 兜底——实测残留 next-server 会占住端口（另一 worktree 曾积 21 个）。
  signalChildren('SIGTERM');
  await new Promise((settle) => setTimeout(settle, 800));
  signalChildren('SIGKILL');
  await new Promise((settle) => setTimeout(settle, 200));
  // 第三段（Next 16 实测）：`next start` 会把 next-server fork 进**另一个进程组**再退出——
  // 组杀够不到它。按端口找监听者的精确 PID 再 SIGKILL：端口是本脚本选的空闲端口（4460+），
  // 谁在上面监听谁就是本脚本起的（绝不波及其它端口/进程，符合「只按精确 PID 回收自己起的进程」）。
  if (webUrl !== null) {
    const port = Number(new URL(webUrl).port);
    if (Number.isFinite(port) && (await portBusy(port))) {
      const killed = killPortListener(port);
      console.log(killed ? `回收残留监听进程（端口 ${port}）` : `警告：端口 ${port} 仍有监听者，未能按 PID 回收`);
    }
  }
  process.exit(code);
}

/**
 * 按「监听端口 → socket inode → 持有 fd 的进程」找监听者并 SIGKILL（精确 PID）。
 *
 * 只应作用于本脚本自选的空闲端口；其它端口一律不碰。
 *
 * @returns 是否找到并回收了监听进程
 */
function killPortListener(port) {
  const hex = port.toString(16).toUpperCase().padStart(4, '0');
  for (const table of ['/proc/net/tcp', '/proc/net/tcp6']) {
    if (!existsSync(table)) continue;
    for (const line of readFileSync(table, 'utf8').split('\n').slice(1)) {
      const columns = line.trim().split(/\s+/);
      const local = columns[1] ?? '';
      if (!local.endsWith(`:${hex}`) || columns[3] !== '0A') continue; // 0A = LISTEN
      const inode = columns[9];
      for (const entry of readdirSync('/proc')) {
        if (!/^\d+$/.test(entry)) continue;
        try {
          for (const fd of readdirSync(`/proc/${entry}/fd`)) {
            if (readlinkSync(`/proc/${entry}/fd/${fd}`) === `socket:[${inode}]`) {
              process.kill(Number(entry), 'SIGKILL');
              return true;
            }
          }
        } catch {
          // 进程已退出 / fd 已关闭：继续
        }
      }
    }
  }
  return false;
}

/** 端口是否可连。 */
function portBusy(port) {
  return new Promise((settle) => {
    const child = spawn(
      process.execPath,
      [
        '-e',
        `const s=require('net').connect({port:${port}});s.on('connect',()=>{s.destroy();process.exit(0)});s.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),800)`,
      ],
      { stdio: 'ignore' },
    );
    child.on('exit', (code) => settle(code === 0));
  });
}

/** 找空闲端口（4460 起，远离 3000/4318）。 */
async function freePort() {
  for (let port = 4460; port < 4520; port += 1) {
    if (!(await portBusy(port))) return port;
  }
  throw new Error('找不到空闲端口');
}

/** HTTP 探测（轮询到站点就绪）。 */
async function waitForHttp(url, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(url, { redirect: 'follow' });
      if (response.status < 500) return true;
    } catch {
      // 未就绪，继续等
    }
    if (Date.now() > deadline) return false;
    await new Promise((settle) => setTimeout(settle, 200));
  }
}

/** 等待页面谓词成立（取返回值；超时抛错）。 */
async function waitFor(page, predicateBody, { timeout = 15000, label = '' } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await page
      .evaluate(new Function(`return (${predicateBody})()`))
      .catch(() => null);
    if (value !== null && value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new Error(`等待超时（${timeout}ms）：${label}`);
    await new Promise((settle) => setTimeout(settle, 100));
  }
}

/** 取元素的计算样式字段族（一个 evaluate 拿全，减少往返）。 */
async function computedOf(page, selector, fields) {
  return page.evaluate(
    ({ selector, fields }) => {
      const element = document.querySelector(selector);
      if (element === null) return null;
      const style = getComputedStyle(element);
      return Object.fromEntries(fields.map((field) => [field, style[field]]));
    },
    { selector, fields },
  );
}

/** 打开页面并等客户端引导件就绪（SPA 引导挂载后 ⌘K 才有宿主）。 */
async function openReady(page, path, readySelector) {
  await page.goto(`${webUrl}${path}`, { waitUntil: 'load' });
  await waitFor(page, `() => document.querySelector(${JSON.stringify(readySelector)}) !== null`, {
    label: `页面就绪：${path}`,
  });
}

const PALETTE_DIALOG = '[role="dialog"][aria-label="命令面板"]';

try {
  // --- 站点：复用 DF_WEB_URL，或生产构建 + 起服务（禁 next dev，见 implementation-workflow） ---
  if (webUrl === null) {
    const webPort = await freePort();
    webUrl = `http://127.0.0.1:${webPort}`;
    const nextBin = join(WEB_APP_DIR, 'node_modules', '.bin', 'next');
    if (!existsSync(nextBin)) {
      await finish(2, '阻塞：未找到 next 可执行文件（先 pnpm install）。');
    }
    console.log('生产构建（next build）…');
    const build = track(spawn(nextBin, ['build'], { cwd: WEB_APP_DIR, stdio: 'inherit' }));
    const buildCode = await new Promise((settle) => build.on('exit', settle));
    if (buildCode !== 0) {
      await finish(2, '阻塞：web 构建失败（见上方 next build 输出）。');
    }
    track(
      spawn(nextBin, ['start', '-p', String(webPort)], {
        cwd: WEB_APP_DIR,
        stdio: verbose ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      }),
      true,
    );
  }
  if (!(await waitForHttp(webUrl, 60_000, '站点'))) {
    await finish(2, `阻塞：站点不可达（${webUrl}）。`);
  }
  console.log(`站点就绪：${webUrl}`);

  const chrome = resolveChromeExecutable();
  if (chrome === undefined) {
    await finish(2, '阻塞：未找到 Chromium 可执行文件（BENCH_CHROME_EXECUTABLE 未设且缓存缺失）。');
  }
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: chrome, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // --- ① 首页：⌘K 呼出 + 成品形态（遮罩/居中/卡片样式） ---
  console.log('首页（/）· Ctrl+K 呼出与成品形态');
  await openReady(page, '/', '[data-df-page], .dfg-home');
  await page.keyboard.press('Control+k');
  await waitFor(page, `() => document.querySelector(${JSON.stringify(PALETTE_DIALOG)})`, {
    label: '首页 ⌘K 呼出面板',
  });

  const containerStyle = await computedOf(page, '.dfg-cmdk', ['backgroundColor']);
  record(
    'home.palette.container-backdrop',
    containerStyle !== null && containerStyle.backgroundColor !== 'rgba(0, 0, 0, 0)',
    `遮罩底色非透明：${containerStyle?.backgroundColor ?? '（容器不存在）'}`,
  );

  const cardStyle = await computedOf(page, '.dfg-cmdk__card', [
    'borderRadius',
    'boxShadow',
    'borderStyle',
    'borderTopWidth',
    'backgroundColor',
  ]);
  record(
    'home.palette.card-radius',
    cardStyle !== null && cardStyle.borderRadius !== '0px',
    `卡片圆角：${cardStyle?.borderRadius ?? '（卡片不存在）'}`,
  );
  record(
    'home.palette.card-elevation',
    cardStyle !== null && cardStyle.boxShadow !== 'none' && cardStyle.boxShadow !== '',
    `卡片海拔阴影：${cardStyle?.boxShadow ?? ''}`,
  );
  record(
    'home.palette.card-border',
    cardStyle !== null && cardStyle.borderStyle === 'solid' && cardStyle.borderTopWidth !== '0px',
    `卡片描边：${cardStyle?.borderTopWidth ?? ''} ${cardStyle?.borderStyle ?? ''}`,
  );

  const cardBox = await page.locator('.dfg-cmdk__card').boundingBox();
  if (cardBox === null) {
    record('home.palette.card-centered', false, '卡片不存在（boundingBox 为 null）');
  } else {
    const centerX = cardBox.x + cardBox.width / 2;
    const drift = Math.abs(centerX - 1440 / 2);
    record(
      'home.palette.card-centered',
      drift <= 2,
      `卡片水平中心 ${centerX.toFixed(1)}，视口中心 720，偏差 ${drift.toFixed(1)}px`,
    );
  }

  await page.keyboard.press('Escape');
  await waitFor(page, `() => document.querySelector(${JSON.stringify(PALETTE_DIALOG)}) === null`, {
    label: 'Esc 关闭面板',
  });
  record('home.palette.esc-closes', true, 'Esc 关闭且面板离场');

  // --- ② 编辑器：⌘K 全局 + ⌘/ 别名 + 速查卡入视口 ---
  console.log('编辑器（/editor）· ⌘K / ⌘/ 并存与速查卡视口内');
  await openReady(page, '/editor', '[data-df-canvas-shell], [data-df-page="editor"]');

  await page.keyboard.press('Control+k');
  await waitFor(page, `() => document.querySelector(${JSON.stringify(PALETTE_DIALOG)})`, {
    label: '编辑器 ⌘K 呼出面板',
  });
  record('editor.palette.ctrl-k-opens', true, 'Ctrl+K（⌘K）呼出');
  await page.keyboard.press('Escape');
  await waitFor(page, `() => document.querySelector(${JSON.stringify(PALETTE_DIALOG)}) === null`, {
    label: 'Esc 关闭',
  });

  await page.keyboard.press('Control+Slash');
  await waitFor(page, `() => document.querySelector(${JSON.stringify(PALETTE_DIALOG)})`, {
    label: '编辑器 ⌘/ 别名呼出面板',
  });
  record('editor.palette.ctrl-slash-alias-opens', true, 'Ctrl+/（⌘/ 别名）呼出');
  await page.keyboard.press('Escape');
  await waitFor(page, `() => document.querySelector(${JSON.stringify(PALETTE_DIALOG)}) === null`, {
    label: 'Esc 关闭',
  });

  // 长按 Ctrl ≥ 400ms（SHORTCUT_HOLD_REVEAL_MS）→ 速查卡出现，且整体在视口内
  await page.keyboard.down('Control');
  await page.waitForTimeout(700);
  const cheatBox = await page.locator('.dfg-cmdk-cheat').boundingBox();
  await page.keyboard.up('Control');
  if (cheatBox === null) {
    record('editor.cheat.in-viewport', false, '长按 Ctrl 未出现速查卡（或样式未生效）');
  } else {
    const inside =
      cheatBox.x >= 0 &&
      cheatBox.y >= 0 &&
      cheatBox.x + cheatBox.width <= 1440 &&
      cheatBox.y + cheatBox.height <= 900;
    record(
      'editor.cheat.in-viewport',
      inside,
      `速查卡 boundingBox ${JSON.stringify(cheatBox)}，视口 1440×900 → ${
        inside ? '完整可见' : '越界'
      }（巡检基线：y=916 完全不可见）`,
    );
  }
  await page.waitForTimeout(150);
  const cheatGone = await page.locator('.dfg-cmdk-cheat').count();
  record('editor.cheat.hides-on-release', cheatGone === 0, '松开修饰键速查卡消失');

  // --- ③ 设置页：⌘K 全局 ---
  console.log('设置页（/settings）· Ctrl+K 呼出');
  await openReady(page, '/settings', 'body');
  await page.keyboard.press('Control+k');
  await waitFor(page, `() => document.querySelector(${JSON.stringify(PALETTE_DIALOG)})`, {
    label: '设置页 ⌘K 呼出面板',
  });
  record('settings.palette.ctrl-k-opens', true, '设置页 Ctrl+K（⌘K）呼出');

  await context.close();
  await browser.close();

  const failed = evidence.assertions.filter((item) => item.ok !== true);
  if (failed.length > 0) {
    await finish(1, `违规 ${failed.length} 条（明细见证据 JSON）。`);
  }
  await finish(0, undefined);
} catch (error) {
  await finish(2, `阻塞：${String(error)}`);
}
