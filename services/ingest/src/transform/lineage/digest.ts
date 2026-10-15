/**
 * 资产 digest 计算（规格 §1.6）与目录指纹辅助。
 *
 * 规格原文：输入 = 资产根目录内**全部文件**，逐个取 sha256；清单流 = 按相对路径字典序拼接
 * `"<相对路径>\0<文件 sha256>\0<字节数>\n"`（统一 LF、UTF-8）；`digest = "sha256:" + sha256(清单流)`。
 *
 * 与采集纪律的张力（如实声明，不粉饰）：规格 §8.1 明令「只读描述性文本、不下载二进制」，
 * 而 §1.6 需要**全部文件**的内容 sha256。二者无法同时满足时本实现的选择是：
 *   - 内容齐备（每个文件都有 sha256 与字节数）→ 给出规格口径 `digest`（status=ok）；
 *   - 内容不齐 → `digest = null` 且 status=incomplete-content，同时保留覆盖率与逐文件哈希表，
 *     让上层（MK-04 卡片/详情）如实降级。**绝不**用 git blob sha 冒充内容 sha256。
 */

import { createHash } from 'node:crypto';

export interface AssetFileHash {
  /** 资产根内相对路径。 */
  path: string;
  /** git blob sha（Trees API；始终可得，但与内容 sha256 不同源，不得混用）。 */
  gitSha: string;
  /** 内容 sha256（`sha256:<hex>`）；未采集正文为 null。 */
  sha256: string | null;
  /** 字节数（Trees API 原样）。 */
  size: number | null;
}

export interface AssetDigestResult {
  digest: string | null;
  status: 'ok' | 'incomplete-content' | 'empty';
  /** 已获 sha256 且字节数已知的文件占比（0–1）。 */
  coverage: number;
  fileCount: number;
  knownCount: number;
}

/**
 * 正文规范化（规格 §2.6.1）：去 BOM → 统一换行 → 剥许可/版权头 → 折叠空白。
 * 放在本文件（与哈希同源）供精确重复判据与指纹共用。
 */
export function normalizeBody(text: string): string {
  const value = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = value.split('\n');
  let start = 0;
  while (start < lines.length) {
    const line = lines[start]?.trim() ?? '';
    if (
      line === '' ||
      /^<!--.*-->$/.test(line) ||
      /^(<!--|\*|>|\/\/|#)\s*(copyright|spdx-licen[cs]e-identifier|licen[cs]e)/i.test(line)
    ) {
      start += 1;
      continue;
    }
    break;
  }
  return lines
    .slice(start)
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n');
}

/** 规范化正文的内容指纹（精确重复判据）。 */
export function bodyFingerprint(text: string): string {
  return `sha256:${createHash('sha256').update(normalizeBody(text), 'utf8').digest('hex')}`;
}

/** 计算资产 digest（规格 §1.6；内容不齐时返回 null 并如实标注）。 */ export function computeAssetDigest(
  files: readonly AssetFileHash[],
): AssetDigestResult {
  if (files.length === 0) {
    return { digest: null, status: 'empty', coverage: 0, fileCount: 0, knownCount: 0 };
  }
  const known = files.filter((file) => file.sha256 !== null && file.size !== null);
  const coverage = known.length / files.length;
  if (known.length !== files.length) {
    return {
      digest: null,
      status: 'incomplete-content',
      coverage: Math.round(coverage * 100) / 100,
      fileCount: files.length,
      knownCount: known.length,
    };
  }
  const lines = [...files]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((file) => `${file.path}\0${file.sha256 ?? ''}\0${file.size ?? 0}\n`)
    .join('');
  return {
    digest: `sha256:${createHash('sha256').update(lines, 'utf8').digest('hex')}`,
    status: 'ok',
    coverage: 1,
    fileCount: files.length,
    knownCount: files.length,
  };
}
