import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

/** 仓库根（本测试位于 apps/desktop/src/guards/）。 */
const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const script = `${repoRoot}/scripts/verify-shell-parity.mjs`;
/** 壳内自检硬超时的真源：存活窗口必须**略超**它（下文的静态口径断言对着它）。 */
const runModeSourcePath = `${repoRoot}/apps/desktop/src/main/run-mode.ts`;

/**
 * 夹具目录（系统临时目录，用后即删）：假 Electron「二进制」= 可执行 sh 脚本，
 * 壳目录 = 含 `dist/main/main.js` 占位的空壳——两者都经 env 覆盖注入，
 * 故这些用例在「无 Electron 二进制、无显示器」的 CI 上同样可跑（不假设开发机环境）。
 */
const fixtureRoots: string[] = [];

afterAll(() => {
  for (const root of fixtureRoots) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeFixture(binaryBody: string): { binary: string; appDir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'dforge-shell-alive-'));
  fixtureRoots.push(dir);
  const binary = join(dir, 'fake-electron');
  writeFileSync(binary, binaryBody);
  chmodSync(binary, 0o755);
  const appDir = join(dir, 'app');
  mkdirSync(join(appDir, 'dist', 'main'), { recursive: true });
  writeFileSync(join(appDir, 'dist', 'main', 'main.js'), '// 夹具占位（假二进制不读它）\n');
  return { binary, appDir };
}

/** 夹具环境：`DISPLAY=:0` 让门禁的显示检查通过（假二进制不碰真 X），二进制与壳目录指向夹具。 */
function fixtureEnv(fixture: { binary: string; appDir: string }): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DISPLAY: ':0',
    WAYLAND_DISPLAY: '',
    DFORGE_ELECTRON_BINARY: fixture.binary,
    DFORGE_SHELL_APP_DIR: fixture.appDir,
  };
}

/** 跑门禁脚本（用 `process.execPath` 绝对路径，避免被用例自带的 PATH 覆盖影响）。 */
function run(
  args: string[],
  env?: NodeJS.ProcessEnv,
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    cwd: repoRoot,
    ...(env === undefined ? {} : { env }),
  });
  return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/** 取源码里的数字常量（口径一致性断言用；找不到即抛错，不静默当 0）。 */
function numericConstant(source: string, name: string): number {
  const match = new RegExp(`${name} = ([\\d_]+)`).exec(source);
  if (!match?.[1]) {
    throw new Error(`未在源码里找到常量 ${name}`);
  }
  return Number(match[1].replace(/_/g, ''));
}

/** 存活段报告的最小结构。 */
interface AliveStageReport {
  stage: string;
  exitCode: number;
  notes: string[];
  failures: string[];
  windowMs: number;
  observed?: { aliveMs: number; alive: boolean; exitCode: number | null };
}

function aliveStageOf(stdout: string): AliveStageReport {
  const report = JSON.parse(stdout) as { stages: AliveStageReport[] };
  const stage = report.stages[0];
  if (!stage) {
    throw new Error('证据 JSON 无 stages[0]');
  }
  return stage;
}

describe('verify-shell-parity：两段式退出码语义', () => {
  it('对照段无参照集 → exit 2 且明说「参照集未冻结」（禁自截图假绿）', () => {
    const { status, stdout } = run([
      `--stage=parity`,
      `--refs=${repoRoot}/apps/desktop/e2e/__no_refs__`,
      '--json',
    ]);

    expect(status).toBe(2);
    expect(stdout).toContain('参照集未冻结');
    // 证据 JSON 须带 exitCode 与人工复核待签字段（验收标准 §4）
    const report = JSON.parse(stdout) as {
      exitCode: number;
      stages: Array<{ exitCode: number; humanReview: { verdict: string; reviewer: null } }>;
    };
    expect(report.exitCode).toBe(2);
    expect(report.stages[0]?.exitCode).toBe(2);
    expect(report.stages[0]?.humanReview.verdict).toBe('pending');
    expect(report.stages[0]?.humanReview.reviewer).toBeNull();
  });

  it('非法 stage 参数 → exit 2 且报用法错误（不静默跑错段）', () => {
    const { status, stderr } = run(['--stage=__bogus__', '--json']);

    expect(status).toBe(2);
    expect(stderr).toContain('用法错误');
  });
});

