/**
 * 文本启发式（MK-03 评分用；只读，无副作用）。
 *
 * 规格依据：《技能市场规格 v1》§5.2 各维信号中可机械判定的部分（正文工作流、
 * description 的「何时使用」、README 安装/示例、纯链接清单、出站域名、敏感路径、
 * 上游署名、安装脚本）。判定口径一律在函数注释里写明，阈值集中在本文件，便于
 * 与规格一起演进；调用方不得另写一套。
 *
 * 注意：规格 §2.1.5 纪律——只处理描述性文本，不下载二进制、不克隆仓库。
 */

/** description 的「何时使用」触发语境（规格 §5.2 spec 信号，中英并收）。 */
const WHEN_TO_USE_PATTERNS: readonly RegExp[] = [
  /\buse when\b/i,
  /\buse this\b/i,
  /\bwhen to use\b/i,
  /\bwhen you\b/i,
  /\bwhenever\b/i,
  /\busage:/i,
  /何时使用/,
  /什么时候/,
  /何时/,
  /适用于/,
  /用于/,
  /使用场景/,
  /当.{0,40}时/,
];

/** 工作流章节标题（规格 §5.2 spec 信号「显式工作流」）。 */
const WORKFLOW_HEADING =
  /^#{1,6}\s*(?:工作流|步骤|用法|使用|流程|快速开始|workflow|usage|steps|quick ?start|getting started)/im;

/** 命令块里出现即视为命令的常见可执行 token（保守词表，避免把示意图当命令块）。 */
const COMMAND_TOKEN =
  /(?:^|\n)\s*(?:\$|>)?\s*(?:npm|pnpm|yarn|bun|npx|node|deno|python3?|pip3?|uv|git|gh|curl|wget|cp|mv|rm|mkdir|chmod|bash|sh|make|docker|jq|sed|awk|grep|find|zip|tar|unzip|code|df)\b/;

/** 安装说明特征（规格 §5.2 docs 信号「README 是否含安装」）。 */
const INSTALL_PATTERNS: readonly RegExp[] = [
  /\b(?:npm|pnpm|yarn|bun)\s+(?:i|add|install)\b/i,
  /\bpip3?\s+install\b/i,
  /git clone/i,
  /安装|下载|放入|拷贝|复制|导入/,
];

/** 使用示例章节标题（规格 §5.2 docs 信号「使用示例」）。 */
const USAGE_HEADING =
  /^#{1,6}\s*(?:示例|例子|用法|使用|快速开始|example|examples|usage|quick ?start|getting started)/im;

/** 行内 markdown 链接或裸 URL（纯链接清单判定用）。 */
const LINK_LINE = /^(?:[-*+]|\d+[.)])?\s*(?:\[[^\]]*\]\(\S+\)|<?https?:\/\/\S+>?)\s*$/;

/** 行内含链接（短文件里「See: <url>」这类 redirect 写法也算）。 */
const LINK_CONTAINING = /\[[^\]]*\]\(\S+\)|https?:\/\/\S+/;

/** 标题行（纯链接清单判定时算「占位」，不构成正文）。 */
const HEADING_LINE = /^#{1,6}\s*\S/;

/** 出站 URL（提取域名）。 */
const URL_PATTERN = /https?:\/\/([A-Za-z0-9.-]+)/g;

/**
 * 敏感路径模式（规格 §5.2 security 信号「工作目录外读写」）；捕获组 1 = 上报片段。
 * 口径：系统绝对路径（含 POSIX 敏感目录与 Windows 盘符）、家目录、两级以上回溯。
 * `/tmp` 明确不算——它是系统临时目录，误报会把真实信号淹掉（口径记录在此，改则同步改测试）。
 */
