import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/** 仓库根（本测试位于 apps/desktop/src/guards/）。 */
const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const script = `${repoRoot}/scripts/verify-shell-parity.mjs`;

/** 跑门禁脚本（只测不需要 Electron 的判据路径，保持单测快而稳）。 */
function run(args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('node', [script, ...args], { encoding: 'utf8', cwd: repoRoot });
  return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
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
