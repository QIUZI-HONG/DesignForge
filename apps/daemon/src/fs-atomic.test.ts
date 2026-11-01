/**
 * @dforge/daemon · 原子写原语的「暂存 → 发布」边界（票 19）。
 *
 * 文档存储的可观测承诺是「保存失败 = 盘上没变」，这条承诺由原语构造性保证：
 * 内容先 fsync 到同目录的临时名上，只有持有者显式 `publish()` 之后才出现在目标名。
 * 因此这里钉死三件事：暂存期目标名不变、`discard()` 零残留、`publish()` 失败也零残留。
 */

import { mkdir, mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { removeTree, stageFileAtomic, writeFileAtomic } from './fs-atomic.ts';

describe('fs-atomic · 暂存与发布分离', () => {
  let dir: string;
  let target: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'df-fs-atomic-'));
    target = join(dir, 'page-1.json');
    await writeFileAtomic(target, '旧内容\n', 0o644);
  });

  afterEach(async () => {
    await removeTree(dir);
  });

  it('暂存期间目标名仍是旧内容，publish 之后才变成新内容', async () => {
    const staged = await stageFileAtomic(target, '新内容\n', 0o644);

    expect(await readFile(target, 'utf8')).toBe('旧内容\n');

    await staged.publish();

    expect(await readFile(target, 'utf8')).toBe('新内容\n');
    // 发布后临时文件已被 rename 走：目录只剩目标名，读者无从看到半截内容
    expect(await readdir(dir)).toEqual(['page-1.json']);
  });

  it('discard 作废暂存：目标名保持旧内容，目录里不留临时文件', async () => {
    const staged = await stageFileAtomic(target, '新内容\n', 0o644);
    // 暂存确实写到了盘上（同目录临时名），否则「作废」无从谈起
    expect((await readdir(dir)).filter((entry) => entry !== 'page-1.json')).toHaveLength(1);

    await staged.discard();

    expect(await readFile(target, 'utf8')).toBe('旧内容\n');
    expect(await readdir(dir)).toEqual(['page-1.json']);
  });

  it('publish 失败也要撤掉临时文件并抛出（不留半截垃圾）', async () => {
    const blocked = join(dir, 'blocked');
    // rename 文件到已存在的目录名上必然失败（EISDIR）：用它构造发布失败
    await mkdir(blocked);
    const staged = await stageFileAtomic(blocked, '新内容\n', 0o644);

    await expect(staged.publish()).rejects.toThrow();

    expect(await readdir(dir)).toEqual(['blocked', 'page-1.json']);
  });
});
