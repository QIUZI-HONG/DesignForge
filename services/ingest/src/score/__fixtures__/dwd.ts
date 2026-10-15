/**
 * 测试夹具工厂（MK-03 内部用）。
 *
 * 用途：各维度单测只写「与本用例相关的差异」，其余字段取健康样例默认值——
 * 让每个测试读起来是「这一条信号怎么算」，而不是一坨字段。
 * 默认样例 = 一个健康的 skill 资产（frontmatter 齐、正文有步骤、有 references/）。
 */

import type { DwdAsset, DwdFileEntry } from '../types.ts';

/** 全批统一评分时点（夹具用；注入式，禁时钟依赖——规格 §4.3.2）。 */
export const AS_OF = '2026-10-15T00:00:00Z';

/** 相对评分时点的「n 天前」ISO 时刻（确定性，供维护活跃用例造边界）。 */
export function daysAgo(n: number): string {
  const base = Date.parse(AS_OF);
  return new Date(base - n * 86_400_000).toISOString();
}

/** 造文件条目（sha 用稳定占位：夹具不校验内容哈希）。 */
export function file(path: string, size = 128): DwdFileEntry {
  return { path, size, sha256: 'f'.repeat(64) };
}

/** 默认资产根文件清单：SKILL.md + references/ + LICENSE + CI 工作流。 */
export const DEFAULT_FILES: DwdFileEntry[] = [
  file('SKILL.md'),
  file('references/api.md'),
  file('LICENSE'),
  file('.github/workflows/ci.yml'),
];

/** 默认正文：含显式步骤 + 命令块。 */
export const DEFAULT_BODY = [
  '# PDF 导出',
  '',
  '把设计稿导出为分页 PDF。',
  '',
  '1. 打开导出面板',
  '2. 选择画板',
  '3. 确认生成',
  '',
  '```bash',
  'df export --format pdf',
  '```',
].join('\n');

/** 默认 README：安装 + 示例 + 许可段。 */
export const DEFAULT_README = [
  '# pdf-export',
  '',
  '## Install',
  '',
  '```bash',
  'npm i @acme/pdf-export',
  '```',
  '',
  '## Usage',
  '',
  '```bash',
  'npx pdf-export build --out a.pdf',
  '```',
  '',
  '## License',
  '',
  'MIT',
].join('\n');

/** 夹具分组覆盖（浅合并，按组替换）。 */
export interface DwdOverrides {
  asset?: Partial<DwdAsset['asset']>;
  repo?: Partial<DwdAsset['repo']>;
  license?: Partial<DwdAsset['license']>;
  files?: Partial<DwdAsset['files']>;
  text?: Partial<DwdAsset['text']>;
  trend?: Partial<DwdAsset['trend']>;
}

/** 造一条健康 DWD 资产记录（按需覆盖分组字段）。 */
export function makeDwd(overrides: DwdOverrides = {}): DwdAsset {
  return {
    asset: {
      id: 'gh:acme/skills#skills/pdf',
      kind: 'skill',
      name: 'pdf',
      ref: 'a'.repeat(40),
      path: 'skills/pdf',
      compliance: 'ok',
      capabilitiesDeclared: true,
      capabilities: ['prompt:inject', 'fs:read'],
      ...overrides.asset,
    },
    repo: {
      repoId: 1001,
      fullName: 'acme/skills',
      stars: 240,
      forks: 24,
      pushedAt: daysAgo(10),
      createdAt: daysAgo(700),
      archived: false,
      fork: false,
      upstream: null,
      commits90d: 12,
      lastReleaseAt: daysAgo(40),
      ...overrides.repo,
    },
    license: {
      spdx: 'MIT',
      gate: 'loadable',
      evidence: { path: 'LICENSE', sha256: 'e'.repeat(64) },
      ...overrides.license,
    },
    files: {
      truncated: false,
      entries: [...DEFAULT_FILES],
      ...overrides.files,
    },
    text: {
      frontmatter: {
        name: 'pdf-export',
        description: 'Use when the user needs to export a design to paginated PDF.',
        triggers: ['export pdf'],
        tags: ['pdf', 'export'],
      },
      body: DEFAULT_BODY,
      readme: DEFAULT_README,
      manifest: null,
      packageJson: null,
      mcpJson: null,
      changelog: '## 1.0.0\n\n首次发布。',
      ...overrides.text,
    },
    trend: {
      stars90dAgo: 200,
      referencedBy: 1,
      ...overrides.trend,
    },
  };
}
