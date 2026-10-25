// @vitest-environment jsdom
/**
 * 对抗性验证 · 风险 5：文本覆盖层（C10）
 *
 * 验证口径：
 * - 世界坐标 → 屏幕换算在缩放两端（25% / 400%）成立，且与渲染层同一口径（含父级变换）；
 * - 失焦提交 / Esc 取消 / 空文本不得产生空历史；
 * - 覆盖层几何必须跟随**祖先链**（帧内文本是常态：双击帧内文本即可进入编辑）。
 */
import {
  createDocument,
  createFrame,
  createPage,
  createText,
  localPointToWorld,
  resolveNode,
} from '@dforge/engine';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { type CanvasSession, createCanvasSession } from '@/features/canvas/state/session';
import { TextOverlay } from '@/features/canvas/ui/text-overlay';

/** 顶层文本节点会话（x=100, y=50, w=200, h=24, fontSize 14）。 */
function topLevelSession(viewport: { zoom: number; panX: number; panY: number }): CanvasSession {
  const text = createText({
    id: 'n_text',
    x: 100,
    y: 50,
    width: 200,
    height: 24,
    rotation: 0,
    text: {
      characters: '初始',
      fontFamily: 'Noto Sans SC',
      fontSize: 14,
      fontWeight: 400,
      lineHeight: 1.4,
      letterSpacing: 0,
      align: 'left',
      autoResize: 'none',
    },
  });
  const page = createPage({ id: 'page_1', rootIds: ['n_text'], nodes: { n_text: text } });
  return createCanvasSession({
    document: createDocument({ id: 'doc_1', pages: [page] }),
    pageId: 'page_1',
    viewport,
  });
}

/** 帧内文本会话：帧 (1000,500) 内含文本（局部 10,10），帧自身可旋转。 */
function nestedSession(frameRotation: number): CanvasSession {
  const text = createText({
    id: 'n_inner',
    x: 10,
    y: 10,
    width: 200,
    height: 24,
    rotation: 0,
    text: {
      characters: '帧内文本',
      fontFamily: 'Noto Sans SC',
      fontSize: 14,
      fontWeight: 400,
      lineHeight: 1.4,
      letterSpacing: 0,
      align: 'left',
      autoResize: 'none',
    },
  });
  const frame = createFrame({
    id: 'n_frame',
    x: 1000,
    y: 500,
    width: 400,
    height: 300,
    rotation: frameRotation,
    children: ['n_inner'],
  });
  const page = createPage({
    id: 'page_1',
    rootIds: ['n_frame'],
    nodes: { n_frame: frame, n_inner: text },
  });
  return createCanvasSession({
    document: createDocument({ id: 'doc_1', pages: [page] }),
    pageId: 'page_1',
    viewport: { zoom: 1, panX: 0, panY: 0 },
  });
}

/** 覆盖层几何（屏幕 CSS px）。 */
function overlayGeometry(): {
  left: number;
  top: number;
  width: number;
  height: number;
  fontSize: number;
} {
  const overlay = screen.getByRole('textbox') as HTMLTextAreaElement;
  return {
    left: Number.parseFloat(overlay.style.left),
    top: Number.parseFloat(overlay.style.top),
    width: Number.parseFloat(overlay.style.width),
    height: Number.parseFloat(overlay.style.height),
    fontSize: Number.parseFloat(overlay.style.fontSize),
  };
}

describe('文本覆盖层 · 世界坐标 ↔ 屏幕换算（25% / 400%）', () => {
  for (const zoom of [0.25, 4]) {
    it(`zoom=${zoom}：位置/尺寸/字号按「世界 × zoom + pan」换算`, () => {
      const session = topLevelSession({ zoom, panX: 40, panY: 30 });
      session.beginTextEditing('n_text', { selectAll: true });
      render(<TextOverlay session={session} />);
      const geometry = overlayGeometry();
      expect(geometry.left).toBeCloseTo(100 * zoom + 40, 6);
      expect(geometry.top).toBeCloseTo(50 * zoom + 30, 6);
      expect(geometry.fontSize).toBeCloseTo(14 * zoom, 6);
      // 宽高：zoom=4 时按真实值；zoom=0.25 时被最小可点尺寸（16×8 屏幕 px）托底
      if (zoom === 4) {
        expect(geometry.width).toBeCloseTo(200 * zoom, 6);
        expect(geometry.height).toBeCloseTo(24 * zoom, 6);
      } else {
        // 200 × 0.25 = 50（宽不触底）；24 × 0.25 = 6 < 8 → 高被最小可点尺寸托底
        expect(geometry.width).toBeCloseTo(50, 6);
        expect(geometry.height).toBe(8);
      }
    });
  }

  it('编辑中途视口缩放：覆盖层几何实时跟随（不缓存旧视口）', () => {
    const session = topLevelSession({ zoom: 1, panX: 0, panY: 0 });
    session.beginTextEditing('n_text', { selectAll: true });
    render(<TextOverlay session={session} />);
    expect(overlayGeometry().left).toBeCloseTo(100, 6);
    // 视口变化（缩放菜单/滚轮）
    const before = session.viewport();
    act(() => {
      session.zoomIn({ x: 0, y: 0 });
    });
    expect(session.viewport().zoom).not.toBe(before.zoom);
    expect(overlayGeometry().left).toBeCloseTo(100 * session.viewport().zoom, 6);
  });
});

