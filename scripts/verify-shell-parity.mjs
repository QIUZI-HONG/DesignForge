#!/usr/bin/env node
/**
 * verify-shell-parity —— 桌面壳门禁（FE-12）。**两段式**，退出码语义各自独立：
 *
 * ① 启动冒烟段（`--stage=smoke`，默认与对照段同跑）：
 *    在真实 Electron 里装载目标页（dev URL / 内置静态服务 / 壳内诊断页），实测安全五项、窗口尺寸、
 *    DPR 与页面事实，并与 `guard-electron-baseline.mjs` 的静态基线**交叉核对**。
 *    退出码：**0 = 通过 / 1 = 壳有缺陷（装载失败或基线与静态声明不符）/ 2 = 阻塞**（无 Electron 二进制、
 *    未构建、无显示环境且无 xvfb-run——阻塞即「本机判不了」，禁当作通过）。
 *
 * ② 一致性对照段（`--stage=parity`）：同一 web 产物的**浏览器侧冻结参照**与壳内现产截图，同容差比对
 *    （验收标准 §3 壳内条款）。退出码：**0 = 在容差内 / 1 = 超容差 / 2 = 阻塞**。
 *    参照集未冻结时脚本**必须 exit 2 并打印「阻塞：参照集未冻结」**——禁止拿自截图/近似图假绿。
 *
 * 参照集契约（REF-01 冻结时按此落盘；与 FE-01 的 `verify-figma-component` 同一根目录与口径）：
 *   `<DF_REF_DIR>/shell/<page>.png` + 同名 `<page>.meta.json`（版本/日期/sha256/url/viewport）。
 *   参照图为**冻结的浏览器侧** 1440×900 @DPR1.5 截图；壳内截图由本脚本用 `--df-capture` 现产。
 * 对照参数：pixelmatch threshold 0.1、差异像素率 ≤ `--max-ratio`（默认 **0.001** = A 级 0.1%）。
 * 截图工具链：playwright-core（锁缓存 chromium-1243，可 `BENCH_CHROME_EXECUTABLE` 指定）+ pixelmatch + pngjs。
 * `--live-browser` 现采浏览器图作对照伙伴：**仅诊断/调参用**，不作为验收证据（验收只认冻结参照）。
 *
 * 环境变量：DF_REF_DIR（参照集根，默认 ~/df-evidence/reference-v1）、DF_EVIDENCE_DIR（证据根，默认
 *   ~/df-evidence）、DFORGE_PARITY_URL（`--live-browser` 的站点，默认 http://127.0.0.1:3000/）、
 *   BENCH_CHROME_EXECUTABLE。
 * 证据：`<DF_EVIDENCE_DIR>/fe-12/shell-parity-<时间戳>/`：evidence.json（字段依验收标准 §4）+ 壳自检 JSON + PNG。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHELL_DIR = join(REPO_ROOT, 'apps', 'desktop');
const ELECTRON_BINARY = join(SHELL_DIR, 'node_modules', 'electron', 'dist', 'electron');
const BUILT_MAIN = join(SHELL_DIR, 'dist', 'main', 'main.js');
const GUARD = join(REPO_ROOT, 'scripts', 'guard-electron-baseline.mjs');
const REF_DIR = resolve(process.env.DF_REF_DIR ?? join(homedir(), 'df-evidence', 'reference-v1'));
const EVIDENCE_ROOT = resolve(process.env.DF_EVIDENCE_DIR ?? join(homedir(), 'df-evidence'));

/** 验收标准 §3 基准视口：1440×900 CSS @ DPR 1.5（两侧同 DPR，禁 1× 降采样）。 */
const VIEWPORT = { width: 1440, height: 900, dpr: 1.5 };
/** 像素容差：pixelmatch threshold 0.1 + A 级差异像素率 0.1%（与 FE-01 的组件门禁同口径）。 */
const TOLERANCE = { maxDiffRatio: 0.001, perPixelThreshold: 0.1 };
/** 冒烟段超时：与壳内自检硬超时（30s）留出余量。 */
const SMOKE_TIMEOUT_MS = 90_000;

