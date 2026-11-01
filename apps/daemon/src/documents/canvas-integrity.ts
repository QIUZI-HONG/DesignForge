/**
 * @dforge/daemon · 画布页正文的引用完整性守门（票 17：写读对称校验）。
 *
 * 归属口径：daemon 对正文总体仍是 **opaque JSON** 存储（不解析设计语义）；唯一例外是
 * `dforge.canvas.page` 信封——它是 web 画布的落盘形状，读回侧由引擎 `parseDocument`
 * 全校验（一处悬空引用 = 整份文档不可重开）。写不校验、读全校验 = 「能写不可读」的
 * 锁定路径，因此写侧至少守住引用完整性这一条：实例的 `componentId` 必须指向本页
 * 的主组件节点，主组件的 `componentSetId`（非空时）必须指向本页的组件集节点——
 * 与引擎 `validatePage` 的 **missing-component / missing-component-set 这两条**同码同强度
 * （判定条件逐条对齐，含「`componentSetId !== null` 才检查」这条同款宽松）。
 *
 * **范围口径（复核 SE-3 · 二轮实跑结论，非推断）**：引擎 `scene/validate.ts` 的页面级致命码
 * 共 13 个（missing-root / missing-child / duplicate-child / multiple-parents / orphan-node /
 * cycle / missing-component / missing-component-set / duplicate-page / missing-page /
 * missing-field / non-finite-number / max-depth-exceeded），本守门**只镜像其中 2 条引用码**。
 * 其余 11 类 daemon 对直连写入者（HTTP / MCP / CLI）**不设防**：形状正当的正文带环、孤儿节点、
 * 缺字段、`1e400` 目前照样 PUT=200 落盘，只由引擎**读侧**在 web 载入时报错。web 客户端自己
 * 造不出这些正文（`documents-client.saveDesignDocument` 写前 `validateDocument` 全校验），
 * 所以「两层同源于引擎口径、强度对称」**不是全局承诺**，只对上述两条成立。
 * 补齐到 13 码属扩大覆盖面，留待人工决定（工单 23 · 待人工决定 1），不在本文件静默进行；
 * 边界由 `canvas-integrity.test.ts` 钉住——扩范围必须显式改那些用例。
 *
 * `$format` 绕过也照实写：非本信封正文一律返回 null（维持 opaque 口径，可 200 落盘），
 * 但这条口子**换不来引用完整性锁定**——web 读回侧先以「正文不是设界画布格式」拒收
 * （`documents-client` 的信封守卫），根本走不到引擎的引用校验，文档仍可正常打开。
 */

/** 画布页信封标识（与 web `documents-client.CANVAS_PAGE_FORMAT` 同值——跨包线格式约定）。 */
const CANVAS_PAGE_FORMAT = 'dforge.canvas.page';

/**
 * 问题文案里可安全落名的标识：**只有字符串 id 原样回显**。
 *
 * 复核 SE-1：旧实现无条件 `String(node.id)` / `String(node.componentId)`，而正文是外部
 * 可控 JSON——`{"toString":1}` 这类形状会让 `String()` 抛
 * `TypeError: Cannot convert object to primitive value`，被通用错误面接住成 500，
 * 还把 TypeError 原文回显进 `details.reason`。非字符串一律只报**类型**（不触值、不触
 * `toString`/`valueOf`），既保持拒绝口径，也不把内部信息带进响应。
 */
function labelOfId(id: unknown): string {
  if (typeof id === 'string') return id;
  if (id === null) return '非字符串（null）';
  if (Array.isArray(id)) return '非字符串（array）';
  return `非字符串（${typeof id}）`;
}

/**
 * 检查 `dforge.canvas.page` 正文的引用完整性，返回问题清单（无问题 → null）。
 *
 * 非本信封的正文一律返回 null（维持 opaque 口径，外来格式不受本守门影响）。
 * 返回形状是**字符串清单 / null**：调用方 `store.ts` 直接 `join('；')` 拼进 422 的
 * message，改签名会连带改动 store（另一命名所有权），故此处只增强健壮性不动契约。
 *
 * 不抛的口径说到哪儿为止（三轮 S2 修正，旧注释「任意畸形正文都不得抛」是代码给不了的保证）：
 * 本函数只承诺处理 **JSON.parse 出来的值**——那类值没有访问器、没有 Proxy、属性读不会抛，
 * 而正文的唯一来源就是路由解析后的载荷（`routes/documents.ts` 把 Fastify 解析的 JSON 直接
 * 交给 store）。带 getter/Proxy 的对象不在这个输入域里：真要喂进来，`record.$format` 这一次
 * 属性读就能抛出，而那是调用方违约，不是这里的缺陷——所以不为其包 try（包了反而把
 * 「调用方传了非 JSON 值」这件事吞成静默放行）。测试钉的是解析域内的极端键
 * （`__proto__` / `constructor` / 非对象值），不是解析域外的形状。
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
    if (typeof id !== 'string' || !Object.hasOwn(table, id)) return null;
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
          `missing-component：实例 ${labelOfId(node.id)} 的主组件缺失：${labelOfId(node.componentId)}`,
        );
      }
    }
    if (node.type === 'component' && node.componentSetId !== null) {
      const set = nodeOf(node.componentSetId);
      if (set === null || set.type !== 'component_set') {
        issues.push(
          `missing-component-set：组件 ${labelOfId(node.id)} 的组件集缺失：${labelOfId(node.componentSetId)}`,
        );
      }
    }
  }
  return issues.length > 0 ? issues : null;
}
