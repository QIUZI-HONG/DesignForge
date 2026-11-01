/**
 * @dforge/daemon · 画布页正文的引用完整性守门（票 17：写读对称校验）。
 *
 * 归属口径：daemon 对正文总体仍是 **opaque JSON** 存储（不解析设计语义）；唯一例外是
 * `dforge.canvas.page` 信封——它是 web 画布的落盘形状，读回侧由引擎 `parseDocument`
 * 全校验（一处悬空引用 = 整份文档不可重开）。写不校验、读全校验 = 「能写不可读」的
 * 锁定路径，因此写侧至少守住引用完整性这一条：实例的 `componentId` 必须指向本页
 * 的主组件节点。形状/数学校验仍由 web 侧 `saveDesignDocument` 前的 `validateDocument`
 * 全量承担（两层同源于引擎口径，强度对称）。
 */

/** 画布页信封标识（与 web `documents-client.CANVAS_PAGE_FORMAT` 同值——跨包线格式约定）。 */
const CANVAS_PAGE_FORMAT = 'dforge.canvas.page';

/**
 * 检查 `dforge.canvas.page` 正文的引用完整性，返回问题清单（无问题 → null）。
 *
 * 非本信封的正文一律返回 null（维持 opaque 口径，外来格式不受本守门影响）。
 */
export function canvasPageReferenceIssues(body: unknown): string[] | null {
  if (typeof body !== 'object' || body === null) return null;
  const record = body as Record<string, unknown>;
  if (record.$format !== CANVAS_PAGE_FORMAT) return null;
  const page = record.page;
  if (typeof page !== 'object' || page === null) return null;
  const nodes = (page as Record<string, unknown>).nodes;
  if (typeof nodes !== 'object' || nodes === null) return null;
  const table = nodes as Record<string, unknown>;
  const nodeOf = (id: unknown): Record<string, unknown> | null => {
    if (typeof id !== 'string') return null;
    const node = table[id];
    return typeof node === 'object' && node !== null ? (node as Record<string, unknown>) : null;
  };
  const issues: string[] = [];
  for (const raw of Object.values(table)) {
    if (typeof raw !== 'object' || raw === null) continue;
    const node = raw as Record<string, unknown>;
    if (node.type === 'instance') {
      const component = nodeOf(node.componentId);
      if (component === null || component.type !== 'component') {
        issues.push(
          `missing-component：实例 ${String(node.id)} 的主组件缺失：${String(node.componentId)}`,
        );
      }
    }
  }
  return issues.length > 0 ? issues : null;
}
