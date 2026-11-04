/**
 * figma 取证 module —— 7 份 `verify-figma-*` 门禁的唯一取证实现（arch-04）。
 *
 * 收口前每份门禁各存一份 `baseEvidence` / `finish` / `fingerprint` /
 * `inspectReferenceDir` / `resolveChrome` / `probeSite`，且已出现两处语义分叉：
 * - `verify-figma-inspect` 的 `finish` 签名变成了 `(code, message)`；
 * - 7 份副本的 Chromium 解析**不校验** `BENCH_CHROME_EXECUTABLE` 的存在性，而
 *   `lib/browser-toolchain.mjs` 与 `verify-shell-parity.mjs` 校验——非法 env 在两类门禁
 *   里一个「稍后崩」一个「直接阻塞」。本 module 统一以 lib 为准（**语义变化已登记**：
 *   非法 `BENCH_CHROME_EXECUTABLE` 现在直接 exit 2 阻塞，而不是带病进入浏览器阶段）。
 *
 * 本 module 吸收的职责（门禁侧只剩「单元表 + prepare 剧本 + 本面独有的断言」）：
 *   1. 证据骨架与落盘（文件名 `<gate>-<stamp>.json`、JSON 缩进、`exitCode`/`finishedAt`）；
 *   2. 参照集冻结判定、站点探测、Chromium 解析、浏览器生命周期；
 *   3. 逐单元截图（元素 / 裁剪区 / 整页）、pixelmatch 比对、差异包围盒、证据指纹；
 *   4. 三态出口（0 通过 / 1 违规 / 2 阻塞）与阻塞文案模板——`2` 绝不等价于通过；
 *   5. 单元执行剧本（`prepare`）与门禁独有的阶段钩子（功能段 / 交互断言 / 不变量）。
 *
 * 证据形状不变：各门禁通过 `evidenceShape` 选择既有记录形状（unit / editor / sample /
 * state / inspect / inspector），键集与逐单元状态名保持原样（由
 * `scripts/tests/figma-evidence.test.mjs` 锁定）。
 *
 * 用法（门禁脚本内）：
 *   const { code, evidence } = await runFigmaGate({ gateName, ticket, page, units, ... });
 *   // 默认把 process.exitCode 设为 code；测试可通过 deps.exit 注入。
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { resolveChromeExecutable } from './browser-toolchain.mjs';
import { bboxOfDiff } from './pixels.mjs';

/** 三态退出码（与 `docs/agents/implementation-workflow.md` 同源）。 */
export const GATE_EXIT = Object.freeze({ PASS: 0, VIOLATION: 1, BLOCKED: 2 });

const DEFAULT_LEVEL = 'A（布局/几何/颜色；字形与阴影按 B 级人工复核）';
const DEFAULT_HUMAN_REVIEW = {
  verdict: 'pending',
  reviewer: null,
  reason: '自动判定只给 A 级结论；字形/阴影/动效终态按 B 级需人工复核登记。',
};
const CHROME_REASON = '未找到 Chromium 可执行文件（BENCH_CHROME_EXECUTABLE 未设且缓存缺失）';
const CHROME_MESSAGE = [
  '阻塞：未找到 Chromium 可执行文件（研究 #5：playwright-core 需显式 executablePath）。',
];

/**
 * 三态裁决（纯函数）。
 *
 * 优先级：**阻塞 > 违规 > 通过**。`pending`（状态在宿主页上取不到）与
 * `blockedReasons` 一样是阻塞语义——判不了就是 exit 2，不得降级成 0/1。
 *
 * @param {{blockedReasons?: string[], failures?: number, pending?: number}} [state]
 * @returns {0 | 1 | 2}
 */
export function gateExitCode({ blockedReasons = [], failures = 0, pending = 0 } = {}) {
  if (blockedReasons.length > 0 || pending > 0) return GATE_EXIT.BLOCKED;
  return failures > 0 ? GATE_EXIT.VIOLATION : GATE_EXIT.PASS;
}

/** `{sha256, length}` 指纹（大件入证据的约定）。 */
export function fingerprint(filePath) {
  const buffer = readFileSync(filePath);
  return {
    path: filePath,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    length: buffer.length,
  };
}

/** 参照集探测：目录存在且有 PNG 才算「已冻结」。 */
export function inspectReferenceDir(referenceDir) {
  if (!existsSync(referenceDir))
    return { ready: false, reason: `参照集目录不存在：${referenceDir}` };
  const files = readdirSync(referenceDir).filter((name) => name.endsWith('.png'));
  if (files.length === 0) return { ready: false, reason: `参照集为空（无 PNG）：${referenceDir}` };
  return { ready: true, files };
}

