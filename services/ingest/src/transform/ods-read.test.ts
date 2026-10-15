/**
 * ODS 读取测试（规格 §4.1 形态 = DWD 的唯一输入；MK-01 形状为规整输入）。
 *
 * 断言外部行为：读取的数量与关联、来源清单哈希、坏行不静默、缺层明确报错（不假绿）。
 */

import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { materializeOds } from './ods/materialize.ts';
import { OdsMissingError, readBlobText, readOds, readOdsSource } from './ods/read.ts';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'ods-source');
const SKILL_SHA256 = 'sha256:084d0f096a25d9b47f48b32fb2ed74e63e87c9ca135736852c83a7c42fa59aac';

let workDir = '';

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'mk02-read-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

/** 把源夹具整份拷入临时目录（避免测试改动入库夹具）。 */
async function copySource(): Promise<string> {
  const source = join(workDir, 'source');
  await cp(FIXTURE, source, { recursive: true });
  return source;
}

describe('readOdsSource（MK-01 形状：ods/*.jsonl + replay/ 录制）', () => {
  it('读出 2 仓记录与 4 条事件，零校验问题', async () => {
    const source = await copySource();
    const bundle = await readOdsSource(source);
    expect(bundle.records.map((record) => record.repo.fullName)).toEqual([
      'acme/design-kit',
      'awesome/list-repo',
    ]);
    expect(bundle.events).toHaveLength(4);
    expect(bundle.issues).toEqual([]);
  });

  it('来源清单带文件 sha256 与行数（溯源链第一环）', async () => {
    const source = await copySource();
    const bundle = await readOdsSource(source);
    const snapshotSource = bundle.sources.find((entry) => entry.kind === 'raw_snapshots');
    const eventsSource = bundle.sources.find((entry) => entry.kind === 'raw_events');
    expect(snapshotSource?.lineCount).toBe(2);
    expect(eventsSource?.lineCount).toBe(4);
    const bytes = await readFile(snapshotSource?.path ?? '', 'utf8');
    const expected = createHash('sha256').update(bytes, 'utf8').digest('hex');
    expect(snapshotSource?.sha256).toBe(`sha256:${expected}`);
  });

  it('坏行必须报出问题而不是静默跳过', async () => {
    const source = await copySource();
    const path = join(source, 'ods', 'raw_events', 'date=2026-10-15', '20261015-120000.jsonl');
    const original = await readFile(path, 'utf8');
    await writeFile(path, `${original}{"broken":true}\n`, 'utf8');
    const bundle = await readOdsSource(source);
    expect(bundle.issues.length).toBeGreaterThan(0);
    expect(bundle.issues.some((issue) => issue.path.includes('raw_events'))).toBe(true);
  });

  it('缺 ODS 目录 → OdsMissingError（阻塞语义，不返回空集冒充成功）', async () => {
    await expect(readOdsSource(join(workDir, 'nope'))).rejects.toBeInstanceOf(OdsMissingError);
  });
});

