/**
 * 空态种类判定（FE-02 · B7）。
 *
 * 为什么单独一个纯函数：「该显示哪种空态」是首页最容易写错又最容易漏测的一处判断
 * （无文件 ≠ 筛选无果 ≠ 回收站空），抽出来单测，避免散在 JSX 的条件表达式里。
 */

/** 空态种类。 */
export type HomeEmptyKind = 'documents' | 'search' | 'trash';

/** 判定输入。 */
export interface EmptyKindInput {
  /** 当前分区是否为回收站。 */
  inTrash: boolean;
  /** 过滤前的文档总数（daemon 列表长度）。 */
  totalDocuments: number;
  /** 过滤后的可见条数。 */
  visibleCount: number;
  /** 当前是否有搜索词或非默认筛选。 */
  filtered: boolean;
}

/** 判定该显示哪种空态（仅在 visibleCount 为 0 时有意义）。 */
export function resolveEmptyKind(input: EmptyKindInput): HomeEmptyKind {
  if (input.inTrash) return 'trash';
  // 库里本来就没有文件 → 「无文件」空态（此时给新建引导，而不是让他清筛选）
  if (input.totalDocuments === 0) return 'documents';
  // 有文件但被搜索/筛选挡掉 → 「搜索无果」
  if (input.filtered) return 'search';
  return 'documents';
}