describe('verify-shell-parity：交互存活段（D-8 回归）', () => {
  it('壳在存活窗口内自行退出 → exit 1（违规夹具：30 秒误杀/崩溃都会被抓住）', () => {
    const fixture = makeFixture(
      '#!/bin/sh\necho "壳自检超时（30000ms）：装载或渲染未完成" >&2\nexit 1\n',
    );
    const { status, stdout } = run(
      ['--stage=alive', '--alive-window=2000', '--json'],
      fixtureEnv(fixture),
    );

    expect(status).toBe(1);
    const stage = aliveStageOf(stdout);
    expect(stage.stage).toBe('shell-alive');
    expect(stage.exitCode).toBe(1);
    expect(stage.observed?.alive).toBe(false);
    expect(stage.failures.join('\n')).toContain('在存活窗口');
    expect(stage.failures.join('\n')).toContain('exit=1');
  });

  it('壳过窗口仍存活 → exit 0（存活夹具；门禁须回收进程组后返回）', () => {
    const fixture = makeFixture('#!/bin/sh\nsleep 30\n');
    const { status, stdout } = run(
      ['--stage=alive', '--alive-window=1500', '--json'],
      fixtureEnv(fixture),
    );

    expect(status).toBe(0);
    const stage = aliveStageOf(stdout);
    expect(stage.exitCode).toBe(0);
    expect(stage.failures).toEqual([]);
    expect(stage.observed?.alive).toBe(true);
    expect(stage.notes.join('\n')).toContain('仍存活');
  });

  it('Electron 二进制缺失 → exit 2 阻塞（CI 属此列，不得出红）', () => {
    const fixture = makeFixture('#!/bin/sh\nexit 0\n');
    const { status, stdout } = run(['--stage=alive', '--json'], {
      ...fixtureEnv(fixture),
      DFORGE_ELECTRON_BINARY: join(fixture.appDir, '__missing__', 'electron'),
    });

    expect(status).toBe(2);
    expect(aliveStageOf(stdout).notes.join('\n')).toContain('Electron 二进制缺失');
  });

  it('壳未构建 → exit 2 阻塞（未构建不是「壳坏」）', () => {
    const fixture = makeFixture('#!/bin/sh\nexit 0\n');
    const { status, stdout } = run(['--stage=alive', '--json'], {
      ...fixtureEnv(fixture),
      DFORGE_SHELL_APP_DIR: join(fixture.appDir, '__not_built__'),
    });

    expect(status).toBe(2);
    expect(aliveStageOf(stdout).notes.join('\n')).toContain('壳未构建');
  });

  it('无显示环境且无 xvfb-run → exit 2 阻塞（不假绿、不出红）', () => {
    const fixture = makeFixture('#!/bin/sh\nexit 0\n');
    // PATH 指向不存在的目录：`command -v xvfb-run` 必然落空，模拟「无显示又无 Xvfb」的 CI 环境。
    const { status, stdout } = run(['--stage=alive', '--json'], {
      ...fixtureEnv(fixture),
      DISPLAY: '',
      WAYLAND_DISPLAY: '',
      PATH: '/nonexistent-bin',
    });

    expect(status).toBe(2);
    expect(aliveStageOf(stdout).notes.join('\n')).toContain('无显示环境');
  });

  it('存活窗口必须**略超**壳内自检硬超时，否则误杀会被窗口漏掉', () => {
    const aliveWindow = numericConstant(readFileSync(script, 'utf8'), 'ALIVE_WINDOW_MS');
    const selfCheckTimeout = numericConstant(
      readFileSync(runModeSourcePath, 'utf8'),
      'SELF_CHECK_TIMEOUT_MS',
    );

    expect(selfCheckTimeout).toBe(30_000);
    expect(aliveWindow).toBeGreaterThan(selfCheckTimeout);
  });
});
