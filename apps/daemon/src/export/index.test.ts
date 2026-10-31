import { describe, expect, it } from 'vitest';

import { EXPORT_MAX_EDGE_PX, ExportCanvasTooLargeError, renderExport } from './index.ts';

/** 构造一次导出渲染调用（存量分支顶层 width/height + 空 children，护栏若放行则渲染成本近零）。 */
function renderGuarded(width: number, height: number, scale?: number): void {
  renderExport({
    format: 'png',
    pageBody: { width, height, background: '#FFFFFF', children: [] },
    context: { documentId: 'doc', pageId: 'page-1' },
    ...(scale === undefined ? {} : { scale }),
  });
}

describe('export · 尺寸护栏（§D1：防多 GB 同步分配）', () => {
  it('上限登记为命名常量 EXPORT_MAX_EDGE_PX = 8192（单边像素 = 页面边长 × scale）', () => {
    expect(EXPORT_MAX_EDGE_PX).toBe(8192);
  });

  it('单边恰在上限内不抛（两轴与 scale 合成的边界值 8192；细条页面避免真渲染大缓冲）', () => {
    expect(() => renderGuarded(8192, 1)).not.toThrow();
    expect(() => renderGuarded(1, 8192)).not.toThrow();
    expect(() => renderGuarded(2048, 1, 4)).not.toThrow();
  });

  it('单边超限抛 ExportCanvasTooLargeError（8193×1 @scale1）', () => {
    expect(() => renderGuarded(8193, 1)).toThrow(ExportCanvasTooLargeError);
  });

  it('D1 场景：5000×5000 页面 @scale4 = 20000 像素边 → 渲染前拦截（不再可能 3.2GB 分配）', () => {
    expect(() => renderGuarded(5000, 5000, 4)).toThrow(ExportCanvasTooLargeError);
  });

  it('护栏在渲染之前：svg 通道同样受保护，超限时什么都不渲染', () => {
    expect(() =>
      renderExport({
        format: 'svg',
        pageBody: { width: 9000, height: 10, background: '#FFFFFF', children: [] },
        context: { documentId: 'doc', pageId: 'page-1' },
      }),
    ).toThrow(ExportCanvasTooLargeError);
  });

  it('错误携带结构化上下文（width/height/scale/maxEdge）与中文原因', () => {
    try {
      renderGuarded(5000, 5000, 4);
      expect.unreachable('应当抛出');
    } catch (error) {
      expect(error).toBeInstanceOf(ExportCanvasTooLargeError);
      const tooLarge = error as ExportCanvasTooLargeError;
      expect(tooLarge.width).toBe(20000);
      expect(tooLarge.height).toBe(20000);
      expect(tooLarge.scale).toBe(4);
      expect(tooLarge.maxEdge).toBe(8192);
      expect(tooLarge.message).toContain('8192');
    }
  });
});
