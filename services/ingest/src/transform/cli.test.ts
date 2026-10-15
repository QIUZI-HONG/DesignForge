/**
 * CLI 行为测试（退出码语义 0/1/2，规格《市场首实现》§6.1）。
 *
 * 断言外部行为：命令跑通返回 0；输入缺失返回 2（阻塞）；校验不过返回 1（真失败）。
 */

import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runTransformCli } from './cli.ts';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'ods-source');

let workDir = '';
let source = '';
let odsRoot = '';
let dwdRoot = '';

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'mk02-cli-'));
  source = join(workDir, 'source');
  await cp(FIXTURE, source, { recursive: true });
  odsRoot = join(workDir, 'data', 'ods');
  dwdRoot = join(workDir, 'data', 'dwd');
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('runTransformCli', () => {
  it('ods → dwd → validate 全链路退出码 0，且摘要可给人看', async () => {
    const ods = await runTransformCli(['ods', '--source', source, '--out', odsRoot]);
    expect(ods.exitCode).toBe(0);
    expect(ods.summary).toMatchObject({ snapshots: 2, events: 1, blobs: 2 });

    const dwd = await runTransformCli(['dwd', '--ods', odsRoot, '--out', dwdRoot]);
    expect(dwd.exitCode).toBe(0);
    expect(dwd.summary.rows).toMatchObject({ repo: 2, asset: 1, asset_file: 1, license: 3 });

    const validate = await runTransformCli(['validate', '--ods', odsRoot, '--dwd', dwdRoot]);
    expect(validate.exitCode).toBe(0);
    expect(validate.problems).toEqual([]);
  });

  it('输入路径不存在 → 退出码 2（阻塞，不是失败）', async () => {
    const ods = await runTransformCli(['ods', '--source', join(workDir, 'nope'), '--out', odsRoot]);
    expect(ods.exitCode).toBe(2);
    expect(ods.summary.blocked).toBe(true);

    const dwd = await runTransformCli(['dwd', '--ods', join(workDir, 'nope'), '--out', dwdRoot]);
    expect(dwd.exitCode).toBe(2);
  });

  it('用法错误（缺参数）→ 退出码 1，且不静默成功', async () => {
    const outcome = await runTransformCli(['dwd', '--ods', odsRoot]);
    expect(outcome.exitCode).toBe(1);
    expect(outcome.problems[0]?.rule).toBe('usage');
  });

  it('校验不过（DWD 被篡改）→ 退出码 1（真失败）', async () => {
    await runTransformCli(['ods', '--source', source, '--out', odsRoot]);
    await runTransformCli(['dwd', '--ods', odsRoot, '--out', dwdRoot]);
    // 破坏 ODS 快照（改文件清单里的 gitSha）→ 重建后 digest/校验必须报出来
    const snapshotPath = join(
      odsRoot,
      'raw_snapshots',
      'acme__design-kit',
      'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
      'files.json',
    );
    await writeFile(snapshotPath, '{"schema":"df.market.ods.files/v1"}\n', 'utf8');
    const validate = await runTransformCli(['validate', '--ods', odsRoot, '--dwd', dwdRoot]);
    expect(validate.exitCode).toBe(1);
    expect(validate.problems.length).toBeGreaterThan(0);
  });

  it('rebuild 命令：删 DWD 重跑后一致 → 0；首次无对照 → 1（如实报「无对照」而非假绿）', async () => {
    await runTransformCli(['ods', '--source', source, '--out', odsRoot]);
    await runTransformCli(['dwd', '--ods', odsRoot, '--out', dwdRoot]);
    const first = await runTransformCli(['rebuild', '--data', join(workDir, 'data')]);
    expect(first.exitCode).toBe(0);
    expect(first.summary.consistent).toBe(true);

    await rm(dwdRoot, { recursive: true, force: true });
    const withoutBaseline = await runTransformCli(['rebuild', '--data', join(workDir, 'data')]);
    expect(withoutBaseline.exitCode).toBe(1);
    expect(withoutBaseline.summary.consistent).toBe(false);
  });
});