const REFS_BLOCKED = '阻塞：参照集未冻结（REF-01 未完成）——不得以自截图/近似图假绿';
const TOOLCHAIN_BLOCKED =
  '阻塞：截图工具链不可用（playwright-core / pixelmatch / pngjs 或 Chromium 缺失）';

/** 退出码常量。 */
const PASS = 0;
const FAIL = 1;
const BLOCKED = 2;

function readArg(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit?.slice(prefix.length);
}

const stageArg = readArg('stage') ?? 'both';
const VALID_STAGES = ['smoke', 'parity', 'both'];
if (!VALID_STAGES.includes(stageArg)) {
  process.stderr.write(
    `用法错误：--stage=${stageArg} 不在 ${VALID_STAGES.join('|')} 之内（不给默认值，避免静默跑错段）\n`,
  );
  process.exit(BLOCKED);
}
const runSmokeStage = stageArg === 'smoke' || stageArg === 'both';
const runParityStage = stageArg === 'parity' || stageArg === 'both';
const refsDir = resolve(readArg('refs') ?? REF_DIR);
const pageName = readArg('page') ?? 'home';
const liveBrowser = process.argv.includes('--live-browser');
const maxRatio = Number(readArg('max-ratio') ?? TOLERANCE.maxDiffRatio);
const jsonMode = process.argv.includes('--json');

/** 证据目录（时间戳隔离，互不覆盖；与 fe-01/inf-01 等票同一证据根）。 */
const runDir = join(
  EVIDENCE_ROOT,
  'fe-12',
  `shell-parity-${new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace(/-\d{3}Z$/, 'Z')}`,
);
mkdirSync(runDir, { recursive: true });

/** 文件摘要（证据字段 `artifacts.*.sha256/length`）。 */
function digest(path) {
  const bytes = readFileSync(path);
  return { sha256: createHash('sha256').update(bytes).digest('hex'), length: bytes.length };
}

/** 有显示环境吗；没有则看能否用 xvfb-run 兜底。 */
function resolveDisplayWrapper() {
  if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) {
    return {
      wrapper: null,
      note: `DISPLAY=${process.env.DISPLAY ?? ''}${process.env.WAYLAND_DISPLAY ?? ''}`,
    };
  }
  const xvfb = spawnSync('sh', ['-c', 'command -v xvfb-run'], { encoding: 'utf8' });
  if (xvfb.status === 0 && xvfb.stdout.trim() !== '') {
    return { wrapper: xvfb.stdout.trim(), note: 'xvfb-run（无显示环境）' };
  }
  return { wrapper: null, note: null };
}

/** 跑一次守卫，取静态基线与违规（守卫自带 0/1/2 语义，这里只要 JSON）。 */
function runGuard() {
  const result = spawnSync('node', [GUARD, '--json'], { encoding: 'utf8', cwd: REPO_ROOT });
  try {
    return { report: JSON.parse(result.stdout.trim()) };
  } catch {
    return {
      error: `守卫未产出 JSON（exit=${String(result.status)}）：${(result.stderr ?? '').trim()}`,
    };
  }
}

