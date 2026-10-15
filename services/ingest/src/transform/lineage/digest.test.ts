/**
 * 资产 digest 与目录指纹测试（规格 §1.6 清单流算法 / §2.6.1 精确重复规范）。
 *
 * 期望值来自独立的字面量构造（不调用被测函数重算），以便真正能发现实现偏差。
 */

import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { computeAssetDigest, normalizeBody } from './digest.ts';

const sha = (text: string) => `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;

describe('computeAssetDigest（规格 §1.6）', () => {
  it('清单流 = 按相对路径字典序的 `<路径>\\0<sha256>\\0<字节数>\\n`（LF/UTF-8）', () => {
    const files = [
      { path: 'preview/a.svg', gitSha: 'aaa', sha256: sha('svg'), size: 12 },
      { path: 'LICENSE', gitSha: 'bbb', sha256: sha('license'), size: 34 },
    ];
    // 独立构造期望的清单流（字典序：LICENSE 在 preview/a.svg 之前）
    const stream = `LICENSE\0${sha('license')}\0${34}\npreview/a.svg\0${sha('svg')}\0${12}\n`;
    const result = computeAssetDigest(files);
    expect(result.digest).toBe(sha(stream));
    expect(result.status).toBe('ok');
    expect(result.coverage).toBe(1);
  });

  it('内容不全（有文件缺 sha256）→ digest=null 并如实报 incomplete-content 与覆盖率', () => {
    const files = [
      { path: 'LICENSE', gitSha: 'bbb', sha256: sha('license'), size: 34 },
      { path: 'logo.png', gitSha: 'ccc', sha256: null, size: 2048 },
    ];
    const result = computeAssetDigest(files);
    expect(result.digest).toBeNull();
    expect(result.status).toBe('incomplete-content');
    expect(result.fileCount).toBe(2);
    expect(result.knownCount).toBe(1);
    expect(result.coverage).toBe(0.5);
  });

  it('空文件清单 → digest=null，status=empty（不臆造空流哈希）', () => {
    const result = computeAssetDigest([]);
    expect(result.digest).toBeNull();
    expect(result.status).toBe('empty');
    expect(result.coverage).toBe(0);
  });

  it('同 commit 同内容 → 同 digest；内容变 → digest 变（确定性要求）', () => {
    const before = [{ path: 'SKILL.md', gitSha: 'a', sha256: sha('v1'), size: 2 }];
    const same = [{ path: 'SKILL.md', gitSha: 'a', sha256: sha('v1'), size: 2 }];
    const after = [{ path: 'SKILL.md', gitSha: 'b', sha256: sha('v2'), size: 2 }];
    expect(computeAssetDigest(before).digest).toBe(computeAssetDigest(same).digest);
    expect(computeAssetDigest(before).digest).not.toBe(computeAssetDigest(after).digest);
  });

  it('路径不同但内容相同 → digest 不同（路径参与清单流）', () => {
    const a = [{ path: 'a.md', gitSha: 'x', sha256: sha('same'), size: 4 }];
    const b = [{ path: 'b.md', gitSha: 'x', sha256: sha('same'), size: 4 }];
    expect(computeAssetDigest(a).digest).not.toBe(computeAssetDigest(b).digest);
  });
});

describe('normalizeBody（规格 §2.6.1：去 BOM/空白/许可头）', () => {
  it('去 BOM、统一换行、折叠空白、剥离许可头后同 hash', () => {
    const a = '\uFEFF# Skill\r\n\r\n  Install   me  \r\n';
    const b = '# Skill\n\nInstall me\n';
    expect(normalizeBody(a)).toBe(normalizeBody(b));
  });

  it('许可头（License 行起的前置注释块）被剥离', () => {
    const withHeader =
      '<!-- Copyright 2026 Acme -->\n<!-- SPDX-License-Identifier: MIT -->\n# Real\n';
    const without = '# Real\n';
    expect(normalizeBody(withHeader)).toBe(normalizeBody(without));
  });

  it('正文内容差异必须保留（不得过度归一）', () => {
    expect(normalizeBody('# A\n')).not.toBe(normalizeBody('# B\n'));
  });
});
