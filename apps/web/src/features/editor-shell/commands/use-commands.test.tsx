// @vitest-environment jsdom
/**
 * `useCommandList` 行为测试（jsdom + @testing-library/react）。
 *
 * 断言可观测行为：注册命令后订阅组件重渲染出新条目；反注册后消失；
 * 且不出现「getSnapshot 返回新引用」导致的无限重渲染（稳定性是 React 契约）。
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { registerCommand, resetCommandRegistry } from './registry';
import { useCommand, useCommandList } from './use-commands';

/** 探针：把命令表渲染成可断言的文本。 */
function Probe({ focusId }: { focusId?: string }) {
  const list = useCommandList();
  const focused = useCommand(focusId ?? '');
  return (
    <ul>
      {list.map((command) => (
        <li key={command.id}>{command.title}</li>
      ))}
      <li data-testid="focused">{`聚焦：${focused?.title ?? '无'}`}</li>
    </ul>
  );
}

afterEach(() => {
  cleanup();
  resetCommandRegistry();
});

describe('useCommandList', () => {
  it('渲染已注册命令，并在注册/反注册时自动更新', () => {
    render(<Probe focusId="a" />);
    expect(screen.queryByText('命令 A')).toBeNull();

    let unregister: () => void = () => undefined;
    act(() => {
      unregister = registerCommand({
        id: 'a',
        title: '命令 A',
        group: '测试',
        run: () => undefined,
      });
    });
    expect(screen.getByText('命令 A')).toBeDefined();
    expect(screen.getByTestId('focused').textContent).toBe('聚焦：命令 A');

    act(() => {
      unregister();
    });
    expect(screen.queryByText('命令 A')).toBeNull();
    expect(screen.getByTestId('focused').textContent).toBe('聚焦：无');
  });
});
