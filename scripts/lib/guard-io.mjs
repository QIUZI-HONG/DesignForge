/**
 * 守卫公共件：argv 解析、仓储内路径展示、文本读探与确定序遍历（批次 3 修复 · 去重抽取）。
 *
 * 为什么独立成模块：`guard-vocab` / `guard-feature-boundaries` / `guard-electron-baseline`
 * 三份守卫此前各自逐字重复 `readArg` / `displayPath` / `readText` 与「按名排序的目录遍历」，
 * 一处改口径三处都要跟（漏一处就漂移）。这里给出**唯一实现**，由
 * `scripts/tests/guard-io.test.mjs` 锁定外部契约（解析形态 / 展示路径 / 读取失败形态 /
 * 遍历顺序与排除规则）。
 *
 * 纪律（守卫对外行为不得因抽取而变化）：
 * - 三态退出码语义、报错文案里的路径展示口径（仓储内相对、仓储外原样）保持原样；
 * - 遍历输出**确定**（逐层按名排序）：守卫的「点名」报错与快照式断言都依赖顺序稳定；
 * - 读取失败一律返回 `{ error }`（而不是抛），由调用方转「阻塞」（exit 2）语义。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 仓库根（本模块位于 `scripts/lib/`，上溯两级）。 */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 从 argv 取 `--name=value`（首个命中；未给返回 undefined，给了空串返回 ''）。 */
export function readArg(name, argv = process.argv) {
  const prefix = `--${name}=`;
  const hit = argv.find((arg) => arg.startsWith(prefix));
  return hit?.slice(prefix.length);
}

/** 相对仓库根的展示路径（仓储外路径原样展示——夹具报错要能直接落到绝对路径）。 */
export function displayPath(path) {
  const rel = relative(REPO_ROOT, path);
  return rel.startsWith('..') || rel === '' ? path : rel.split(sep).join('/');
}

/** 读取文本；失败返回 `{ error }`（调用方按阻塞语义处置，不抛）。 */
export function readText(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    return { error: `读取不到 ${displayPath(path)}：${String(error)}` };
  }
}

/**
 * 递归收集文件（输出确定：逐层按名排序）。
 *
 * - 根不存在 → `null`（调用方记「阻塞」，禁当通过）；根是文件 → 该文件本身；
 * - `isTarget(fileName)` 判定文件是否纳入（如「.ts 且非 .test.ts」）；
 * - `excludeDirs` 命中的目录**整棵跳过**（如 `__fixtures__` / `__snapshots__`）。
 *
 * @param {string} root
 * @param {{ isTarget: (fileName: string) => boolean, excludeDirs?: readonly string[] }} options
 * @returns {string[] | null}
 */
export function collectFiles(root, { isTarget, excludeDirs = [] }) {
  if (!existsSync(root)) return null;
  if (statSync(root).isFile()) return [root];
  const skip = new Set(excludeDirs);
  const files = [];
  const walk = (dir) => {
    for (const item of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      const full = join(dir, item.name);
      if (item.isDirectory()) {
        if (skip.has(item.name)) continue;
        walk(full);
        continue;
      }
      if (!isTarget(item.name)) continue;
      files.push(full);
    }
  };
  walk(root);
  return files;
}
