// @vitest-environment jsdom
/**
 * 浮层工具条测试（票 10 · 报告 §E2）：位置由**文档快照订阅**驱动。
 *
 * 断言口径：DOM 可观测行为（toolbar 元素的屏幕位置），不测订阅实现细节。
 * 回归场景：提交 move（拖动结算/nudge）/ 撤销 / Inspector 改值——三者都是
 * 命令栈写入，不触碰 viewport/selection 两个 UI 切片；浮层若只订阅这两切片
 * 就会停在拖动前坐标（§E2 缺陷本体）。
 */

import {
  createDocument,
  createIdFactory,
  createPage,
  createRect,
  createText,
} from '@dforge/engine';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { type CanvasSession, createCanvasSession } from '../state/session';
import { FloatingToolbar } from './floating-toolbar';

/** 建会话（初始视口：zoom 2、pan 40/30，便于独立计算期望坐标）。 */
function fixture(): CanvasSession {
  const rect = createRect({ id: 'n_rect', x: 100, y: 50, width: 40, height: 20 });
  const text = createText({ id: 'n_text', x: 0, y: 100, width: 60, height: 16 });
  const page = createPage({
    id: 'page_1',
    rootIds: ['n_rect', 'n_text'],
    nodes: { n_rect: rect, n_text: text },
  });
  return createCanvasSession({
    document: createDocument({ id: 'doc_1', pages: [page] }),
    ids: createIdFactory(1),
    viewport: { zoom: 2, panX: 40, panY: 30 },
  });
}

let session: CanvasSession;

beforeEach(() => {
  session = fixture();
  session.setSelection(['n_rect']);
});

describe('浮层工具条（文档快照订阅驱动位置）', () => {
  it('初始按选择集包围盒定位（顶部中心，向上偏移一个间隙）', () => {
    render(<FloatingToolbar session={session} />);
    const toolbar = screen.getByRole('toolbar');
    // left = (x + width/2) × zoom + panX = 120×2+40 = 280；top = y×zoom + panY − 间隙 = 50×2+30−12 = 118
    expect(toolbar.style.left).toBe('280px');
    expect(toolbar.style.top).toBe('118px');
  });

  it('提交 move（nudge 走同一命令栈）后位置即时跟随', () => {
    render(<FloatingToolbar session={session} />);
    act(() => {
      session.nudge(10, 0);
    });
    // x=110 → 中心 130 → left = 130×2+40 = 300
    expect(screen.getByRole('toolbar').style.left).toBe('300px');
  });

  it('撤销后位置回到拖动前（命令栈写入驱动，不依赖 UI 切片变化）', () => {
    render(<FloatingToolbar session={session} />);
    act(() => {
      session.nudge(10, 0);
    });
    // 先证明拖动后确实跟随（否则撤销断言在「停着不动」的退化下也成立，无判别力）
    expect(screen.getByRole('toolbar').style.left).toBe('300px');
    act(() => {
      session.undo();
    });
    expect(screen.getByRole('toolbar').style.left).toBe('280px');
  });

  it('Inspector 改值（node.update 直发命令栈）后位置即时跟随', () => {
    render(<FloatingToolbar session={session} />);
    act(() => {
      session.stack.dispatch(
        [{ type: 'node.update', pageId: 'page_1', nodeId: 'n_rect', patch: { width: 60 } }],
        { label: 'Inspector 改宽' },
      );
    });
    // width 40→60 → 中心 100+30=130 → left = 130×2+40 = 300
    expect(screen.getByRole('toolbar').style.left).toBe('300px');
  });

  it('选择清空后不渲染（空选态没有浮层）', () => {
    render(<FloatingToolbar session={session} />);
    act(() => {
      session.clearSelection();
    });
    expect(screen.queryByRole('toolbar')).toBeNull();
  });
});