describe('materializeOds + readOds（规格形状：gzip 事件 / files.json / blobs）', () => {
  it('规整后事件逐字节保真（gzip 无损，来源哈希可比对）', async () => {
    const source = await copySource();
    const out = join(workDir, 'ods');
    const result = await materializeOds({ source, out });
    const gunzipped = await readFile(
      join(out, 'raw_events', 'date=2026-10-15', '20261015-120000.jsonl.gz'),
    );
    const { gunzipSync } = await import('node:zlib');
    const text = gunzipSync(gunzipped).toString('utf8');
    const bytes = await readFile(
      join(source, 'ods', 'raw_events', 'date=2026-10-15', '20261015-120000.jsonl'),
      'utf8',
    );
    expect(text).toBe(bytes);
    expect(result.artifacts.some((artifact) => artifact.path.endsWith('.jsonl.gz'))).toBe(true);
  });

  it('快照落到 raw_snapshots/<owner>__<repo>/<commit>/files.json（幂等键 repoId+commit）', async () => {
    const source = await copySource();
    const out = join(workDir, 'ods');
    await materializeOds({ source, out });
    const snapshot = JSON.parse(
      await readFile(
        join(
          out,
          'raw_snapshots',
          'acme__design-kit',
          'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
          'files.json',
        ),
        'utf8',
      ),
    ) as Record<string, unknown>;
    expect(snapshot.repoId).toBe(1001);
    expect(snapshot.apiQuotaLeft).toBe(4987);
    const files = snapshot.files as Record<string, unknown>[];
    expect(files.map((file) => file.path)).toEqual([
      'LICENSE',
      'README.md',
      'preview/colors.svg',
      'skills/palette/SKILL.md',
    ]);
    const skill = files.find((file) => file.path === 'skills/palette/SKILL.md');
    expect(skill?.sha256).toBe(SKILL_SHA256);
    expect(skill?.blobRef).toBe(SKILL_SHA256);
    const readme = files.find((file) => file.path === 'README.md');
    expect(readme?.sha256).toBeNull();
    expect(readme?.blobRef).toBeNull();
  });

  it('blob 内容寻址：文件名即内容 sha256，且同正文自动去重', async () => {
    const source = await copySource();
    const out = join(workDir, 'ods');
    const result = await materializeOds({ source, out });
    const hex = SKILL_SHA256.slice('sha256:'.length);
    const text = await readFile(join(out, 'blobs', hex), 'utf8');
    expect(createHash('sha256').update(text, 'utf8').digest('hex')).toBe(hex);
    expect(text.startsWith('---\nname: palette-kit')).toBe(true);
    expect(result.blobsWritten).toBe(2);

    // 再跑一次：一切在案 → 去重计数，不重写
    const again = await materializeOds({ source, out });
    expect(again.blobsWritten).toBe(0);
    expect(again.blobsDeduped).toBe(2);
    expect(again.conflicts).toEqual([]);
  });

  it('只追加：同路径不同内容视为冲突，不得静默覆盖', async () => {
    const source = await copySource();
    const out = join(workDir, 'ods');
    await materializeOds({ source, out });
    const snapshotPath = join(
      out,
      'raw_snapshots',
      'acme__design-kit',
      'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
      'files.json',
    );
    await writeFile(snapshotPath, '{"schema":"df.market.ods.files/v1","tampered":true}\n', 'utf8');
    const result = await materializeOds({ source, out });
    expect(result.conflicts.length).toBeGreaterThan(0);
    expect(result.issues.some((issue) => issue.rule === 'snapshot-conflict')).toBe(true);
  });

  it('readOds 能读回规整产物：记录、快照、事件、blob 索引齐备', async () => {
    const source = await copySource();
    const out = join(workDir, 'ods');
    await materializeOds({ source, out });
    const bundle = await readOds(out);
    expect(bundle.records).toHaveLength(2);
    expect(bundle.snapshots).toHaveLength(2);
    expect(bundle.events).toHaveLength(4);
    expect(bundle.issues).toEqual([]);
    expect(bundle.blobs.size).toBe(2);
    const record = bundle.records.find((item) => item.repo.fullName === 'acme/design-kit');
    expect(record?.assets[0]?.id).toBe('gh:acme/design-kit#skills/palette');
  });

  it('readBlobText 按 blobRef 取回正文（解析器的输入）', async () => {
    const source = await copySource();
    const out = join(workDir, 'ods');
    await materializeOds({ source, out });
    const bundle = await readOds(out);
    expect(await readBlobText(bundle, SKILL_SHA256)).toContain('name: palette-kit');
    expect(await readBlobText(bundle, null)).toBeNull();
  });

  it('缺层目录 → OdsMissingError（不做空集假绿）', async () => {
    const source = await copySource();
    const out = join(workDir, 'ods');
    await materializeOds({ source, out });
    await rm(join(out, 'raw_snapshots'), { recursive: true, force: true });
    await expect(readOds(out)).rejects.toBeInstanceOf(OdsMissingError);
  });
});