describe('文本覆盖层 · 与渲染层同口径（祖先链）', () => {
  it('[缺陷] 帧内文本：覆盖层必须落在世界位置（含父级偏移），当前用局部坐标定位', () => {
    const session = nestedSession(0);
    const page = session.page();
    const expectedWorld = localPointToWorld(page, 'n_inner', { x: 0, y: 0 });
    expect(expectedWorld).not.toBeNull();
    expect(expectedWorld).toEqual({ x: 1010, y: 510 });
    const world = expectedWorld as NonNullable<typeof expectedWorld>;

    session.beginTextEditing('n_inner', { selectAll: true });
    render(<TextOverlay session={session} />);
    const geometry = overlayGeometry();
    // 渲染层（draw-scene）按祖先链 translate；覆盖层必须同口径
    expect(geometry.left, '覆盖层 left 未含父级偏移 → 与画布字形错位').toBeCloseTo(world.x, 6);
    expect(geometry.top, '覆盖层 top 未含父级偏移 → 与画布字形错位').toBeCloseTo(world.y, 6);
  });

  it('[缺陷] 父级旋转 30°：覆盖层旋转角必须含祖先旋转（当前只取自身 rotation）', () => {
    const session = nestedSession(30);
    session.beginTextEditing('n_inner', { selectAll: true });
    render(<TextOverlay session={session} />);
    const overlay = screen.getByRole('textbox');
    // 期望：祖先 30° + 自身 0° = 30°（与渲染层 drawNode 的 rotate 语义一致）
    expect(overlay.style.transform).toBe('rotate(30deg)');
  });

  it('[补充] 深层嵌套（4 层）偏移与旋转累加：位置 = 祖先链世界位置（缩放/平移同口径）', () => {
    // 帧套帧套帧再套文本：只算自身局部坐标会差出 1075/597 这种量级
    const makeDeep = (rotationOfLayer: (level: 2 | 3) => number): CanvasSession => {
      const text = createText({
        id: 'n_deep',
        x: 5,
        y: 7,
        width: 200,
        height: 24,
        rotation: 0,
        text: {
          characters: '深层文本',
          fontFamily: 'Noto Sans SC',
          fontSize: 14,
          fontWeight: 400,
          lineHeight: 1.4,
          letterSpacing: 0,
          align: 'left',
          autoResize: 'none',
        },
      });
      const inner = createFrame({
        id: 'n_l3',
        x: 20,
        y: 30,
        width: 300,
        height: 200,
        rotation: rotationOfLayer(3),
        children: ['n_deep'],
      });
      const middle = createFrame({
        id: 'n_l2',
        x: 50,
        y: 60,
        width: 400,
        height: 300,
        rotation: rotationOfLayer(2),
        children: ['n_l3'],
      });
      const outer = createFrame({
        id: 'n_l1',
        x: 1000,
        y: 500,
        width: 600,
        height: 400,
        rotation: 0,
        children: ['n_l2'],
      });
      const page = createPage({
        id: 'page_1',
        rootIds: ['n_l1'],
        nodes: { n_l1: outer, n_l2: middle, n_l3: inner, n_deep: text },
      });
      return createCanvasSession({
        document: createDocument({ id: 'doc_1', pages: [page] }),
        pageId: 'page_1',
        viewport: { zoom: 2, panX: 10, panY: 20 },
      });
    };

    // ① 纯偏移累加（无旋转）：4 层祖先的 x/y 逐层相加
    const plain = makeDeep(() => 0);
    expect(localPointToWorld(plain.page(), 'n_deep', { x: 0, y: 0 })).toEqual({
      x: 1075,
      y: 597,
    });
    plain.beginTextEditing('n_deep', { selectAll: true });
    const first = render(<TextOverlay session={plain} />);
    const geometry = overlayGeometry();
    expect(geometry.left, '深层偏移未累加 → 覆盖层落在局部坐标').toBeCloseTo(1075 * 2 + 10, 6);
    expect(geometry.top, '深层偏移未累加 → 覆盖层落在局部坐标').toBeCloseTo(597 * 2 + 20, 6);
    expect(geometry.width).toBeCloseTo(200 * 2, 6);
    expect(geometry.height).toBeCloseTo(24 * 2, 6);
    first.unmount();

    // ② 带旋转的祖先链（10° + 20° = 30°）：位置必须等于**引擎真值**（不是简单相加，更不是局部坐标）
    const rotated = makeDeep((level) => (level === 2 ? 10 : 20));
    const expectedWorld = localPointToWorld(rotated.page(), 'n_deep', { x: 0, y: 0 });
    expect(expectedWorld).not.toBeNull();
    const deepWorld = expectedWorld as NonNullable<typeof expectedWorld>;
    rotated.beginTextEditing('n_deep', { selectAll: true });
    render(<TextOverlay session={rotated} />);
    const rotatedGeometry = overlayGeometry();
    const worldScreen = {
      x: deepWorld.x * 2 + 10,
      y: deepWorld.y * 2 + 20,
    };
    expect(rotatedGeometry.left).toBeCloseTo(worldScreen.x, 6);
    expect(rotatedGeometry.top).toBeCloseTo(worldScreen.y, 6);
    // 与「按局部坐标落位」的错位量级：确实把祖先偏移算进来了（不得静默错位）
    expect(Math.abs(rotatedGeometry.left - (5 * 2 + 10))).toBeGreaterThan(1000);
    // 旋转同样按祖先链累加：10° + 20° + 0° = 30°
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).style.transform).toBe(
      'rotate(30deg)',
    );
  });
});

