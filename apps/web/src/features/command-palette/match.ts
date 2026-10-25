/**
 * 命令模糊匹配（工单 08 · 中文模糊搜索的核心；**零依赖**——pnpm-workspace catalog
 * 纪律禁新第三方包，子序列/包含匹配自实现，拼音首字母不做无库硬凑）。
 *
 * 匹配策略与排序分（越小越靠前，同分保持注册顺序）：
 * 1. 标题连续包含（大小写不敏感）：分 = 命中位置（越早越靠前）——「放大」搜"放大"本尊；
 * 2. 标题子序列（按序、允许不连续，中文友好）：分 = 1000 + 间隙和——"命面" 命中「命令面板」；
 * 3. id 连续包含：分 = 2000 + 命中位置——英文搜索词（zoom）也能直达中文命令；
 * 4. 分组名连续包含：分 = 3000 + 命中位置——搜「视图」列出视图组全部命令。
 *
 * 高亮：只标标题命中（1/2 档给出标题上的半开区间 [start, end)；3/4 档无区间——
 * 命中的是 id/分组，标题上没有可标的字）。查询先 trim，空查询由 `searchCommands`
 * 特判为「全量无高亮」。
 */
import type { Command } from '../editor-shell';

/** 单条命中：排序分 + 标题命中区段。 */
export interface CommandMatch {
  /** 排序分（越小越靠前）。 */
  score: number;
  /** 标题命中区段（半开区间，按出现顺序；id/分组命中时为空数组）。 */
  ranges: ReadonlyArray<readonly [number, number]>;
}

/** 一条搜索结果。 */
export interface SearchHit {
  command: Command;
  /** 命中详情；空查询全量时为 null（无高亮语义）。 */
  match: CommandMatch | null;
}

/** 子序列档的起步分（高于一切连续包含）。 */
const SUBSEQUENCE_BASE = 1000;
/** id 兜底档的起步分。 */
const ID_BASE = 2000;
/** 分组兜底档的起步分。 */
const GROUP_BASE = 3000;

/** 找子串（大小写不敏感），返回命中起点；未命中 -1。 */
function indexOfFold(haystack: string, needle: string): number {
  return haystack.toLowerCase().indexOf(needle.toLowerCase());
}

/**
 * 按序子序列匹配：贪心取最早位置（保证位置合法且自然靠前）。
 *
 * 逐字符做大小写折叠比较（而非先 lowercase 再找——个别 Unicode 字符折叠后长度会变，
 * 直接折叠会漂移区间下标；标题都是短串，逐字符扫描成本可忽略）。
 *
 * @returns 各命中字符的半开区间；未命中 null
 */
function matchSubsequence(
  title: string,
  needle: string,
): ReadonlyArray<readonly [number, number]> | null {
  const ranges: Array<readonly [number, number]> = [];
  let from = 0;
  for (const raw of needle) {
    const char = raw.toLowerCase();
    let found = -1;
    for (let at = from; at < title.length; at += 1) {
      if (title[at]?.toLowerCase() === char) {
        found = at;
        break;
      }
    }
    if (found < 0) return null;
    ranges.push([found, found + 1]);
    from = found + 1;
  }
  return ranges;
}

/**
 * 匹配单条命令。
 *
 * @param command 命令
 * @param rawQuery 原始查询（内部 trim + 大小写折叠）
 * @returns 命中详情；无命中或空查询 → null
 */
export function matchCommand(command: Command, rawQuery: string): CommandMatch | null {
  const query = rawQuery.trim().toLowerCase();
  if (query === '') return null;

  // 1) 标题连续包含
  const titleAt = indexOfFold(command.title, query);
  if (titleAt >= 0) {
    return { score: titleAt, ranges: [[titleAt, titleAt + query.length]] };
  }

  // 2) 标题子序列（分含间隙和：字挨得越近越靠前）
  const sub = matchSubsequence(command.title, query);
  if (sub !== null) {
    let gaps = 0;
    for (let index = 1; index < sub.length; index += 1) {
      gaps += (sub[index]?.[0] ?? 0) - (sub[index - 1]?.[1] ?? 0);
    }
    return { score: SUBSEQUENCE_BASE + gaps, ranges: sub };
  }

  // 3) id 兜底（无高亮区间）
  const idAt = indexOfFold(command.id, query);
  if (idAt >= 0) return { score: ID_BASE + idAt, ranges: [] };

  // 4) 分组兜底（无高亮区间）
  const groupAt = indexOfFold(command.group, query);
  if (groupAt >= 0) return { score: GROUP_BASE + groupAt, ranges: [] };

  return null;
}

/**
 * 搜索命令表：空查询 = 全量（保持注册顺序、无高亮）；有查询 = 按分排序
 * （同分保持注册顺序——比较器显式带序号，不依赖 sort 的稳定实现细节）。
 */
export function searchCommands(commands: Command[], rawQuery: string): SearchHit[] {
  if (rawQuery.trim() === '') {
    return commands.map((command) => ({ command, match: null }));
  }
  const scored: Array<{ command: Command; match: CommandMatch; order: number }> = [];
  for (let index = 0; index < commands.length; index += 1) {
    const command = commands[index];
    if (command === undefined) continue;
    const match = matchCommand(command, rawQuery);
    if (match === null) continue;
    scored.push({ command, match, order: index });
  }
  return scored
    .sort(
      (a, b) =>
        a.match.score - b.match.score ||
        a.command.title.length - b.command.title.length ||
        a.order - b.order,
    )
    .map(({ command, match }) => ({ command, match }));
}
