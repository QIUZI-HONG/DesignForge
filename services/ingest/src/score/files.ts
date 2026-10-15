/**
 * 文件清单信号（MK-03 评分用；只读纯函数）。
 *
 * 规格依据：《技能市场规格 v1》§5.2 各维信号的文件级判据——
 * CI 存在性（maintenance）· 预览资产 / changelog / 许可原文（docs）·
 * references、examples（spec）· shell 脚本（security）。
 *
 * 路径一律按**资产根相对路径**判定（与 DWD `asset_file` 同口径）；大小写不敏感
 * （Windows/macOS 提交习惯差异），但目录语义按 `/` 分隔。
 */

/** 文件条目最小形状（只需路径参与判定）。 */
interface PathEntry {
  path: string;
}

/** 是否有 CI：`.github/workflows/` 下存在 .yml/.yaml（规格 §5.2 maintenance）。 */
export function hasWorkflowFiles(entries: readonly PathEntry[]): boolean {
  return entries.some((e) => /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(e.path));
}

/** 是否有预览资产：`preview/` 下的图片或 `components.html`（规格 §5.2 docs）。 */
export function hasPreviewAsset(entries: readonly PathEntry[]): boolean {
  return entries.some(
    (e) =>
      /^preview\/.*\.(?:png|jpe?g|gif|webp|svg)$/i.test(e.path) ||
      /(?:^|\/)components\.html$/i.test(e.path),
  );
}

/** 是否有 changelog 文件（规格 §5.2 docs）。 */
export function hasChangelogFile(entries: readonly PathEntry[]): boolean {
  return entries.some((e) => /(?:^|\/)CHANGELOG(?:\.[A-Za-z0-9]+)?$/i.test(e.path));
}

/** 是否有许可原文（LICENSE 家族 / COPYING；规格 §5.2 docs 许可说明）。 */
export function hasLicenseFile(entries: readonly PathEntry[]): boolean {
  return entries.some((e) => /(?:^|\/)(?:LICEN[CS]E(?:[-_.][^/]*)?|COPYING)$/i.test(e.path));
}

/** 是否附 references/ 或 examples/ 目录（规格 §5.2 spec 信号）。 */
export function hasAuxDir(entries: readonly PathEntry[]): boolean {
  return entries.some((e) => /^(?:references|examples)\//i.test(e.path));
}

/** 是否有 shell 脚本（规格 §5.2 security 信号「shell 脚本」）。 */
export function hasShellScript(entries: readonly PathEntry[]): boolean {
  return entries.some((e) => /\.(?:sh|bash|zsh|fish|ps1)$/i.test(e.path));
}