describe('文本覆盖层 · 提交/取消/空文本', () => {
  it('未改动即失焦：零历史（不得产生空命令）', async () => {
    const session = topLevelSession({ zoom: 1, panX: 0, panY: 0 });
    session.beginTextEditing('n_text', { selectAll: true });
    render(
      <>
        <TextOverlay session={session} />
        <button type="button">外侧</button>
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: '外侧' }));
    expect(session.store.getState().editing).toBeNull();
    expect(session.stack.history().undo).toHaveLength(0);
  });

  it('清空文本后失焦：落一条命令，撤销回退原文（空文本被允许）', async () => {
    const session = topLevelSession({ zoom: 1, panX: 0, panY: 0 });
    session.beginTextEditing('n_text', { selectAll: true });
    render(
      <>
        <TextOverlay session={session} />
        <button type="button">外侧</button>
      </>,
    );
    const overlay = screen.getByRole('textbox');
    await userEvent.clear(overlay);
    await userEvent.click(screen.getByRole('button', { name: '外侧' }));

    const node = resolveNode(session.page(), 'n_text');
    expect(node?.type === 'text' && node.text.characters).toBe('');
    expect(session.stack.history().undo).toHaveLength(1);
    session.undo();
    const restored = resolveNode(session.page(), 'n_text');
    expect(restored?.type === 'text' && restored.text.characters).toBe('初始');
  });

  it('Esc 后重新进入编辑：原稿不受影响（取消不写文档）', async () => {
    const session = topLevelSession({ zoom: 1, panX: 0, panY: 0 });
    session.beginTextEditing('n_text', { selectAll: true });
    const { unmount } = render(<TextOverlay session={session} />);
    await userEvent.type(screen.getByRole('textbox'), '临时内容');
    await userEvent.keyboard('{Escape}');
    expect(session.store.getState().editing).toBeNull();
    expect(session.stack.history().undo).toHaveLength(0);
    const node = resolveNode(session.page(), 'n_text');
    expect(node?.type === 'text' && node.text.characters).toBe('初始');
    unmount();
  });

  it('失焦提交后立刻撤销再重做：文本往返（与命令栈一致）', async () => {
    const session = topLevelSession({ zoom: 1, panX: 0, panY: 0 });
    session.beginTextEditing('n_text', { selectAll: true });
    render(
      <>
        <TextOverlay session={session} />
        <button type="button">外侧</button>
      </>,
    );
    const overlay = screen.getByRole('textbox');
    await userEvent.clear(overlay);
    await userEvent.type(overlay, '新标题');
    await userEvent.click(screen.getByRole('button', { name: '外侧' }));

    expect(session.stack.history().undo).toHaveLength(1);
    session.undo();
    session.redo();
    const node = resolveNode(session.page(), 'n_text');
    expect(node?.type === 'text' && node.text.characters).toBe('新标题');
  });
});
