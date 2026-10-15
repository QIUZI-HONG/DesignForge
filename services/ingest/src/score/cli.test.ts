/**
 * 评分 CLI 单测（MK-03）。
 *
 * 断言口径：规格 §6.1 退出码语义（0/1/2，禁止假绿）、§4.3.2 确定性（asOf 注入）、
 * §6.2 证据 JSON 结构。CLI 是 MK-05 判据链的挂点，参数与退出码都要被测试钉住。
 */

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AS_OF } from './__fixtures__/dwd.ts';
import { SAMPLE_DWD } from './__fixtures__/dwd-samples.ts';
import { scoreBatch } from './batch.ts';
import { CliUsageError, evaluate, main, parseArgs, parseDwdJsonl, runIdOf } from './cli.ts';
import { dwsJsonl } from './dws.ts';

/** 新建临时目录。 */
function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'mk03-cli-'));
}

describe('parseArgs / runIdOf', () => {
  it('--sample 缺省输出目录 = ~/df-evidence/mk-03', () => {
    const opts = parseArgs(['--sample']);
    expect(opts.sample).toBe(true);
    expect(opts.outDir.endsWith(join('df-evidence', 'mk-03'))).toBe(true);
  });

  it('--dwd/--as-of/--out/--run-id 解析', () => {
    const opts = parseArgs([
      '--dwd',
      '/tmp/x.jsonl',
      '--as-of',
      AS_OF,
      '--out',
      '/tmp/out',
      '--run-id',
      'r1',
    ]);
    expect(opts.dwdPath).toBe('/tmp/x.jsonl');
    expect(opts.asOf).toBe(AS_OF);
    expect(opts.outDir).toBe('/tmp/out');
    expect(opts.runId).toBe('r1');
  });

  it('参数错误抛 CliUsageError（未知选项 / 缺值 / 互斥）', () => {
    expect(() => parseArgs(['--nope'])).toThrow(CliUsageError);
    expect(() => parseArgs(['--dwd'])).toThrow(CliUsageError);
    expect(() => parseArgs(['--sample', '--dwd', 'x'])).toThrow(CliUsageError);
  });

  it('runId 由 asOf 生成（确定性）', () => {
    expect(runIdOf('2026-10-15T00:00:00Z')).toBe('score-20261015');
  });
});

describe('parseDwdJsonl', () => {
  it('逐行解析、跳过空行', () => {
    const parsed = parseDwdJsonl('{"a":1}\n\n{"a":2}\n');
    expect(parsed).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('非 JSON 行 → DwdShapeError（附行号）', () => {
    expect(() => parseDwdJsonl('{"a":1}\n坏行')).toThrow(/第 2 行/);
  });
});

describe('evaluate：判据步骤', () => {
  it('六步齐备、全部 pass（样本集）', () => {
    const { records, steps } = evaluate(SAMPLE_DWD, AS_OF);
    expect(records).toHaveLength(SAMPLE_DWD.length);
    expect(steps.map((s) => s.id)).toEqual([
      'dwd-input',
      'dws-scoring',
      'explain-completeness',
      'boundaries',
      'determinism',
    ]);
    for (const step of steps) {
      expect(step.verdict).toBe('pass');
      expect(
        step.assertions.every((a) => a.ok),
        `${step.id} 断言全过`,
      ).toBe(true);
    }
    const determinism = steps.find((s) => s.id === 'determinism')?.metrics.sha256;
    expect(typeof determinism).toBe('string');
  });
});

describe('main：退出码与产物（规格 §6.1 / §6.2）', () => {
  it('--sample：exit 0，落 DWS JSONL（与内存逐字节一致）与证据 JSON（六步）', () => {
    const dir = tempDir();
    const code = main(['--sample', '--out', dir]);
    expect(code).toBe(0);

    const dwsPath = join(dir, 'dws', 'asset_quality.jsonl');
    const evidencePath = join(dir, 'evidence', 'score-20261015.json');
    expect(existsSync(dwsPath)).toBe(true);
    expect(existsSync(evidencePath)).toBe(true);

    const expected = `${dwsJsonl(scoreBatch(SAMPLE_DWD, { asOf: AS_OF }).records)}\n`;
    expect(readFileSync(dwsPath, 'utf8')).toBe(expected);

    const evidence = JSON.parse(readFileSync(evidencePath, 'utf8')) as {
      schema: string;
      exitCode: number;
      steps: { id: string; verdict: string }[];
    };
    expect(evidence.schema).toBe('df.market.evidence/v1');
    expect(evidence.exitCode).toBe(0);
    expect(evidence.steps.map((s) => s.id)).toEqual([
      'dwd-input',
      'dws-scoring',
      'explain-completeness',
      'boundaries',
      'determinism',
      'dws-output',
    ]);
  });

  it('--dwd 真产物路径：exit 0，结果与内置样本一致（同输入同输出）', () => {
    const dir = tempDir();
    const dwdPath = join(dir, 'dwd.jsonl');
    writeFileSync(dwdPath, `${SAMPLE_DWD.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');
    const code = main(['--dwd', dwdPath, '--as-of', AS_OF, '--out', dir]);
    expect(code).toBe(0);
    const expected = `${dwsJsonl(scoreBatch(SAMPLE_DWD, { asOf: AS_OF }).records)}\n`;
    expect(readFileSync(join(dir, 'dws', 'asset_quality.jsonl'), 'utf8')).toBe(expected);
  });

  it('--dwd 不合契约：exit 2（阻塞，不假绿）', () => {
    const dir = tempDir();
    const dwdPath = join(dir, 'bad.jsonl');
    writeFileSync(dwdPath, '{"asset":{"id":"x"}}\n', 'utf8');
    expect(main(['--dwd', dwdPath, '--as-of', AS_OF, '--out', dir])).toBe(2);
    expect(existsSync(join(dir, 'dws', 'asset_quality.jsonl'))).toBe(false);
  });

  it('--dwd 缺 --as-of：exit 2（确定性纪律）', () => {
    const dir = tempDir();
    const dwdPath = join(dir, 'dwd.jsonl');
    writeFileSync(dwdPath, `${JSON.stringify(SAMPLE_DWD[0])}\n`, 'utf8');
    expect(main(['--dwd', dwdPath, '--out', dir])).toBe(2);
  });

  it('未指定输入 / 未知参数 / --help 的退出码', () => {
    const dir = tempDir();
    expect(main(['--out', dir])).toBe(2);
    expect(main(['--bogus'])).toBe(2);
    expect(main(['--help'])).toBe(0);
  });
});
