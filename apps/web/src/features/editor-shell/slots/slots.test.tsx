// @vitest-environment jsdom
/**
 * 插槽注册表 + 宿主行为测试。
 *
 * 断言跨票契约（FE-04/05/06/07 挂载所依赖的部分）：注册即可见、按 order 排序、
 * 同 id 覆盖、反注册移除、空槽渲染 fallback。
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { EditorSlotHost } from './host';
import {
  getEditorSlotSnapshot,
  listEditorSlotItems,
  registerEditorSlotItem,
  resetEditorSlots,
  subscribeEditorSlots,
} from './registry';

afterEach(() => {
  cleanup();
  resetEditorSlots();
});

describe('插槽注册表', () => {
  it('注册/反注册条目；反注册幂等', () => {
    const unregister = registerEditorSlotItem('left-panel', {
      id: 'fe-04-layers',
      render: () => null,
    });
    expect(listEditorSlotItems('left-panel').map((item) => item.id)).toEqual(['fe-04-layers']);

    unregister();
    unregister();
    expect(listEditorSlotItems('left-panel')).toEqual([]);
  });

  it('按 order 升序排序；同 order 保持注册顺序', () => {
    registerEditorSlotItem('toolbar', { id: 'b', order: 10, render: () => null });
    registerEditorSlotItem('toolbar', { id: 'a', order: -5, render: () => null });
    registerEditorSlotItem('toolbar', { id: 'c', order: 10, render: () => null });
    expect(listEditorSlotItems('toolbar').map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('同槽同 id 覆盖，位置不跳（热重载友好）', () => {
    registerEditorSlotItem('canvas', { id: 'fe-06-canvas', render: () => null });
    registerEditorSlotItem('canvas', { id: 'fe-07-other', render: () => null });
    registerEditorSlotItem('canvas', { id: 'fe-06-canvas', render: () => null });

    expect(listEditorSlotItems('canvas').map((item) => item.id)).toEqual([
      'fe-06-canvas',
      'fe-07-other',
    ]);
  });

  it('list 返回快照副本，改动不污染注册表', () => {
    registerEditorSlotItem('overlays', { id: 'a', render: () => null });
    const snapshot = listEditorSlotItems('overlays');
    snapshot.length = 0;
    expect(listEditorSlotItems('overlays')).toHaveLength(1);
  });

  it('getEditorSlotSnapshot 引用稳定（React 快照契约）', () => {
    expect(getEditorSlotSnapshot('right-panel')).toBe(getEditorSlotSnapshot('right-panel'));
    const before = getEditorSlotSnapshot('right-panel');
    registerEditorSlotItem('right-panel', { id: 'a', render: () => null });
    expect(getEditorSlotSnapshot('right-panel')).not.toBe(before);
  });

  it('订阅者在注册/反注册时收到通知', () => {
    let calls = 0;
    const unsubscribe = subscribeEditorSlots(() => {
      calls += 1;
    });
    const unregister = registerEditorSlotItem('toolbar', { id: 'a', render: () => null });
    unregister();
    unsubscribe();
    expect(calls).toBe(2);
  });
});

describe('EditorSlotHost', () => {
  it('渲染注册项（按 order），空槽渲染 fallback', () => {
    render(
      <EditorSlotHost slot="left-panel" fallback={<span>空槽兜底</span>} />,
    );
    expect(screen.getByText('空槽兜底')).toBeDefined();

    act(() => {
      registerEditorSlotItem('left-panel', {
        id: 'panel-later',
        order: 5,
        render: () => <span>后注册</span>,
      });
      registerEditorSlotItem('left-panel', {
        id: 'panel-first',
        order: 1,
        render: () => <span>先注册</span>,
      });
    });
    const host = screen.getByText('先注册').parentElement;
    expect(host?.textContent).toBe('先注册后注册');
    expect(screen.queryByText('空槽兜底')).toBeNull();
  });
});
