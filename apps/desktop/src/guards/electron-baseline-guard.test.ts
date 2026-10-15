import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/** 仓库根（本测试位于 apps/desktop/src/guards/）。 */
const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const guard = `${repoRoot}/scripts/guard-electron-baseline.mjs`;
const fixture = (name: string) => `${repoRoot}/apps/desktop/test/fixtures/${name}`;

/** 跑守卫（fixture 运行会自动禁用运行时探针，故可在无 Electron 的环境下判 0/1/2）。 */
function runGuard(args: string[]): { status: number; report: Record<string, unknown> } {
  const result = spawnSync('node', [guard, '--json', ...args], { encoding: 'utf8', cwd: repoRoot });
  const stdout = result.stdout?.trim() ?? '';
  expect(stdout, `守卫未输出 JSON（stderr: ${result.stderr}）`).not.toBe('');
  return { status: result.status ?? -1, report: JSON.parse(stdout) as Record<string, unknown> };
}

describe('guard-electron-baseline：真实壳配置', () => {
  it('仓库内真实配置五项静态判定通过（exit 0，无违规无未判定）', () => {
    const { status, report } = runGuard([]);

    expect(report.violations).toEqual([]);
    expect(report.undetermined).toEqual([]);
    expect(status).toBe(0);
  });
});

describe('guard-electron-baseline：正反例 fixture', () => {
  it('正例 fixture → exit 0（检查器不恒判失败）', () => {
    expect(runGuard([`--source=${fixture('window-options.ok.ts')}`]).status).toBe(0);
  });

  it.each([
    ['window-options.broken-sandbox.ts', 'SECURITY_BASELINE.sandbox'],
    ['window-options.broken-nodeintegration.ts', 'SECURITY_BASELINE.nodeIntegration'],
    ['window-options.broken-override.ts', '之后**又覆盖了 webSecurity'],
  ])('反例 fixture %s → exit 1 且点名', (name, needle) => {
    const { status, report } = runGuard([`--source=${fixture(name)}`]);

    expect(status).toBe(1);
    expect((report.violations as string[]).join('\n')).toContain(needle);
  });

  it('基线缺项 fixture → exit 2（静态判不出，fixture 下禁用探针，禁当作通过）', () => {
    const { status, report } = runGuard([`--source=${fixture('window-options.missing-key.ts')}`]);

    expect(status).toBe(2);
    expect((report.undetermined as string[]).join('\n')).toContain('webSecurity');
  });

  it('源文件不存在 → exit 2（阻塞，不是通过）', () => {
    const { status, report } = runGuard([`--source=${fixture('does-not-exist.ts')}`]);

    expect(status).toBe(2);
    expect((report.undetermined as string[]).join('\n')).toContain('读取不到');
  });
});
