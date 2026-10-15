/**
 * Inspector 测试夹具（仅供本 feature 的测试使用，不进公开面）。
 *
 * 夹具与 `preview.ts` 的预览文档同构：同一组节点让 jsdom 断言与浏览器门禁
 * 看到同样的三态（默认/混选/空选），避免「测试绿而门禁红」的口径漂移。
 */

import {
  CommandStack,
  type CommandStackOptions,
  createDocument,
  createFrame,
  createPage,
  createRect,
  createSelection,
  createText,
  type DesignDocument,
  defaultTextContent,
  type ScenePage,
  type Selection,
  solidPaint,
} from '@dforge/engine';

/** 固定页面 id。 */
export const FIXTURE_PAGE_ID = 'p1';

/** 预览/测试共用的固定文档。 */
export function fixtureDocument(): DesignDocument {
  return createDocument({
    id: 'doc_inspector',
    name: 'Inspector 夹具',
    pages: [fixturePage()],
  });
}

/** 夹具页面：三形状（x 不同）+ 文本 + 自动布局画板 + 空画板。 */
export function fixturePage(): ScenePage {
  const r1 = createRect({
    id: 'r1',
    x: 10,
    y: 20,
    width: 100,
    height: 50,
    fills: [solidPaint('#111111', 0.5)], // guard-tokens:allow 文档数据色，非界面令牌
  });
  const r2 = createRect({
    id: 'r2',
    x: 200,
    y: 20,
    width: 100,
    height: 50,
    fills: [solidPaint('#222222')], // guard-tokens:allow 文档数据色，非界面令牌
    strokes: [{ paint: solidPaint('#000000'), width: 3, align: 'inside' }], // guard-tokens:allow 文档数据色，非界面令牌
  });
  const r3 = createRect({ id: 'r3', x: 400, y: 20, width: 100, height: 50 });
  const t1 = createText({
    id: 't1',
    text: { ...defaultTextContent('设界'), fontSize: 16, align: 'center' }, // guard-tokens:allow fontSize 是文档数据（Design IR 文本真值）
  });
  const c1 = createRect({ id: 'c1', x: 0, y: 0, width: 40, height: 20 });
  const c2 = createRect({ id: 'c2', x: 0, y: 40, width: 40, height: 20 });
  const f1 = createFrame({
    id: 'f1',
    name: '自动布局画板',
    width: 300,
    height: 200,
    children: ['c1', 'c2'],
  });
  const f2 = createFrame({ id: 'f2', name: '空画板', width: 320, height: 240 });
  return createPage({
    id: FIXTURE_PAGE_ID,
    name: '主页面',
    nodes: { r1, r2, r3, t1, c1, c2, f1, f2 },
    rootIds: ['r1', 'r2', 'r3', 't1', 'f1', 'f2'],
    backgroundColor: '#F5F5F5', // guard-tokens:allow 文档数据色，非界面令牌
  });
}

/** 构造夹具命令栈。 */
export function fixtureStack(options: CommandStackOptions = {}): CommandStack {
  return new CommandStack(fixtureDocument(), options);
}

/** 便捷选择集。 */
export function selectionOf(ids: readonly string[], activeId?: string): Selection {
  return createSelection(ids, activeId);
}