const SENSITIVE_PATH_PATTERNS: readonly RegExp[] = [
  // POSIX 敏感目录下的绝对路径（报告整段路径）
  /(?:^|[\s"'`(=])((?:\/(?:etc|usr|var|root|home|opt|sbin|bin|proc|sys))\/[^\s"'`)]*)/,
  // 家目录（报告前缀 `~/`）
  /(?:^|[\s"'`(=])(~\/|\$HOME\/|\$\{HOME\}\/)/,
  // Windows 盘符绝对路径（报告盘符前缀）
  /(?:^|[\s"'`(=])([A-Za-z]:\\)/,
  // 两级以上回溯（报告 `../../`）
  /(?:^|[\s"'`(=])(\.\.\/(?:\.\.\/)+)/,
];

/** 上游署名特征（规格 §5.2 docs 信号「含上游署名」）。 */
const UPSTREAM_PATTERNS: readonly RegExp[] = [
  /\bupstream\b/i,
  /\bderived from\b/i,
  /\bfork(?:ed)?\s+(?:of|from)\b/i,
  /\bbased on\b/i,
  /\badapted from\b/i,
  /\bmodified from\b/i,
  /上游/,
  /源自/,
  /基于/,
  /改编/,
  /复刻/,
];

/** npm 生命周期钩子（规格 §5.2 security 信号「隐藏安装脚本」）。 */
const LIFECYCLE_HOOKS: readonly string[] = [
  'preinstall',
  'install',
  'postinstall',
  'prepare',
  'prepublish',
  'prepublishOnly',
  'preuninstall',
  'uninstall',
  'postuninstall',
];

/** description 是否写明「何时使用」（含触发语境）。 */
export function looksLikeWhenToUse(description: string): boolean {
  const text = description.trim();
  if (text === '') return false;
  return WHEN_TO_USE_PATTERNS.some((p) => p.test(text));
}

/** 统计顺序步骤条目数（`1.` / `1、` / `1)` 行首）。 */
function countOrderedItems(text: string): number {
  return text.split('\n').filter((line) => /^\s*\d+[.、)]\s+\S/.test(line)).length;
}

/** 正文是否含显式工作流：工作流标题、≥2 条顺序步骤、或含命令的围栏代码块。 */
export function hasExplicitWorkflow(text: string): boolean {
  if (WORKFLOW_HEADING.test(text)) return true;
  if (countOrderedItems(text) >= 2) return true;
  return text
    .split(/```/)
    .filter((_, index) => index % 2 === 1)
    .some((block) => COMMAND_TOKEN.test(block));
}

/** 是否含安装说明（包管理器命令 / clone / 中文安装动词）。 */
export function hasInstallInstructions(text: string): boolean {
  return INSTALL_PATTERNS.some((p) => p.test(text));
}

/** 提取围栏代码块的内容（偶数索引是块外散文）。 */
function fencedBlocks(text: string): string[] {
  return text.split(/```/).filter((_, index) => index % 2 === 1);
}

/** 是否含使用示例：示例章节、示例关键词、或 ≥2 段代码块（第一段通常是安装）。 */
export function hasUsageExample(text: string): boolean {
  if (USAGE_HEADING.test(text)) return true;
  if (/示例|例如|用法|\bfor example\b|\bexample\b/i.test(text)) return true;
  return fencedBlocks(text).length >= 2;
}

/** 纯链接清单判定（空文本、≤2 行且含链接、或链接/标题占比 ≥60%）。 */
export function isPureLinkList(text: string): boolean {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
  if (lines.length === 0) return true;
  if (lines.length <= 2) return lines.some((l) => LINK_CONTAINING.test(l));
  const linkish = lines.filter((l) => LINK_LINE.test(l) || HEADING_LINE.test(l)).length;
  return linkish / lines.length >= 0.6;
}

/** 提取文本中的出站域名（小写、去重、排序）。 */
export function extractDomains(text: string): string[] {
  const domains = new Set<string>();
  for (const match of text.matchAll(URL_PATTERN)) {
    const domain = match[1];
    if (domain !== undefined) domains.add(domain.toLowerCase());
  }
  return [...domains].sort();
}

/** 找出敏感路径访问片段（去重、排序）。 */
export function findSensitivePaths(text: string): string[] {
  const hits = new Set<string>();
  for (const pattern of SENSITIVE_PATH_PATTERNS) {
    for (const match of text.matchAll(new RegExp(pattern.source, 'g'))) {
      const hit = match[1] ?? match[0];
      if (hit !== '') hits.add(hit);
    }
  }
  return [...hits].sort();
}

/** 是否含上游署名（许可说明清晰度的第二分量，规格 §5.2 docs）。 */
export function mentionsUpstreamAttribution(text: string): boolean {
  return UPSTREAM_PATTERNS.some((p) => p.test(text));
}

/** 列出 package.json 里的生命周期钩子（值非空字符串才算；排序）。 */
export function findLifecycleScripts(packageJson: Record<string, unknown> | null): string[] {
  const scripts = packageJson?.scripts;
  if (typeof scripts !== 'object' || scripts === null || Array.isArray(scripts)) return [];
  const record = scripts as Record<string, unknown>;
  return LIFECYCLE_HOOKS.filter((hook) => {
    const value = record[hook];
    return typeof value === 'string' && value.trim() !== '';
  }).sort();
}