/** 启动冒烟段：跑壳 → 读自检 JSON → 与静态基线交叉核对。 */
function runSmoke() {
  const artifacts = {};
  const result = {
    stage: 'shell-smoke',
    level: 'A',
    exitCode: BLOCKED,
    artifacts,
    notes: [],
    failures: [],
    humanReview: { verdict: 'pending', reviewer: null, reason: '人工复核属验收会话，脚本不代签' },
  };

  if (!existsSync(ELECTRON_BINARY)) {
    result.notes.push(
      `Electron 二进制缺失：${ELECTRON_BINARY}（pnpm --filter @dforge/desktop fetch-electron）`,
    );
    return result;
  }
  if (!existsSync(BUILT_MAIN)) {
    result.notes.push(`壳未构建：${BUILT_MAIN}（pnpm --filter @dforge/desktop build）`);
    return result;
  }

  const display = resolveDisplayWrapper();
  if (!display.note) {
    result.notes.push('无显示环境且未找到 xvfb-run：本机无法启动壳（如实报阻塞，不假绿）');
    return result;
  }
  result.notes.push(`显示：${display.note}`);

  const selfCheckPath = join(runDir, 'shell-selfcheck.json');
  const shellPng = join(runDir, 'shell.png');
  const electronArgs = [
    SHELL_DIR,
    `--df-shell-smoke=${selfCheckPath}`,
    `--df-capture=${shellPng}`,
    `--df-dpr=${VIEWPORT.dpr}`,
  ];
  const command = display.wrapper ? display.wrapper : ELECTRON_BINARY;
  const commandArgs = display.wrapper ? [ELECTRON_BINARY, ...electronArgs] : electronArgs;

  const run = spawnSync(command, commandArgs, {
    encoding: 'utf8',
    timeout: SMOKE_TIMEOUT_MS,
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  });

  const marker = (run.stdout ?? '')
    .split('\n')
    .find((line) => line.startsWith('DFORGE_SHELL_SELFCHECK:'));
  let selfCheck;
  if (existsSync(selfCheckPath)) {
    selfCheck = JSON.parse(readFileSync(selfCheckPath, 'utf8'));
    artifacts.selfCheck = { path: selfCheckPath, ...digest(selfCheckPath) };
  }
  if (existsSync(shellPng)) {
    artifacts.shellCapture = { path: shellPng, ...digest(shellPng) };
  }
  if (!selfCheck) {
    result.notes.push(
      `壳未产出自检 JSON（exit=${String(run.status)}）：${(run.stderr ?? '').trim().split('\n').slice(-3).join(' | ')}`,
    );
    return result;
  }

  result.target = selfCheck.target;
  result.window = selfCheck.window;
  result.security = selfCheck.security;
  result.marker = marker ?? null;

  // 判据一：壳自检（装载完成 / 有内容 / 同源 / 实测不符项）
  result.failures.push(...(selfCheck.failures ?? []));

  // 判据二：运行时实测 vs 守卫静态声明（逐键交叉核对）
  const guard = runGuard();
  if (guard.error) {
    result.notes.push(guard.error);
  } else {
    result.staticBaseline = guard.report.found ?? {};
    for (const [key, expected] of Object.entries(guard.report.found ?? {})) {
      const actual = selfCheck.security?.[key];
      if (actual === null || actual === undefined) {
        result.notes.push(
          `运行时未测得 ${key}（静态声明 ${String(expected)}；该键由静态守卫负责）`,
        );
      } else if (actual !== expected) {
        result.failures.push(
          `运行时实测 ${key}=${String(actual)}，与静态声明 ${String(expected)} 不符`,
        );
      }
    }
    if ((guard.report.violations ?? []).length > 0) {
      result.notes.push(`守卫报违规：${guard.report.violations.join('；')}`);
    }
  }

  if (result.target?.kind === 'fallback') {
    result.notes.push(
      '装载落点是壳内诊断页（web 产物缺失）：壳本身通过，但不构成「壳内跑真实产物」的证据',
    );
  }

  result.exitCode = result.failures.length > 0 ? FAIL : PASS;
  return result;
}

/** 找 Chromium 可执行文件（FE-01 同口径：`BENCH_CHROME_EXECUTABLE` 优先，其次探测 playwright 缓存）。 */
function resolveChromium() {
  if (process.env.BENCH_CHROME_EXECUTABLE !== undefined) {
    return existsSync(process.env.BENCH_CHROME_EXECUTABLE)
      ? process.env.BENCH_CHROME_EXECUTABLE
      : undefined;
  }
  const cacheRoot = join(homedir(), '.cache', 'ms-playwright');
  if (!existsSync(cacheRoot)) {
    return undefined;
  }
  const candidates = readdirSync(cacheRoot)
    .filter((name) => name.startsWith('chromium-'))
    .sort()
    .map((name) => join(cacheRoot, name, 'chrome-linux64', 'chrome'));
  return candidates.find((file) => existsSync(file));
}

