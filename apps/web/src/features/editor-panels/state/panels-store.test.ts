/**
 * 面板 UI store 测试（seam：store 的公开动作与可观测状态）。
 *
 * 为什么测这个 seam：面板的一切 UI 态（选择集、展开/收起、重命名目标、资产分段与搜索词）
 * 都住在这里，画布（FE-06）与面板（本票）读**同一来源**才谈得上同源联动；
 * 这里断言的是外部可见的状态转移，不碰任何内部实现细节。
 */
import { describe, expect, it, vi } from 'vitest';

import { createPanelsUiStore } from './panels-store';

describe('面板 UI store', () => {
  it('初始态：无选择、默认全部展开（折叠集为空）、资产分段为「组件」、搜索词为空', () => {
    const store = createPanelsUiStore();
    const state = store.getState();
    expect(state.selection).toEqual({ ids: [], activeId: null });
    expect(state.collapsedIds.size).toBe(0);
    expect(state.renamingId).toBeNull();
    expect(state.assetSegment).toBe('components');
    expect(state.assetQuery).toBe('');
  });

  it('点击图层：单击单选替换；Shift 点击追加与再次点击移除（引擎选择模型语义）', () => {
    const store = createPanelsUiStore();
    store.getState().selectLayer('n1');
    expect(store.getState().selection).toEqual({ ids: ['n1'], activeId: 'n1' });

    store.getState().selectLayer('n2');
    expect(store.getState().selection).toEqual({ ids: ['n2'], activeId: 'n2' });

    store.getState().selectLayer('n1', { shift: true });
    expect(store.getState().selection.ids).toEqual(['n2', 'n1']);

    store.getState().selectLayer('n1', { shift: true });
    expect(store.getState().selection.ids).toEqual(['n2']);
  });

  it('点击空白（null）清空选择', () => {
    const store = createPanelsUiStore();
    store.getState().selectLayer('n1');
    store.getState().selectLayer(null);
    expect(store.getState().selection).toEqual({ ids: [], activeId: null });
  });

  it('setSelection 直接替换（画布框选 → 面板高亮走这条）', () => {
    const store = createPanelsUiStore();
    store.getState().setSelection({ ids: ['a', 'b'], activeId: 'b' });
    expect(store.getState().selection).toEqual({ ids: ['a', 'b'], activeId: 'b' });
  });

  it('展开/收起往返：默认展开，收起后记入折叠集，再切回展开', () => {
    const store = createPanelsUiStore();
    store.getState().toggleCollapsed('f1');
    expect([...store.getState().collapsedIds]).toEqual(['f1']);
    expect(store.getState().collapsedIds.has('f1')).toBe(true);

    store.getState().toggleCollapsed('f1');
    expect(store.getState().collapsedIds.has('f1')).toBe(false);
  });

  it('重命名目标：beginRename 进入、endRename 退出（取消不改任何文档）', () => {
    const store = createPanelsUiStore();
    store.getState().beginRename('n1');
    expect(store.getState().renamingId).toBe('n1');
    store.getState().endRename();
    expect(store.getState().renamingId).toBeNull();
  });

  it('资产分段与搜索词：可分别设置，互不牵连', () => {
    const store = createPanelsUiStore();
    store.getState().setAssetSegment('tokens');
    store.getState().setAssetQuery('品牌');
    expect(store.getState().assetSegment).toBe('tokens');
    expect(store.getState().assetQuery).toBe('品牌');
  });

  it('可订阅：状态变更通知订阅者（画布与面板同源的前提）', () => {
    const store = createPanelsUiStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.getState().selectLayer('n1');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.getState().selectLayer('n2');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('同值写入不产生新状态对象（避免无谓重渲染）', () => {
    const store = createPanelsUiStore();
    const before = store.getState();
    store.getState().selectLayer(null);
    expect(store.getState()).toBe(before);
  });
});
