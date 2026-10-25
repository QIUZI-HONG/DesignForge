/**
 * Tabs / TabPanel / Collapse 行为测试（RW-07 · 页签与折叠面板）。
 *
 * 断言角度（验收标准 §2 + §5，对应总纲 R-4「Tab/折叠面板」）：tab/tablist 语义与
 * 双向关联、方向键漫游（跳过禁用页签）、折叠面板的开合与受控、禁用原因提示——
 * 只测可观测行为。
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Collapse } from './Collapse';
import { TabPanel, Tabs } from './Tabs';

const tabs = [
  { id: 'design', label: '设计' },
  { id: 'export', label: '导出' },
  { id: 'ai', label: 'AI 助手', disabled: true, disabledReason: 'AI 助手暂不可用' },
];

function renderTabs(value: string, onChange: (id: string) => void): void {
  render(
    <Tabs label="检查器" tabs={tabs} value={value} onChange={onChange}>
      <TabPanel tab="design">设计内容</TabPanel>
      <TabPanel tab="export">导出内容</TabPanel>
    </Tabs>,
  );
}

describe('Tabs / TabPanel', () => {
  it('tablist/tab 语义：选中态、roving tabindex、aria-controls 双向关联', () => {
    renderTabs('design', () => {});
    const designTab = screen.getByRole('tab', { name: '设计' });
    expect(screen.getByRole('tablist', { name: '检查器' })).toBeTruthy();
    expect(designTab.getAttribute('aria-selected')).toBe('true');
    expect(designTab.getAttribute('tabindex')).toBe('0');
    expect(screen.getByRole('tab', { name: '导出' }).getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('tab', { name: '导出' }).getAttribute('tabindex')).toBe('-1');

    // 页签 → 面板（aria-controls）、面板 → 页签（aria-labelledby）
    const panelId = designTab.getAttribute('aria-controls');
    expect(panelId).not.toBeNull();
    const panel = document.getElementById(panelId as string);
    expect(panel?.getAttribute('role')).toBe('tabpanel');
    expect(panel?.textContent).toContain('设计内容');
    expect(panel?.getAttribute('aria-labelledby')).toBe(designTab.id);
    // 未选中的面板隐藏（DOM 保留，不卸载）
    const exportTab = screen.getByRole('tab', { name: '导出' });
    const exportPanel = document.getElementById(exportTab.getAttribute('aria-controls') as string);
    expect(exportPanel?.getAttribute('hidden')).not.toBeNull();
  });

  it('点击切换选中；禁用页签不可选（aria-disabled，不吞提示）', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderTabs('design', onChange);
    await user.click(screen.getByRole('tab', { name: '导出' }));
    expect(onChange).toHaveBeenCalledWith('export');
    onChange.mockClear();
    const disabledTab = screen.getByRole('tab', { name: 'AI 助手' });
    expect(disabledTab.getAttribute('aria-disabled')).toBe('true');
    await user.click(disabledTab);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('方向键漫游并自动激活，跳过禁用页签', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <Tabs label="检查器" tabs={tabs} value="design" onChange={onChange}>
        <TabPanel tab="design">设计内容</TabPanel>
        <TabPanel tab="export">导出内容</TabPanel>
      </Tabs>,
    );
    screen.getByRole('tab', { name: '设计' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('export');

    rerender(
      <Tabs label="检查器" tabs={tabs} value="export" onChange={onChange}>
        <TabPanel tab="design">设计内容</TabPanel>
        <TabPanel tab="export">导出内容</TabPanel>
      </Tabs>,
    );
    // 焦点跟到新选中页签；继续右行跳过禁用的 AI 助手回环到「设计」
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '导出' }));
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('design');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '设计' }));
    // 受控契约：激活回调由调用方落回 value——漫游起点取受控 value（不是焦点所在页签）
    rerender(
      <Tabs label="检查器" tabs={tabs} value="design" onChange={onChange}>
        <TabPanel tab="design">设计内容</TabPanel>
        <TabPanel tab="export">导出内容</TabPanel>
      </Tabs>,
    );
    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith('export');
  });

  it('禁用原因经提示给出（悬停可见）', async () => {
    const user = userEvent.setup();
    renderTabs('design', () => {});
    await user.hover(screen.getByRole('tab', { name: 'AI 助手' }));
    expect((await screen.findByRole('tooltip')).textContent).toContain('AI 助手暂不可用');
  });

  it('面板随选中切换显示', () => {
    renderTabs('export', () => {});
    const exportTab = screen.getByRole('tab', { name: '导出' });
    const exportPanel = document.getElementById(exportTab.getAttribute('aria-controls') as string);
    const designTab = screen.getByRole('tab', { name: '设计' });
    const designPanel = document.getElementById(designTab.getAttribute('aria-controls') as string);
    expect(exportPanel?.getAttribute('hidden')).toBeNull();
    expect(designPanel?.getAttribute('hidden')).not.toBeNull();
  });
});

describe('Collapse（折叠面板）', () => {
  it('默认收起：点击展开、再点收起，aria-expanded/hidden 同步', async () => {
    const user = userEvent.setup();
    render(
      <Collapse title="填充">
        <p>填充设置内容</p>
      </Collapse>,
    );
    const trigger = screen.getByRole('button', { name: '填充' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    const content = document.getElementById(trigger.getAttribute('aria-controls') as string);
    expect(content?.getAttribute('hidden')).not.toBeNull();

    await user.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(content?.getAttribute('hidden')).toBeNull();

    await user.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(content?.getAttribute('hidden')).not.toBeNull();
  });

  it('受控模式：开关回调上报目标态', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const { rerender } = render(
      <Collapse title="描边" open={false} onToggle={onToggle}>
        内容
      </Collapse>,
    );
    const trigger = screen.getByRole('button', { name: '描边' });
    await user.click(trigger);
    expect(onToggle).toHaveBeenCalledWith(true);
    // 调用方未跟随则保持收起
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    rerender(
      <Collapse title="描边" open onToggle={onToggle}>
        内容
      </Collapse>,
    );
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('禁用：不可展开', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <Collapse title="效果" disabled onToggle={onToggle}>
        内容
      </Collapse>,
    );
    const trigger = screen.getByRole('button', { name: '效果' }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    await user.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('defaultOpen 初始展开', () => {
    render(
      <Collapse title="布局" defaultOpen>
        内容
      </Collapse>,
    );
    expect(screen.getByRole('button', { name: '布局' }).getAttribute('aria-expanded')).toBe('true');
  });
});
