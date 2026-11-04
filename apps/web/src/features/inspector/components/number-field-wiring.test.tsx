// @vitest-environment jsdom
/**
 * 接线测试（arch-02）：Inspector 的数值输入必须消费 `@dforge/ui` 的 NumberField。
 *
 * 手法：把包入口的 NumberField 换成哨兵组件，其余导出保持真实现；渲染面板后
 * 断言**全部**数值字段都以哨兵出现——若面板内还有一份本地副本，哨兵数量/字段名
 * 集合就对不上。这是「用新 module 而非本地副本」的机器证明。
 */
import {
  CommandStack,
  createDocument,
  createPage,
  createRect,
  createSelection,
} from '@dforge/engine';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@dforge/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dforge/ui')>();
  return {
    ...actual,
    // 哨兵只暴露 fieldName：真实 module 的语义由 packages/ui 的测试覆盖，这里只验接线。
    NumberField: ({ fieldName }: { fieldName: string }) => (
      <span data-testid="ui-number-field" data-field={fieldName} />
    ),
  };
});

import { InspectorPanel } from './InspectorPanel';

describe('Inspector × @dforge/ui NumberField 接线', () => {
  it('设计页的全部数值字段都由包入口的 NumberField 渲染（无本地副本）', () => {
    const rect = createRect({ id: 'n_rect', x: 10, y: 20, width: 100, height: 50 });
    const page = createPage({ id: 'page_1', rootIds: ['n_rect'], nodes: { n_rect: rect } });
    const stack = new CommandStack(createDocument({ id: 'doc_1', pages: [page] }));

    render(
      <InspectorPanel
        stack={stack}
        pageId="page_1"
        selection={createSelection(['n_rect'], 'n_rect')}
      />,
    );

    const fieldNames = screen
      .getAllByTestId('ui-number-field')
      .map((node) => node.getAttribute('data-field'));
    // 单矩形选中态：不透明度 + 尺寸 5 项 + 填充不透明度 + 描边宽度 + 圆角 = 9 处。
    expect(new Set(fieldNames)).toEqual(
      new Set([
        'opacity',
        'x',
        'y',
        'width',
        'height',
        'rotation',
        'fillOpacity',
        'strokeWidth',
        'cornerRadius',
      ]),
    );
  });
});
