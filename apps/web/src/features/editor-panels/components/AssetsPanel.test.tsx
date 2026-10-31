// @vitest-environment jsdom
/**
 * 资产面板组件测试（seam：分段/搜索/卡片/令牌列表与四种状态的可观测行为）。
 *
 * 样式单轨（工单 06）：原读 `style` 的断言改为类挂载 + editor-panels.css 规则文本
 * （External CSS 在 jsdom 不计算，先例 verify/a11y-keyboard.test.tsx）。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createFixtureSession, manyLayersDocument } from '../test-utils';
import { AssetsPanel } from './AssetsPanel';
import { PanelsProvider } from './panels-context';

/** 渲染资产面板并切到 Token 分段（令牌添加入口用例的公共前置）。 */
function renderTokensSegment(session = createFixtureSession()) {
  render(
    <PanelsProvider session={session}>
      <AssetsPanel />
    </PanelsProvider>,
  );
  fireEvent.click(screen.getByRole('radio', { name: 'Token' }));
  return { session };
}

/** 渲染资产面板（默认夹具：1 个主组件 + 3 个令牌）。 */
function renderAssets(
  options: { loading?: boolean; error?: string | null; onRetry?: () => void } = {},
) {
  const session = createFixtureSession();
  render(
    <PanelsProvider session={session}>
      <AssetsPanel {...options} />
    </PanelsProvider>,
  );
  return { session };
}

