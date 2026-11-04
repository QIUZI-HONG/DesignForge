/**
 * 页面参考线（票 12 · spec P2：从标尺拖出的用户辅助线）。
 *
 * 参考线是**页面数据**（随文档保存/加载、可 Git diff），不是视口 UI 态：
 * 轴向语义与吸附层 `SnapGuide` 对齐——`axis: 'x'` = 垂直线（x = position，
 * 从左侧垂直标尺拉出）；`axis: 'y'` = 水平线（y = position，从顶部水平标尺拉出）。
 *
 * 兼容口径：`guides` 字段晚于 v1 文档格式引入，旧序列化产物没有该键；
 * 消费侧一律经 `guidesOf` 读取（运行时缺失 → 空数组），校验侧只在字段存在时校验。
 */

/** 参考线轴向（'x' = 垂直线、'y' = 水平线，与 SnapGuide 同语义）。 */
export type GuideAxis = 'x' | 'y';

/** 页面参考线：一条无限延伸的直线（位置沿 axis 轴）。 */
export interface PageGuide {
  id: string;
  axis: GuideAxis;
  /** 线的位置（世界坐标；axis='x' 时为 x 值、axis='y' 时为 y 值）。 */
  position: number;
}

/** 页面节点的 id 前缀约定（仅用于生成，不参与校验）。 */
export const GUIDE_ID_PREFIX = 'guide';

/** 构造参考线。 */
export function createGuide(init: { id: string; axis: GuideAxis; position: number }): PageGuide {
  return { id: init.id, axis: init.axis, position: init.position };
}

/**
 * 页面参考线读取（旧文档兼容）：运行时缺 `guides` 键返回空数组。
 * 为什么不用 `page.guides ?? []` 散在调用点：旧文档的该字段在 TS 类型上是必填、
 * 运行时却是 undefined——收敛到这一个入口，兼容口径不漂移。
 */
export function guidesOf(page: Pick<ScenePageLike, 'guides'>): readonly PageGuide[] {
  return Array.isArray(page.guides) ? page.guides : [];
}

/** `guidesOf` 的最小结构（避免与 document.ts 循环导入）。 */
interface ScenePageLike {
  guides?: readonly PageGuide[] | undefined;
}
