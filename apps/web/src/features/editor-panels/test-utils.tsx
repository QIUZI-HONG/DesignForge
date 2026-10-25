/**
 * 面板测试装配（工单 02 起自管，避免改 apps/web 的共享 vitest 配置）。
 *
 * - RTL 自动清理：vitest 未开 `globals`，RTL 不会自动 cleanup，此处显式在 afterEach 卸载；
 * - `stubRowRects`：jsdom 不做布局（所有 `getBoundingClientRect` 都是 0），
 *   拖拽落位测试需要真实几何——按 DOM 顺序给 Tree 行（`data-node-id`，RW-13 契约）
 *   合成「行高 × 序号」的矩形；
 * - 夹具：一份带画板/编组/组件/令牌的文档，供组件测试直接挂载。
 */
import {
  createComponent,
  createDocument,
  createFrame,
  createGroup,
  createPage,
  createRect,
  type DesignDocument,
  insertNode,
  insertNodes,
} from '@dforge/engine';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

import { createPanelsSession, type PanelsSession } from './session';

afterEach(() => {
  cleanup();
});

/** 行高（与令牌 `--dfg-row-height-md` 的深色档一致）。 */
export const ROW_HEIGHT = 28;

/**
 * 给 Tree 行合成矩形（其余元素仍走真实实现）。
 * 返回值是还原函数。
 */
export function stubRowRects(height: number = ROW_HEIGHT): () => void {
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function getBoundingClientRectStub(this: Element) {
    if (this instanceof HTMLElement && this.dataset.nodeId !== undefined) {
      const siblings = Array.from(document.querySelectorAll('[data-node-id]'));
      const index = siblings.indexOf(this);
      const top = index * height;
      const rect = {
        x: 0,
        y: top,
        top,
        bottom: top + height,
        left: 0,
        right: 240,
        width: 240,
        height,
        toJSON: () => ({}),
      };
      return rect as DOMRect;
    }
    return original.call(this);
  };
  return () => {
    Element.prototype.getBoundingClientRect = original;
  };
}

/**
 * 面板夹具。
 *
 * 页面结构（绘制顺序，后面的在上）：
 * 顶层 [f1 画板 ⊃ [r1, r2, g1 编组 ⊃ [t1]]，f2 空画板，c1 主组件 ⊃ [cr1]]
 * 令牌：color.brand.primary（组件蓝）、space.md（尺寸）、color.brand.onPrimary（别名）
 */
export function panelsFixture(): DesignDocument {
  let doc = createDocument({
    id: 'doc-fixture',
    name: '面板夹具',
    pages: [createPage({ id: 'p1' })],
    tokens: {
      color: {
        brand: {
          // 颜色字面值是**文档夹具数据**（引擎令牌形状），不是组件样式；组件样式禁裸值由 guard-tokens 守卫
          primary: { $type: 'color', $value: '#0D99FF' } /* guard-tokens:allow 夹具的文档数据 */,
          onPrimary: { $type: 'color', $value: '{color.brand.primary}' },
        },
      },
      space: { md: { $type: 'dimension', $value: '16' } },
    },
  });
  doc = insertNode(
    doc,
    'p1',
    createFrame({ id: 'f1', name: '首屏', width: 200, height: 200 }),
    null,
  );
  doc = insertNodes(
    doc,
    'p1',
    [
      createRect({ id: 'r1', name: '背景块', width: 50, height: 50 }),
      createRect({ id: 'r2', name: '卡片', x: 70, width: 50, height: 50 }),
      createGroup({ id: 'g1', name: '标题组', width: 40, height: 20 }),
    ],
    'f1',
  );
  doc = insertNode(doc, 'p1', createRect({ id: 't1', name: '标题', width: 40, height: 20 }), 'g1');
  doc = insertNode(
    doc,
    'p1',
    createFrame({ id: 'f2', name: '第二屏', x: 400, width: 100, height: 100 }),
    null,
  );
  doc = insertNode(
    doc,
    'p1',
    createComponent({ id: 'c1', name: '按钮', x: 0, y: 300, width: 100, height: 40 }),
    null,
  );
  doc = insertNode(
    doc,
    'p1',
    createRect({ id: 'cr1', name: '底板', width: 100, height: 40 }),
    'c1',
  );
  return doc;
}

/** 长列表夹具：`count` 个顶层矩形（千级验证渲染窗口化路径）。 */
export function manyLayersDocument(count: number): DesignDocument {
  let doc = createDocument({ id: 'doc-many', pages: [createPage({ id: 'p1' })] });
  const nodes = Array.from({ length: count }, (_, index) =>
    createRect({
      id: `n${String(index)}`,
      name: `图层 ${String(index)}`,
      x: index * 2,
      width: 10,
      height: 10,
    }),
  );
  doc = insertNodes(doc, 'p1', nodes, null);
  return doc;
}

/** 建面板会话（夹具文档 + 冻结文档：任何绕过命令栈的就地写入都会当场抛错）。 */
export function createFixtureSession(document: DesignDocument = panelsFixture()): PanelsSession {
  return createPanelsSession({ document, freeze: true });
}
