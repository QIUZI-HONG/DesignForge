// @vitest-environment jsdom
/**
 * CodeExportPanel（F6 代码导出面板 · 与 C15 同源）规格。
 *
 * 断言：分档切换（CSS / React）改变代码区内容、复制按钮走注入的剪贴板并给成功/失败反馈、
 * 令牌说明区给出「令牌 → CSS 变量」与「未绑定令牌 → 原始值」两类条目。
 */

import type { ScenePage, TokenSet } from '@dforge/engine';
import { ToastProvider } from '@dforge/ui';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  INSPECT_IDS,
  inspectPage,
  inspectTokens,
  TOKEN_VALUES,
  UNBOUND_FILL,
} from '../testing/fixtures';
import { CodeExportPanel } from './CodeExportPanel';

/** 渲染（含 ToastProvider：复制反馈走 F11 Toast）。 */
function setup(nodeId: string, copyText?: (text: string) => Promise<void>) {
  const page: ScenePage = inspectPage();
  const tokens: TokenSet = inspectTokens();
  const view = render(
    <ToastProvider>
      <CodeExportPanel
        page={page}
        nodeId={nodeId}
        tokens={tokens}
        {...(copyText === undefined ? {} : { copyText })}
      />
    </ToastProvider>,
  );
  return { page, tokens, view };
}

/** 代码区文本。 */
function codeText(): string {
  const code = document.querySelector<HTMLElement>('[data-df-inspect="code"]');
  if (code === null) throw new Error('代码区缺失');
  return code.textContent ?? '';
}

afterEach(() => {
  cleanup();
});

describe('CodeExportPanel · 分档与代码区', () => {
  it('缺省 CSS 档：代码区输出 CSS 规则（含令牌 var()）', () => {
    setup(INSPECT_IDS.card);
    expect(codeText()).toContain('.df-node-card {');
    expect(codeText()).toContain(
      `background: var(--dfg-design-color-brand, ${TOKEN_VALUES.brand});`,
    );
  });

  it('切到 React 档：代码区换成 React 组件（同源节点数据）', () => {
    setup(INSPECT_IDS.card);
    fireEvent.click(screen.getByRole('radio', { name: 'React' }));
    expect(codeText()).toContain('export function DesignNode()');
    expect(codeText()).toContain(
      `background: 'var(--dfg-design-color-brand, ${TOKEN_VALUES.brand})'`,
    );
    expect(codeText()).not.toContain('.df-node-card {');
  });

  it('切回 CSS 档：恢复 CSS 输出', () => {
    setup(INSPECT_IDS.card);
    fireEvent.click(screen.getByRole('radio', { name: 'React' }));
    fireEvent.click(screen.getByRole('radio', { name: 'CSS' }));
    expect(codeText()).toContain('.df-node-card {');
  });

  it('未选节点：代码区给空态文案', () => {
    setup('missing');
    expect(screen.getByText('选择一个图层生成代码')).toBeDefined();
    expect(document.querySelector('[data-df-inspect="code"]')).toBeNull();
  });
});

describe('CodeExportPanel · 复制', () => {
  it('点击复制：把当前档位的代码交给剪贴板，并提示已复制', async () => {
    const copyText = vi.fn(async (_text: string) => undefined);
    setup(INSPECT_IDS.card, copyText);
    fireEvent.click(screen.getByRole('button', { name: '复制代码' }));

    expect(copyText).toHaveBeenCalledTimes(1);
    const copied = copyText.mock.calls[0]?.[0] ?? '';
    expect(copied).toContain('.df-node-card {');
    expect(await screen.findByText('已复制代码')).toBeDefined();
  });

  it('复制失败：给出失败原因（Toast 错误语义）', async () => {
    const copyText = vi.fn(async (_text: string) => {
      throw new Error('剪贴板被拒绝');
    });
    setup(INSPECT_IDS.card, copyText);
    fireEvent.click(screen.getByRole('button', { name: '复制代码' }));
    expect(await screen.findByText('复制失败：剪贴板被拒绝')).toBeDefined();
  });
});

describe('CodeExportPanel · Token → CSS 变量说明', () => {
  it('命中令牌：列出「令牌 → CSS 变量」', () => {
    setup(INSPECT_IDS.card);
    const rows = document.querySelectorAll('[data-df-inspect="token-note"]');
    const text = [...rows].map((row) => row.textContent ?? '').join('\n');
    expect(text).toContain('color.brand → --dfg-design-color-brand');
    expect(text).toContain('radius.card → --dfg-design-radius-card');
  });

  it('未绑定令牌：回退提示带原始值', () => {
    setup(INSPECT_IDS.plain);
    const rows = document.querySelectorAll('[data-df-inspect="token-note-unbound"]');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain(`未绑定令牌，输出原始值 ${UNBOUND_FILL}`);
  });
});