/** 浏览器侧采集（`--live-browser` 诊断模式；验收只认冻结参照）。 */
async function captureBrowser(url, outPath) {
  const playwright = await import('playwright-core');
  const executablePath = resolveChromium();
  // `DFORGE_PARITY_HEADED=1`：在真实显示上采集（与壳内同为「有显示」的 AA 口径）。
  // 默认无头（研究 #5 工具链口径）；两者差异是字形抗锯齿口径问题，属诊断信息，不作验收证据。
  const headed = process.env.DFORGE_PARITY_HEADED === '1';
  const browser = await playwright.chromium.launch({
    headless: !headed,
    ...(executablePath === undefined ? {} : { executablePath }),
  });
  try {
    const context = await browser.newContext({
      viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
      deviceScaleFactor: VIEWPORT.dpr,
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.screenshot({ path: outPath });
  } finally {
    await browser.close();
  }
}

/** 取壳内截图（复用壳自检的 `--df-capture`，与冒烟段同一产物、同一 DPR 口径）。 */
function captureShell(outPng, selfCheckOut) {
  const run = spawnSync(
    ELECTRON_BINARY,
    [
      SHELL_DIR,
      `--df-shell-smoke=${selfCheckOut}`,
      `--df-capture=${outPng}`,
      `--df-dpr=${VIEWPORT.dpr}`,
    ],
    { encoding: 'utf8', timeout: SMOKE_TIMEOUT_MS },
  );
  return { produced: existsSync(outPng), status: run.status, stderr: run.stderr ?? '' };
}

/**
 * 一致性对照段（验收标准 §3 壳内条款）：**冻结的浏览器侧参照** vs 壳内现产截图，同容差比对。
 *
 * 参照集缺失 → 阻塞（2）并落盘证据说明待办；`--live-browser` 时以现采浏览器图作对照伙伴（仅诊断）。
 */
async function runParity() {
  const result = {
    stage: 'shell-parity',
    level: 'A',
    exitCode: BLOCKED,
    page: pageName,
    viewport: VIEWPORT,
    tolerance: { ...TOLERANCE, maxDiffRatio: maxRatio, engine: 'pixelmatch@8.0.0' },
    artifacts: {},
    notes: [],
    failures: [],
    diff: null,
    humanReview: { verdict: 'pending', reviewer: null, reason: '逐页差异双签属验收会话' },
  };

  const refPng = join(refsDir, 'shell', `${pageName}.png`);
  const refMeta = join(refsDir, 'shell', `${pageName}.meta.json`);
  const frozen = existsSync(refPng) && existsSync(refMeta);
  if (!frozen && !liveBrowser) {
    result.notes.push(`${REFS_BLOCKED}（预期冻结参照：${refPng} + ${refMeta}；页名 ${pageName}）`);
    return result;
  }

  let PNG;
  let pixelmatch;
  try {
    ({ PNG } = await import('pngjs'));
    pixelmatch = (await import('pixelmatch')).default;
  } catch {
    result.notes.push(TOOLCHAIN_BLOCKED);
    return result;
  }

  // 壳内截图：先产；未产出即阻塞（壳侧不可用，判不了）
  const shellPng = join(runDir, 'shell.png');
  const shellRun = captureShell(shellPng, join(runDir, 'shell-selfcheck.json'));
  if (!shellRun.produced) {
    result.notes.push(
      `壳内截图未产出（exit=${String(shellRun.status)}）：${shellRun.stderr.trim().split('\n').slice(-2).join(' | ')}`,
    );
    return result;
  }
  result.artifacts.shellCapture = { path: shellPng, ...digest(shellPng) };

  let partnerPng = refPng;
  if (!frozen && liveBrowser) {
    const url = process.env.DFORGE_PARITY_URL ?? 'http://127.0.0.1:3000/';
    if (!resolveChromium()) {
      result.notes.push(`${TOOLCHAIN_BLOCKED}（未找到 Chromium 可执行文件）`);
      return result;
    }
    try {
      partnerPng = join(runDir, 'browser-live.png');
      await captureBrowser(url, partnerPng);
      result.notes.push(
        `诊断模式：以现采浏览器图（${url}）作对照伙伴——**不作验收证据**，验收只认冻结参照`,
      );
    } catch (error) {
      result.notes.push(`浏览器侧采集失败：${String(error)}`);
      return result;
    }
  }
  result.artifacts.ref = { path: partnerPng, ...digest(partnerPng) };

  const shellImage = PNG.sync.read(readFileSync(shellPng));
  const refImage = PNG.sync.read(readFileSync(partnerPng));
  if (shellImage.width !== refImage.width || shellImage.height !== refImage.height) {
    result.failures.push(
      `两侧尺寸不一致（壳 ${shellImage.width}×${shellImage.height} vs 参照 ${refImage.width}×${refImage.height}）——同口径前提不成立`,
    );
    result.exitCode = FAIL;
    return result;
  }

  const diffPng = join(runDir, 'diff.png');
  const diff = new PNG({ width: shellImage.width, height: shellImage.height });
  const diffPixels = pixelmatch(
    shellImage.data,
    refImage.data,
    diff.data,
    shellImage.width,
    shellImage.height,
    {
      threshold: TOLERANCE.perPixelThreshold,
    },
  );
  if (diffPixels > 0) {
    writeFileSync(diffPng, PNG.sync.write(diff));
    result.artifacts.diff = { path: diffPng, ...digest(diffPng) };
  }
  const bbox =
    diffPixels > 0 ? boundingBoxOfDiff(diff.data, shellImage.width, shellImage.height) : null;
  result.diff = { bbox, diffPixels, ratio: diffPixels / (shellImage.width * shellImage.height) };
  result.exitCode = result.diff.ratio <= maxRatio ? PASS : FAIL;
  return result;
}

/** 差异像素包围盒（验收标准 §4 的证据字段 `diff.bbox`）。 */
function boundingBoxOfDiff(rgba, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = rgba[(y * width + x) * 4 + 3];
      if (alpha !== 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** 主流程：先冒烟，再对照；合并退出码取「先失败者」，两段皆过才是 0。 */
async function main() {
  const report = {
    schema: 'dforge.shell-gate/1',
    ranAt: new Date().toISOString(),
    viewport: VIEWPORT,
    stages: [],
    exitCode: PASS,
  };

  if (runSmokeStage) {
    const smoke = runSmoke();
    report.stages.push(smoke);
    report.exitCode = smoke.exitCode;
  }
  if (runParityStage) {
    const parity = await runParity();
    report.stages.push(parity);
    if (report.exitCode === PASS) {
      report.exitCode = parity.exitCode;
    }
  }

  const evidencePath = join(runDir, 'evidence.json');
  writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`);

  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const lines = [`verify-shell-parity：证据 ${evidencePath}`];
    for (const stage of report.stages) {
      lines.push(`  [${stage.stage}] exit=${stage.exitCode}`);
      for (const note of stage.notes) {
        lines.push(`    · ${note}`);
      }
      for (const failure of stage.failures) {
        lines.push(`    ✗ ${failure}`);
      }
      if (stage.diff) {
        lines.push(`    差异：${stage.diff.diffPixels}px / ratio=${stage.diff.ratio.toFixed(6)}`);
      }
    }
    lines.push(`  总退出码 ${report.exitCode}（0 通过 / 1 失败 / 2 阻塞）`);
    process.stderr.write(`${lines.join('\n')}\n`);
  }

  process.exit(report.exitCode);
}

await main();