/**
 * 站点探测（不可达即阻塞，不猜）。
 *
 * @param {string} url
 * @param {{mode?: 'follow' | 'manual', fetchImpl?: typeof fetch}} [options]
 *   `follow`：`response.ok` 才算可达（页面级/宿主页）；`manual`：HTTP < 500 即可达
 *   （面板/评审面允许重定向，5xx 才算不可达）。
 */
export async function probeSite(url, { mode = 'follow', fetchImpl = fetch } = {}) {
  try {
    const response = await fetchImpl(url, { redirect: mode === 'manual' ? 'manual' : 'follow' });
    const reachable = mode === 'manual' ? response.status < 500 : response.ok;
    return { reachable, status: response.status };
  } catch (error) {
    return { reachable: false, status: 0, error: String(error) };
  }
}

/** 像素工具按需加载（门禁在阻塞路径上完全不碰 playwright/pngjs/pixelmatch）。 */
let pixelToolsPromise;
async function loadPixelTools() {
  pixelToolsPromise ??= Promise.all([import('pngjs'), import('pixelmatch')]).then(
    ([pngjs, pixelmatch]) => ({ PNG: pngjs.PNG, pixelmatch: pixelmatch.default }),
  );
  return pixelToolsPromise;
}

/**
 * 截图 ↔ 参照图比对（单处实现）。
 *
 * @returns {Promise<
 *   | {status: 'missing-reference'}
 *   | {status: 'size-mismatch', reference: {width, height}, actual: {width, height}}
 *   | {status: 'pass' | 'fail', diff: object, artifacts: object}
 * >}
 */
export async function compareShot({ refPath, actualPath, diffPath, threshold, maxRatio }) {
  if (!existsSync(refPath)) return { status: 'missing-reference' };
  const { PNG, pixelmatch } = await loadPixelTools();
  const refPng = PNG.sync.read(readFileSync(refPath));
  const actualPng = PNG.sync.read(readFileSync(actualPath));
  if (refPng.width !== actualPng.width || refPng.height !== actualPng.height) {
    return {
      status: 'size-mismatch',
      reference: { width: refPng.width, height: refPng.height },
      actual: { width: actualPng.width, height: actualPng.height },
    };
  }

  const diffPng = new PNG({ width: refPng.width, height: refPng.height });
  const diffPixels = pixelmatch(
    refPng.data,
    actualPng.data,
    diffPng.data,
    refPng.width,
    refPng.height,
    { threshold, includeAA: false },
  );
  const total = refPng.width * refPng.height;
  const ratio = total === 0 ? 0 : diffPixels / total;
  writeFileSync(diffPath, PNG.sync.write(diffPng));

  return {
    status: ratio <= maxRatio ? 'pass' : 'fail',
    diff: {
      diffPixels,
      totalPixels: total,
      ratio: Number(ratio.toFixed(6)),
      bbox: bboxOfDiff(diffPng),
    },
    artifacts: {
      ref: fingerprint(refPath),
      actual: fingerprint(actualPath),
      diff: fingerprint(diffPath),
    },
  };
}

/**
 * 落盘证据并结束门禁（**统一签名** `(evidence, code, message)`）。
 *
 * 6 份门禁原本就是此签名；`verify-figma-inspect` 的 `(code, message)` 分叉在本 module
 * 收口（arch-04）。`exit` 默认只设 `process.exitCode`，便于单测注入；
 * CLI 门禁在 `runFigmaGate` 返回后进程自然结束。
 *
 * @param {object} evidence 证据对象（会被写入 exitCode / finishedAt）
 * @param {0 | 1 | 2} code 三态退出码
 * @param {string} [message] 打印到 stderr 的结论/阻塞文案
 * @param {{evidenceDir?: string, evidencePath: string, now?: () => Date, log?: (line: string) => void, exit?: (code: number) => void}} [options]
 */