describe('资产面板', () => {
  it('默认「组件」分段：渲染组件卡（名称 + 实例数），卡片是按钮且带取样属性', () => {
    renderAssets();
    expect(screen.getByRole('radiogroup', { name: '资产分段' })).toBeTruthy();
    const card = screen.getByRole('button', { name: '按钮' });
    expect(card.getAttribute('data-df-asset-component')).toBe('c1');
    expect(screen.getByText('0 个实例')).toBeTruthy();
    expect(
      document.querySelector('[data-df-panel="assets"]')?.getAttribute('data-df-segment'),
    ).toBe('components');
  });

  it('切到「Token」分段：列出令牌（别名已解析成字面值），点回「组件」再变回来', () => {
    renderAssets();
    fireEvent.click(screen.getByRole('radio', { name: 'Token' }));
    expect(document.querySelector('[data-df-asset-token="color.brand.primary"]')).not.toBeNull();
    // 别名 onPrimary 解析到 primary 的值
    const aliasRow = document.querySelector('[data-df-asset-token="color.brand.onPrimary"]');
    expect(aliasRow?.textContent).toContain('#0D99FF');
    // 非颜色令牌不带色块着色
    const dimension = document.querySelector('[data-df-asset-token="space.md"]');
    expect(dimension?.querySelector('[data-df-token-swatch="plain"]')).not.toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: '组件' }));
    expect(screen.getByRole('button', { name: '按钮' })).toBeTruthy();
  });

  it('点组件卡 → 写入选择集（与画布同源）并标记 aria-pressed', () => {
    const { session } = renderAssets();
    fireEvent.click(screen.getByRole('button', { name: '按钮' }));
    expect(session.ui.getState().selection).toEqual({ ids: ['c1'], activeId: 'c1' });
    expect(screen.getByRole('button', { name: '按钮' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('搜索过滤：命中保留、无果给「没有匹配的资产」挂点；清空后恢复', () => {
    renderAssets();
    const search = screen.getByPlaceholderText('搜索资产');
    fireEvent.change(search, { target: { value: '按' } });
    expect(screen.getByRole('button', { name: '按钮' })).toBeTruthy();

    fireEvent.change(search, { target: { value: '不存在的东西' } });
    expect(screen.queryByRole('button', { name: '按钮' })).toBeNull();
    expect(screen.getByText('没有匹配的资产')).toBeTruthy();
    expect(document.querySelector('[data-df-sample="assets/no-results"]')).not.toBeNull();

    fireEvent.change(search, { target: { value: '' } });
    expect(screen.getByRole('button', { name: '按钮' })).toBeTruthy();
  });

  it('无组件空态：没有主组件的文档给空态文案与挂点', () => {
    const session = createFixtureSession(manyLayersDocument(3));
    render(
      <PanelsProvider session={session}>
        <AssetsPanel />
      </PanelsProvider>,
    );
    expect(screen.getByText('还没有组件')).toBeTruthy();
    expect(document.querySelector('[data-df-sample="assets/empty"]')).not.toBeNull();
  });

  it('无令牌空态：文档没有设计令牌时 Token 分段给专属空态', () => {
    const session = createFixtureSession(manyLayersDocument(2));
    render(
      <PanelsProvider session={session}>
        <AssetsPanel />
      </PanelsProvider>,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Token' }));
    expect(screen.getByText('还没有设计令牌')).toBeTruthy();
    expect(document.querySelector('[data-df-sample="assets/tokens-empty"]')).not.toBeNull();
  });

  it('加载态与错误态：骨架挂点 / 错误挂点 + 重试回调', () => {
    const onRetry = vi.fn();
    const { unmount } = render(
      <PanelsProvider session={createFixtureSession()}>
        <AssetsPanel loading />
      </PanelsProvider>,
    );
    expect(document.querySelector('[data-df-sample="assets/loading"]')).not.toBeNull();
    unmount();

    render(
      <PanelsProvider session={createFixtureSession()}>
        <AssetsPanel error="加载失败" onRetry={onRetry} />
      </PanelsProvider>,
    );
    expect(document.querySelector('[data-df-sample="assets/error"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('组件卡颜色：缩略图挂类，组件紫令牌由 CSS 规则承接（样式单轨，工单 06）', () => {
    renderAssets();
    const card = screen.getByRole('button', { name: '按钮' });
    const thumb = card.querySelector('[aria-hidden="true"]') as HTMLElement;
    // External CSS 在 jsdom 不计算：断言类挂载 + editor-panels.css 的规则文本
    expect(thumb.className).toContain('dfg-panels__asset-thumb');
    const css = readFileSync(
      resolve(process.cwd(), 'src/features/editor-panels/editor-panels.css'),
      'utf8',
    );
    const at = css.indexOf('.dfg-panels__asset-thumb {');
    expect(at).toBeGreaterThanOrEqual(0);
    expect(css.slice(at, css.indexOf('}', at))).toContain('var(--dfg-color-component)');
  });

  it('面板边界与语义：具名 region「资产」（截图门禁按面板边界取样）', () => {
    renderAssets();
    expect(screen.getByRole('region', { name: '资产' })).toBeTruthy();
  });
});

describe('资产面板 · Token 添加入口（票 14）', () => {
  it('Token 分段出现「添加令牌」入口；组件分段维持现状（不出现）', () => {
    renderAssets();
    expect(screen.queryByRole('button', { name: '添加令牌' })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Token' }));
    expect(screen.getByRole('button', { name: '添加令牌' })).not.toBeNull();
    expect(document.querySelector('[data-df-asset-panel-token-add="open"]')).not.toBeNull();
  });

  it('点开表单填写名称与值，提交后令牌入文档数据并出现在列表（走命令栈）', () => {
    const { session } = renderTokensSegment();
    fireEvent.click(screen.getByRole('button', { name: '添加令牌' }));
    expect(document.querySelector('[data-df-asset-token-add-form="open"]')).not.toBeNull();

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'color.brand.secondary' } });
    fireEvent.change(screen.getByLabelText('值'), { target: { value: '#0069D1' } });
    fireEvent.click(screen.getByRole('button', { name: '添加' }));

    const brand = session.stack.document.tokens.color as {
      brand?: Record<string, { $value: string; $type?: string }>;
    };
    expect(brand.brand?.secondary?.$value).toBe('#0069D1');
    expect(brand.brand?.secondary?.$type).toBe('color');
    // 列表即时出现新行（文档真值经订阅刷新），表单收起
    expect(document.querySelector('[data-df-asset-token="color.brand.secondary"]')).not.toBeNull();
    expect(document.querySelector('[data-df-asset-token-add-form="open"]')).toBeNull();
  });

  it('空态消失：无令牌文档经入口添加第一个令牌后，专属空态消失、列表呈现', () => {
    renderTokensSegment(createFixtureSession(manyLayersDocument(2)));
    expect(screen.getByText('还没有设计令牌')).toBeTruthy();
    expect(document.querySelector('[data-df-sample="assets/tokens-empty"]')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '添加令牌' }));
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'elevation.card' } });
    fireEvent.change(screen.getByLabelText('值'), { target: { value: '4px' } });
    fireEvent.change(screen.getByLabelText('类型'), { target: { value: 'dimension' } });
    fireEvent.click(screen.getByRole('button', { name: '添加' }));

    expect(screen.queryByText('还没有设计令牌')).toBeNull();
    expect(document.querySelector('[data-df-sample="assets/tokens-empty"]')).toBeNull();
    expect(document.querySelector('[data-df-asset-token="elevation.card"]')).not.toBeNull();
  });

  it('重名提交被拒：分因提示（duplicate）+ 文档不变', () => {
    const { session } = renderTokensSegment();
    fireEvent.click(screen.getByRole('button', { name: '添加令牌' }));
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'color.brand.primary' } });
    fireEvent.click(screen.getByRole('button', { name: '添加' }));

    expect(screen.getByText('已有同名令牌或分组')).toBeTruthy();
    expect(document.querySelector('[data-df-asset-token-add-error="duplicate"]')).not.toBeNull();
    // 文档未被写入（面板只构造命令，非法时无命令）
    const brand = session.stack.document.tokens.color as {
      brand?: Record<string, unknown>;
    };
    expect(Object.keys(brand.brand ?? {}).sort()).toEqual(['onPrimary', 'primary']);
  });

  it('非法字符提交被拒：分因提示（illegal-char），改合法后提示消失并可提交', () => {
    const { session } = renderTokensSegment();
    fireEvent.click(screen.getByRole('button', { name: '添加令牌' }));
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'my token' } });
    fireEvent.click(screen.getByRole('button', { name: '添加' }));

    expect(screen.getByText('名称含非法字符：分段不能为空，段内不能有空格或花括号')).toBeTruthy();
    expect(document.querySelector('[data-df-asset-token-add-error="illegal-char"]')).not.toBeNull();

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'my-token' } });
    fireEvent.change(screen.getByLabelText('值'), { target: { value: '#101010' } });
    expect(screen.queryByText('名称含非法字符：分段不能为空，段内不能有空格或花括号')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '添加' }));
    expect(document.querySelector('[data-df-asset-token="my-token"]')).not.toBeNull();
    expect(session.stack.document.tokens['my-token']).toBeTruthy();
  });

  it('添加与图层操作同等级可撤销：撤销后令牌离开文档数据，列表退回', () => {
    const { session } = renderTokensSegment();
    fireEvent.click(screen.getByRole('button', { name: '添加令牌' }));
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'space.lg' } });
    fireEvent.click(screen.getByRole('button', { name: '添加' }));
    expect(document.querySelector('[data-df-asset-token="space.lg"]')).not.toBeNull();

    // 撤销在 React 事件外直接调命令栈：act 包一层让订阅触发的重渲染同步冲刷
    act(() => {
      expect(session.stack.undo()).toBe(true);
    });
    expect(document.querySelector('[data-df-asset-token="space.lg"]')).toBeNull();
    expect(session.stack.document.tokens['space.lg']).toBeUndefined();
  });

  it('取消收起表单：不写入文档', () => {
    const { session } = renderTokensSegment();
    const before = session.stack.document.tokens;
    fireEvent.click(screen.getByRole('button', { name: '添加令牌' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(document.querySelector('[data-df-asset-token-add-form="open"]')).toBeNull();
    expect(session.stack.document.tokens).toBe(before);
  });
});

describe('资产面板 · Token 行内管理（票 14 管理半缺：删除/改值）', () => {
  it('每个令牌行带编辑值/删除动作挂点（图标钮 + aria 名）', () => {
    renderTokensSegment();
    expect(
      document.querySelector('[data-df-asset-token-edit="color.brand.primary"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-df-asset-token-delete="color.brand.primary"]'),
    ).not.toBeNull();
    // 夹具三行各一组动作
    expect(screen.getAllByRole('button', { name: '编辑值' })).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: '删除令牌' })).toHaveLength(3);
  });

  it('删除：命令栈单事务入档，行即离开文档数据与列表；撤销恢复', () => {
    const { session } = renderTokensSegment();
    const row = document.querySelector('[data-df-asset-token="color.brand.primary"]');
    expect(row).not.toBeNull();
    const deleteBtn = row?.querySelector('[data-df-asset-token-delete]');
    expect(deleteBtn).not.toBeNull();
    fireEvent.click(deleteBtn as HTMLElement);

    // primary 消失；同组的 onPrimary（别名兄弟行）不受牵连
    const brand = (
      session.stack.document.tokens.color as {
        brand: Record<string, { $value: string } | undefined>;
      }
    ).brand;
    expect(brand.primary).toBeUndefined();
    expect(brand.onPrimary).toBeDefined();
    expect(document.querySelector('[data-df-asset-token="color.brand.primary"]')).toBeNull();

    act(() => {
      expect(session.stack.undo()).toBe(true);
    });
    // 撤销后文档是新快照：重读再断言 primary 回来了
    const brandAfterUndo = (
      session.stack.document.tokens.color as {
        brand: Record<string, { $value: string } | undefined>;
      }
    ).brand;
    expect(brandAfterUndo.primary).toBeDefined();
    expect(document.querySelector('[data-df-asset-token="color.brand.primary"]')).not.toBeNull();
  });

  it('改值：进编辑态预填原始 $value（别名串不预解析），保存后 $value 更新、$type 沿用', () => {
    const { session } = renderTokensSegment();
    const row = document.querySelector('[data-df-asset-token="color.brand.onPrimary"]');
    const editBtn = row?.querySelector('[data-df-asset-token-edit]');
    expect(editBtn).not.toBeNull();
    fireEvent.click(editBtn as HTMLElement);

    const form = document.querySelector('[data-df-asset-token-edit-form="color.brand.onPrimary"]');
    expect(form).not.toBeNull();
    // 原始 $value 是别名串（未预解析）——用户改的是文档数据
    const input = screen.getByLabelText('新值') as HTMLInputElement;
    expect(input.value).toBe('{color.brand.primary}');

    fireEvent.change(input, { target: { value: '{space.md}' } });
    fireEvent.submit(form as HTMLElement);

    const onPrimary = (
      session.stack.document.tokens.color as {
        brand: Record<string, { $value: string } | undefined>;
      }
    ).brand.onPrimary;
    expect(onPrimary?.$value).toBe('{space.md}');
    // 编辑态退出，解析视图反映新别名（onPrimary 现在解析到 space.md 的字面值）
    expect(document.querySelector('[data-df-asset-token-edit-form]')).toBeNull();
    expect(
      document.querySelector('[data-df-asset-token="color.brand.onPrimary"]')?.textContent,
    ).toContain('16');
  });

  it('改值空提交被拒：不写文档，行内非法态提示；取消退出不写', () => {
    const { session } = renderTokensSegment();
    const row = document.querySelector('[data-df-asset-token="space.md"]');
    fireEvent.click(row?.querySelector('[data-df-asset-token-edit]') as HTMLElement);
    const form = document.querySelector('[data-df-asset-token-edit-form="space.md"]');
    const before = session.stack.document.tokens;

    // 清空预填值再提交：空值被拒（非法态），文档不动
    fireEvent.change(screen.getByLabelText('新值'), { target: { value: '' } });
    fireEvent.submit(form as HTMLElement);
    expect((screen.getByLabelText('新值') as HTMLInputElement).getAttribute('aria-invalid')).toBe(
      'true',
    );
    expect(session.stack.document.tokens).toBe(before);

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(document.querySelector('[data-df-asset-token-edit-form]')).toBeNull();
    expect((session.stack.document.tokens.space as { md: { $value: string } }).md.$value).toBe(
      '16',
    );
  });
});
