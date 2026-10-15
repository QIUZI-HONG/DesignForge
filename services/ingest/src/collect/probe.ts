/**
 * 结构探针（规格 §2：Trees API 单次调用完成四类发现）。
 *
 * 只做**路径结构**匹配（大小写敏感、只认结构不认 topic）；manifest 类结构件
 * 按可能语义都记为候选，具体是哪一类由内容校验（validate.ts）与识别整合
 * （identify.ts）分流——这是「防纯文件名误报」的两级结构里的第一级。
 *
 * 资产根（root）口径：结构件所在目录；`.claude-plugin/plugin.json` 例外，
 * 归其父目录（插件工程根不是 `.claude-plugin` 目录本身）；`preview/`、`examples/`
 * 目录归其父目录。
 */

import type { PieceKind, ProbePiece, TreeEntry } from './types.ts';

/** 取父目录（`a/b/c.txt` → `a/b`；仓根 → `''`）。 */
export function parentDir(path: string): string {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
  const idx = trimmed.lastIndexOf('/');
  return idx === -1 ? '' : trimmed.slice(0, idx);
}

/** 取基名（末段）。 */
export function baseName(path: string): string {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
  const idx = trimmed.lastIndexOf('/');
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

/** tokens 结构件基名（规格 §2.4；tailwind.config 按 v1.1 §4.4.1 归入 tokens 证据）。 */
const TOKENS_BASENAMES = new Set([
  'design-tokens.json',
  'tokens.json',
  'tokens.css',
  'tailwind-v4.css',
  'tailwind.config.js',
  'tailwind.config.ts',
  'tailwind.config.cjs',
  'tailwind.config.mjs',
]);

/**
 * 对 Trees 清单做四类结构探针；输出按 `path` 字典序稳定（ODS 可复现前提）。
 */
export function probeTree(tree: TreeEntry[]): ProbePiece[] {
  const pieces: ProbePiece[] = [];

  for (const entry of tree) {
    const { path, type } = entry;

    if (type === 'tree') {
      const name = baseName(path);
      if (name === 'preview') {
        pieces.push({ piece: 'preview-dir', path, root: parentDir(path) });
      } else if (name === 'examples') {
        pieces.push({ piece: 'examples-dir', path, root: parentDir(path) });
      }
      continue;
    }
    if (type !== 'blob') continue;

    const name = baseName(path);
    const piece = classifyBlob(name);
    if (piece === null) continue;

    let root = parentDir(path);
    if (
      (piece === 'plugin-manifest' || piece === 'marketplace-manifest') &&
      baseName(root) === '.claude-plugin'
    ) {
      // `.claude-plugin/plugin.json`、`.claude-plugin/marketplace.json` →
      // 插件工程根 = `.claude-plugin` 的父目录（该目录只是约定位置，不是资产根）。
      root = parentDir(root);
    }
    pieces.push({ piece, path, root });
  }

  pieces.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return pieces;
}

/** 单个 blob 的探针判定（大小写敏感：只认规格列出的确切名字）。 */
function classifyBlob(name: string): PieceKind | null {
  switch (name) {
    case 'SKILL.md':
      return 'skill-doc';
    case 'DESIGN.md':
      return 'design-md';
    case 'plugin.json':
      return 'plugin-manifest';
    case 'marketplace.json':
      return 'marketplace-manifest';
    case 'package.json':
      return 'package-json';
    case 'template.json':
      return 'template-manifest';
    case 'manifest.json':
      return 'manifest-json';
    case 'components.manifest.json':
      return 'components-manifest';
    case '.mcp.json':
      return 'mcp-json';
    default:
      break;
  }
  if (TOKENS_BASENAMES.has(name)) return 'tokens-file';
  return null;
}