export function finish(evidence, code, message, options = {}) {
  const {
    evidenceDir,
    evidencePath,
    now = () => new Date(),
    log = (line) => console.error(line),
    exit = (value) => {
      process.exitCode = value;
    },
  } = options;
  if (typeof evidencePath !== 'string' || evidencePath === '') {
    throw new Error('finish：必须提供 evidencePath（证据落盘路径）');
  }
  evidence.exitCode = code;
  evidence.finishedAt = now().toISOString();
  mkdirSync(evidenceDir ?? dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  if (message) log(message);
  log(`证据：${evidencePath}`);
  exit(code);
  return { code, evidence };
}

/** 单元表里 `id` 的安全文件名（`/` → `_`，与原 7 份门禁一致）。 */
function safeName(id) {
  return id.replaceAll('/', '_');
}

function createEvidence(spec, startedAt) {
  return {
    ticket: spec.evidenceTicket ?? spec.ticket.toUpperCase(),
    gate: spec.gateName,
    page: spec.page,
    level: spec.level ?? DEFAULT_LEVEL,
    ...(spec.theme === undefined ? {} : { theme: spec.theme }),
    params: spec.params,
    viewport: spec.viewport,
    startedAt: startedAt.toISOString(),
    ...(spec.extras ?? {}),
    referenceDir: spec.referenceDir,
    [spec.recordKey]: [],
    ...(spec.recordExtras ?? {}),
    stateCoverage: spec.stateCoverage ?? [],
    artifacts: {},
    ...(spec.trailingExtras ?? {}),
    humanReview: spec.humanReview ?? DEFAULT_HUMAN_REVIEW,
    exitCode: GATE_EXIT.BLOCKED,
  };
}

function createRecord(evidenceShape, unit) {
  switch (evidenceShape) {
    case 'editor':
    case 'unit':
      return { id: unit.id };
    case 'sample':
      return { id: unit.id, note: unit.note, root: unit.root };
    case 'state':
      return { state: unit.state };
    case 'inspect':
      return {
        id: unit.id,
        title: unit.title,
        ref: unit.ref,
        status: 'pending',
        diff: null,
        invariants: [],
        artifacts: {},
      };
    case 'inspector':
      return { state: unit.state, title: unit.title, status: 'pending', invariants: [] };
    default:
      throw new Error(`未知 evidenceShape：${String(evidenceShape)}`);
  }
}

function setUnitOutcome(evidenceShape, record, unit, outcome) {
  switch (evidenceShape) {
    case 'unit':
      if (outcome.status === 'missing-reference') {
        record.status = outcome.status;
        record.reference = outcome.reference;
      } else if (outcome.status === 'size-mismatch') {
        record.status = outcome.status;
        record.reference = outcome.reference;
        record.actual = outcome.actual;
      } else {
        record.status = outcome.status;
        record.diff = outcome.diff;
        record.artifacts = outcome.artifacts;
      }
      return;
    case 'editor':
      if (outcome.status === 'missing-reference') {
        record.status = outcome.status;
        record.reference = outcome.reference;
      } else if (outcome.status === 'size-mismatch') {
        record.status = outcome.status;
        record.reference = outcome.reference;
        record.actual = outcome.actual;
      } else {
        record.status = outcome.status;
        record.state = unit.state;
        record.note = unit.note;
        record.diff = outcome.diff;
        record.artifacts = outcome.artifacts;
      }
      return;
    case 'sample':
      record.status = outcome.status;
      if (outcome.status === 'missing-reference') record.reference = outcome.reference;
      else if (outcome.status === 'size-mismatch') {
        record.reference = outcome.reference;
        record.actual = outcome.actual;
      } else {
        record.diff = outcome.diff;
        record.artifacts = outcome.artifacts;
      }
      return;
    case 'state':
      record.status = outcome.status;
      if (outcome.status === 'missing-reference') record.reference = outcome.reference;
      else if (outcome.status === 'size-mismatch') {
        record.reference = outcome.reference;
        record.actual = outcome.actual;
      } else if (outcome.artifacts !== undefined) {
        record.diff = outcome.diff;
        record.artifacts = outcome.artifacts;
      }
      return;
    case 'inspect':
      if (outcome.status === 'missing-reference') {
        record.status = 'missing-reference';
        record.reference = outcome.reference;
      } else if (outcome.status === 'size-mismatch') {
        record.status = 'size-mismatch';
        record.diff = {
          bbox: null,
          diffPixels: null,
          ratio: null,
          reference: outcome.reference,
          actual: outcome.actual,
        };
      } else {
        record.status = outcome.status === 'pass' ? 'passed' : 'failed';
        record.diff = outcome.diff;
        record.artifacts.diff = outcome.artifacts.diff;
        record.artifacts.ref = outcome.artifacts.ref;
        record.artifacts.actual = outcome.artifacts.actual;
      }
      return;
    case 'inspector':
      if (outcome.status === 'missing-reference') {
        record.status = 'missing-reference';
        record.reference = outcome.reference;
      } else if (outcome.status === 'size-mismatch') {
        record.status = 'size-mismatch';
        record.diff = {
          bbox: null,
          refSize: outcome.reference,
          actualSize: outcome.actual,
        };
      } else {
        record.status = outcome.status;
        record.diff = outcome.diff;
        record.artifacts = outcome.artifacts;
      }
      return;
    default:
      throw new Error(`未知 evidenceShape：${String(evidenceShape)}`);
  }
}

/** 归一化后的「缺参照图」记录（home 用命名模式串，其余用完整路径）。 */
function missingReference(ref, path) {
  return {
    status: 'missing-reference',
    reference: path === null || path === undefined ? ref.label : path,
  };
}

function referencePathFor(spec, unit, ctx) {
  if (typeof spec.referencePath === 'function') return spec.referencePath(unit, ctx);
  if (unit.ref !== undefined) return { path: join(spec.referenceDir, unit.ref) };
  return { path: join(spec.referenceDir, `${safeName(unit.id)}.png`) };
}

function artifactNameFor(spec, unit) {
  if (typeof spec.artifactName === 'function') return spec.artifactName(unit);
  return safeName(unit.id);
}

function contextOptionsFor(spec) {
  return {
    viewport: { width: spec.viewport.width, height: spec.viewport.height },
    deviceScaleFactor: spec.viewport.dpr,
    ...(spec.context?.reducedMotion === undefined
      ? {}
      : { reducedMotion: spec.context.reducedMotion }),
  };
}

async function gotoPage(page, url, capture) {
  await page.goto(url, { waitUntil: capture?.waitUntil ?? 'networkidle' });
  if (capture?.waitFor !== undefined) await page.waitForSelector(capture.waitFor);
  if (capture?.fontsReady !== false) await page.evaluate(() => document.fonts.ready);
}

/** 单元 skip 信号（prepare/单元缺失时由取证循环分类）。 */
class UnitSkip extends Error {
  constructor(status, detail) {
    super(detail);
    this.name = 'UnitSkip';
    this.status = status;
    this.detail = detail;
  }
}

async function captureUnit(spec, unit, page, actualPath) {
  const capture = spec.capture ?? {};
  if (capture.kind === 'page') {
    await page.screenshot({ path: actualPath, animations: 'disabled' });
    return;
  }
  const selector =
    typeof capture.root === 'function'
      ? capture.root(unit)
      : (unit.root ?? `[data-df-preview="${unit.id}"]`);
  const element = page.locator(selector);
  if (capture.requireUnit !== undefined && (await element.count()) === 0) {
    if (capture.requireUnit === 'missing-unit') {
      throw new UnitSkip('missing-unit', '页面上没有该取样单元');
    }
    throw new UnitSkip('pending', '状态在宿主页上取不到：页面上没有该取样单元');
  }
  if (capture.kind === 'element') {
    await element.screenshot({ path: actualPath, animations: 'disabled' });
    return;
  }

  const target = element.first();
  await target.waitFor({ state: 'visible', timeout: capture.waitTimeout ?? 3000 });
  const box = await target.boundingBox();
  if (box === null) throw new Error('元素没有包围盒');
  const margin = capture.margin ?? 0;
  await page.screenshot({
    path: actualPath,
    clip: {
      x: Math.max(0, box.x - margin),
      y: Math.max(0, box.y - margin),
      width: box.width + margin * 2,
      height: box.height + margin * 2,
    },
    animations: 'disabled',
  });
}

function block(ctx, { reason, message, stop = true, skipUnits = false, code = GATE_EXIT.BLOCKED }) {
  if (reason !== undefined && reason !== null) {
    ctx.blockedReasons.push(reason);
    ctx.evidence.blockedReason = reason;
  }
  if (skipUnits) ctx.skipUnits = true;
  const text = Array.isArray(message) ? message.join('\n') : message;
  // stop=true 的文案由 finish 统一打印（避免阻塞文案双写）；stop=false 的阶段性
  // 阻塞（inspect 的功能段/参照集）立即打印，后续仍继续收集其余阻塞原因。
  if (text && !stop) ctx.log(text);
  if (stop) ctx.pendingFinish = { code, message: text };
}

function closeBrowser(ctx) {
  return ctx.browser === null
    ? Promise.resolve()
    : ctx.browser.close().finally(() => {
        ctx.browser = null;
      });
}

async function openBrowser(ctx) {
  const { spec } = ctx;
  ctx.browser = await ctx.deps.launchBrowser({
    executablePath: ctx.chrome,
    args: ['--no-sandbox'],
  });
  if (spec.capture?.freshContext === true) return;
  ctx.context = await ctx.browser.newContext(contextOptionsFor(spec));
  ctx.page = await ctx.context.newPage();
  const url = ctx.url;
  if (url !== undefined && spec.capture?.goto !== false) {
    await gotoPage(ctx.page, url, spec.capture);
  }
}

async function openFreshPage(ctx, unit) {
  const { spec } = ctx;
  const context = await ctx.browser.newContext(contextOptionsFor(spec));
  const page = await context.newPage();
  const url = typeof spec.url === 'function' ? spec.url(ctx, unit) : spec.url;
  if (url !== undefined) await gotoPage(page, url, spec.capture);
  return { context, page };
}

async function resolveUnits(ctx) {
  const units =
    typeof ctx.spec.units === 'function' ? await ctx.spec.units(ctx) : (ctx.spec.units ?? []);
  if (ctx.spec.only === undefined) return units;
  const key = ctx.spec.onlyKey ?? 'id';
  return units.filter((unit) => unit[key] === ctx.spec.only);
}

async function runUnits(ctx) {
  const { spec, evidence } = ctx;
  const capture = spec.capture ?? {};
  const style = spec.evidenceShape ?? 'unit';
  const actualDir = join(ctx.evidenceDir, 'actual');
  const diffDir = join(ctx.evidenceDir, 'diff');
  mkdirSync(actualDir, { recursive: true });
  mkdirSync(diffDir, { recursive: true });

  const units = await resolveUnits(ctx);
  ctx.units = units;
  ctx.targets = units;
  await spec.hooks?.afterUnitsResolved?.(ctx);
  if (ctx.pendingFinish !== null) return;

  for (const unit of units) {
    const record = createRecord(style, unit);
    evidence[spec.recordKey].push(record);

    let phase = 'goto';
    let page = ctx.page;
    let unitContext = null;
    try {
      if (capture.freshContext === true) {
        const opened = await openFreshPage(ctx, unit);
        unitContext = opened.context;
        page = opened.page;
      } else if (capture.perUnitGoto === true) {
        const url =
          typeof capture.unitUrl === 'function'
            ? capture.unitUrl(unit, ctx)
            : (unit.url ?? (typeof spec.url === 'function' ? spec.url(ctx, unit) : spec.url));
        await page.goto(url, { waitUntil: capture.waitUntil ?? 'networkidle' });
        if (capture.waitFor !== undefined) await page.waitForSelector(capture.waitFor);
        if (capture.fontsPerUnit === true) await page.evaluate(() => document.fonts.ready);
      }

      // 门禁独有的单元前检查（主题守卫 / DOM 不变量）：可记账并请求跳过本单元。
      phase = 'precheck';
      const precheck = await spec.hooks?.beforeCapture?.({ ctx, unit, record, page });
      if (precheck?.skip === true) {
        if (precheck.failure === true) ctx.failures += 1;
        if (precheck.pending === true) ctx.pending += 1;
        continue;
      }

      // prepare 剧本：把宿主页推进到该单元的状态。
      phase = 'prepare';
      let prepared;
      try {
        prepared = unit.prepare === undefined ? undefined : await unit.prepare(page, ctx);
        if (capture.fontsAfterPrepare === true) {
          await page.evaluate(() => document.fonts.ready);
        }
        if (capture.settleMs !== undefined) await page.waitForTimeout(capture.settleMs);
      } catch (error) {
        if (capture.unitError === 'pending') {
          record.status = 'pending';
          record.reason = `状态在宿主页上取不到：${
            error instanceof Error ? error.message : String(error)
          }`;
          ctx.pending += 1;
          if (ctx.spec.verbose === true) ctx.log(`  … ${unit.id}：${record.reason}`);
          continue;
        }
        if (style === 'editor') {
          record.status = 'interaction-failed';
          record.error = String(error);
          ctx.failures += 1;
          continue;
        }
        if (style === 'state') {
          record.status = 'recipe-failed';
          record.reason = String(error);
          ctx.failures += 1;
          if (ctx.spec.verbose === true)
            ctx.log(`  ✗ ${unit.state}：取样配方失败（${String(error)}）`);
          continue;
        }
        throw error;
      }
      if (style === 'state') record.annotate = prepared?.annotate ?? {};

      const name = artifactNameFor(spec, unit);
      const actualPath = join(actualDir, `${name}.png`);
      const diffPath = join(diffDir, `${name}.png`);
      phase = 'capture';
      await captureUnit(spec, unit, page, actualPath);

      if (style === 'inspect') record.artifacts.actual = fingerprint(actualPath);
      if (style === 'inspector')
        evidence.artifacts[`${unit.state}Actual`] = fingerprint(actualPath);

      if (capture.sampleOnly === true) {
        record.status = 'sampled';
        record.artifacts = { actual: fingerprint(actualPath) };
        continue;
      }

      const reference = referencePathFor(spec, unit, ctx);
      const refPath = reference.path ?? null;
      if (style === 'inspect' && refPath !== null && existsSync(refPath)) {
        record.artifacts.ref = fingerprint(refPath);
      }
      if (style === 'inspector' && refPath !== null && existsSync(refPath)) {
        evidence.artifacts[`${unit.state}Ref`] = fingerprint(refPath);
      }

      phase = 'compare';
      let outcome;
      if (refPath === null || !existsSync(refPath)) {
        outcome = missingReference(reference, refPath);
      } else {
        outcome = await compareShot({
          refPath,
          actualPath,
          diffPath,
          threshold: spec.thresholds.threshold,
          maxRatio: spec.thresholds.maxRatio,
        });
        if (outcome.status === 'missing-reference') {
          outcome = missingReference(reference, refPath);
        } else if (style === 'inspect' && outcome.artifacts !== undefined) {
          record.artifacts.diff = outcome.artifacts.diff;
        } else if (style === 'inspector' && outcome.artifacts !== undefined) {
          evidence.artifacts[`${unit.state}Diff`] = outcome.artifacts.diff;
        }
      }

      setUnitOutcome(style, record, unit, outcome);
      if (outcome.status === 'pass') {
        if (ctx.spec.verbose === true) {
          ctx.log(
            `  ✓ ${unit.id ?? unit.state}：差异率 ${((outcome.diff?.ratio ?? 0) * 100).toFixed(4)}%`,
          );
        }
      } else if (outcome.status === 'fail') {
        ctx.failures += 1;
        if (ctx.spec.verbose === true || ctx.spec.logFailures === true) {
          ctx.log(
            `  ✗ ${unit.id ?? unit.state}：差异率 ${((outcome.diff?.ratio ?? 0) * 100).toFixed(4)}%${
              ctx.spec.failLogSuffix ?? ''
            }`,
          );
        }
      } else {
        ctx.failures += 1;
        if (
          (ctx.spec.verbose === true || ctx.spec.logMissingReference === true) &&
          outcome.status === 'missing-reference'
        ) {
          const label = typeof outcome.reference === 'string' ? basename(outcome.reference) : '';
          ctx.log(`  ✗ ${unit.id ?? unit.state}：参照图缺失（${label}）`);
        }
      }
    } catch (error) {
      if (error instanceof UnitSkip) {
        if (error.status === 'missing-unit') {
          record.status = 'missing-unit';
          record.note = error.detail;
          ctx.failures += 1;
        } else {
          record.status = 'pending';
          record.reason = error.detail;
          ctx.pending += 1;
          if (ctx.spec.verbose === true) ctx.log(`  … ${unit.id}：${record.reason}`);
        }
        continue;
      }
      // 面板/评审面的 pending 口径只覆盖「取样阶段取不到」；比对阶段的异常仍按脚本层错误抛出。
      if (capture.unitError === 'pending' && phase !== 'compare') {
        record.status = 'pending';
        record.reason = `状态在宿主页上取不到：${
          error instanceof Error ? error.message : String(error)
        }`;
        ctx.pending += 1;
        if (ctx.spec.verbose === true) ctx.log(`  … ${unit.id}：${record.reason}`);
        continue;
      }
      if (spec.evidenceShape === 'inspect' && phase === 'capture') {
        record.status = 'screenshot-failed';
        record.error = String(error).slice(0, 300);
        ctx.failures += 1;
        ctx.log(`  ✗ ${unit.id} 截图失败 —— ${record.error}`);
        continue;
      }
      throw error;
    } finally {
      if (unitContext !== null) await unitContext.close();
    }
    if (ctx.pendingFinish !== null) return;
  }
}

function defaultReferenceMessage(reference) {
  return [
    '阻塞：参照集未冻结（REF-01 未完成）。',
    `原因：${reference.reason}`,
    '待办：冻结参照集后运行本门禁逐单元取证；在此之前任何「通过」都是假绿。',
  ];
}

/**
 * 跑一台 figma 取证门禁。
 *
 * @param {object} spec 门禁声明（见模块头）；核心字段：
 *   `{gateName, ticket, page, units, referenceDir, thresholds, prepare, evidenceShape,
 *     recordKey, capture, reference, probe, chrome, mount, hooks, deps}`。
 * @returns {Promise<{code: 0 | 1 | 2, evidence: object}>}
 */
export async function runFigmaGate(spec) {
  const deps = {
    now: () => new Date(),
    log: (line) => console.error(line),
    exit: (code) => {
      process.exitCode = code;
    },
    probe: probeSite,
    resolveChrome: resolveChromeExecutable,
    launchBrowser: async ({ executablePath, args }) => {
      const { chromium } = await import('playwright-core');
      return chromium.launch({ executablePath, args });
    },
    ...(spec.deps ?? {}),
  };

  const startedAt = deps.now();
  const stamp = startedAt.toISOString().replaceAll(':', '-').replace(/\..+$/, '');
  const evidenceDir = join(spec.evidenceRoot, spec.ticket);
  const evidencePath = join(evidenceDir, `${spec.gateName}-${stamp}.json`);
  const evidence = createEvidence(spec, startedAt);
  const ctx = {
    spec,
    evidence,
    evidenceDir,
    evidencePath,
    startedAt,
    reference: null,
    chrome: null,
    browser: null,
    context: null,
    page: null,
    url: undefined,
    units: [],
    targets: [],
    blockedReasons: [],
    failures: 0,
    pending: 0,
    skipUnits: false,
    pendingFinish: null,
    log: deps.log,
    deps,
  };
  // 钩子把「阶段性阻塞 / 提前收尾」交回取证 module（文案与三态出口只此一处）。
  ctx.block = (options) => block(ctx, options);

  const finishOptions = {
    evidenceDir,
    evidencePath,
    now: deps.now,
    log: deps.log,
    exit: deps.exit,
  };
  const finalize = async (code, message) => {
    // 资源回收（如 home 的夹具 daemon / 同源网关）在**每条出口**都跑一次，含早期阻塞路径。
    await hooks.cleanup?.(ctx);
    if (spec.blockedReason === 'joined') {
      evidence.blockedReason = ctx.blockedReasons.length > 0 ? ctx.blockedReasons.join('；') : null;
    }
    return finish(evidence, code, message, finishOptions);
  };

  const hooks = spec.hooks ?? {};
  const referenceConfig = spec.reference ?? {};
  const referenceEnabled = referenceConfig.when !== 'skip';

  const stopIfPending = async () => {
    if (ctx.pendingFinish === null) return false;
    await closeBrowser(ctx);
    return true;
  };
  const finishPending = () => finalize(ctx.pendingFinish.code, ctx.pendingFinish.message);

  try {
    await hooks.beforeReference?.(ctx);
    if (await stopIfPending()) return finishPending();

    if (referenceEnabled) {
      const reference = inspectReferenceDir(spec.referenceDir);
      ctx.reference = reference;
      if (!reference.ready && referenceConfig.when === 'early') {
        await referenceConfig.onBlocked?.(ctx, reference);
        block(ctx, {
          reason: referenceConfig.reason?.(ctx, reference) ?? reference.reason,
          message: referenceConfig.message?.(ctx, reference) ?? defaultReferenceMessage(reference),
          stop: referenceConfig.stop !== false,
          skipUnits: referenceConfig.skipUnitsOnBlock === true,
        });
      }
    }
    if (await stopIfPending()) return finishPending();

    if (!ctx.skipUnits && spec.probe !== undefined) {
      const probeConfig = spec.probe;
      const url = typeof probeConfig.url === 'function' ? probeConfig.url(ctx) : probeConfig.url;
      const result = await deps.probe(url, { mode: probeConfig.mode ?? 'follow' });
      if (!result.reachable) {
        await probeConfig.onBlocked?.(ctx, result);
        block(ctx, {
          reason:
            probeConfig.reason?.(ctx, result) ??
            `站点不可达：${url}（HTTP ${String(result.status)}）`,
          message: probeConfig.message?.(ctx, result) ?? [
            '阻塞：站点不可达（本门禁需站点可访问）。',
            '提示：先起站点（如 pnpm --filter @dforge/web build && pnpm --filter @dforge/web start），',
            '或设置 DF_WEB_URL 指向已运行实例。',
          ],
          stop: probeConfig.stop !== false,
          skipUnits: probeConfig.skipUnitsOnBlock === true,
        });
      }
    }
    if (await stopIfPending()) return finishPending();

    if (!ctx.skipUnits) {
      await hooks.beforeBrowser?.(ctx);
      if (await stopIfPending()) return finishPending();

      if (spec.chrome !== undefined) {
        ctx.chrome = deps.resolveChrome();
        if (ctx.chrome === undefined) {
          await spec.chrome.onBlocked?.(ctx);
          block(ctx, {
            reason: spec.chrome.reason?.(ctx) ?? CHROME_REASON,
            message: spec.chrome.message?.(ctx) ?? CHROME_MESSAGE,
            stop: spec.chrome.stop !== false,
            skipUnits: spec.chrome.skipUnitsOnBlock === true,
          });
        }
      }
      if (await stopIfPending()) return finishPending();

      if (!ctx.skipUnits) {
        ctx.url = typeof spec.url === 'function' ? spec.url(ctx) : spec.url;
        await openBrowser(ctx);

        if (spec.mount !== undefined) {
          const selector = spec.mount.selector;
          if (spec.mount.wait !== false) {
            await ctx.page
              .waitForSelector(selector, {
                state: 'attached',
                timeout: spec.mount.timeout ?? 3000,
              })
              .catch(() => null);
          }
          const count = await ctx.page.locator(selector).count();
          if (count === 0) {
            await spec.mount.onBlocked?.(ctx);
            block(ctx, {
              reason: spec.mount.reason?.(ctx) ?? `页面未挂载对照面（找不到 ${selector}）`,
              message: spec.mount.message?.(ctx) ?? ['阻塞：宿主页未挂载对照面。'],
              stop: spec.mount.stop !== false,
              skipUnits: spec.mount.skipUnitsOnBlock === true,
            });
          }
        }
        if (await stopIfPending()) return finishPending();

        if (!ctx.skipUnits) {
          await hooks.afterMount?.(ctx);
          if (await stopIfPending()) return finishPending();

          if (referenceEnabled && referenceConfig.when === 'late') {
            const reference = ctx.reference ?? inspectReferenceDir(spec.referenceDir);
            ctx.reference = reference;
            if (!reference.ready) {
              await referenceConfig.onBlocked?.(ctx, reference);
              block(ctx, {
                reason: referenceConfig.reason?.(ctx, reference) ?? reference.reason,
                message:
                  referenceConfig.message?.(ctx, reference) ?? defaultReferenceMessage(reference),
                stop: referenceConfig.stop !== false,
                skipUnits: referenceConfig.skipUnitsOnBlock === true,
              });
            }
          }
          if (await stopIfPending()) return finishPending();

          if (!ctx.skipUnits) {
            await hooks.beforeUnits?.(ctx);
            if (await stopIfPending()) return finishPending();
            await runUnits(ctx);
            // 需要页面仍打开的门禁后置断言（如 inspector 的提交时序探针）。
            if (ctx.pendingFinish === null) await hooks.afterUnitsWithPage?.(ctx);
            if (await stopIfPending()) return finishPending();
          }
        }
        await closeBrowser(ctx);
      }
    }

    await hooks.afterUnits?.(ctx);
    if (await stopIfPending()) return finishPending();
    await hooks.finalize?.(ctx);
  } catch (error) {
    await closeBrowser(ctx);
    if (spec.catchErrors !== true) throw error;
    ctx.blockedReasons.push(`阻塞：门禁执行失败（${String(error).slice(0, 200)}）`);
    ctx.log(`阻塞：门禁执行失败 —— ${String(error)}`);
  }

  const code = gateExitCode(ctx);
  const messages = spec.messages ?? {};
  let message;
  if (code === GATE_EXIT.BLOCKED) {
    message =
      ctx.blockedReasons.length > 0
        ? (messages.blocked?.(ctx) ?? `阻塞：${ctx.blockedReasons.join('；')}（exit 2 ≠ 通过）。`)
        : (messages.pending?.(ctx) ??
          `阻塞：${String(ctx.pending)} 个单元的状态在宿主页上取不到（记录为 pending，不计通过）。`);
  } else if (code === GATE_EXIT.VIOLATION) {
    message =
      messages.fail?.(ctx) ??
      `违规：${String(ctx.failures)} 个单元超差或参照图缺失（逐单元明细见证据 JSON）。`;
  } else {
    message =
      messages.pass?.(ctx) ??
      `通过：${String(ctx.targets.length)} 个单元全部在容差内（≤ ${(
        spec.thresholds.maxRatio * 100
      ).toFixed(2)}%）。`;
  }
  return finalize(code, message);
}
