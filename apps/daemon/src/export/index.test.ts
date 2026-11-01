import { describe, expect, it } from 'vitest';

import {
  EXPORT_MAX_EDGE_PX,
  ExportCanvasTooLargeError,
  incompleteArtifactFileName,
  renderExport,
} from './index.ts';

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

describe('export · 不完整产物的隔离文件名（票 18 二轮 G1 + 三轮 E2）', () => {
  it('规范名保留扩展名，中间插 .incomplete-<摘要标签>（三种格式各一条）', () => {
    expect(incompleteArtifactFileName('doc-page-1.svg', 'svg', 'aabbccddeeff0011')).toBe(
      'doc-page-1.incomplete-aabbccddeeff.svg',
    );
    expect(incompleteArtifactFileName('doc-page-1.png', 'png', 'aabbccddeeff0011')).toBe(
      'doc-page-1.incomplete-aabbccddeeff.png',
    );
    expect(incompleteArtifactFileName('doc-page-1.pdf', 'pdf', 'aabbccddeeff0011')).toBe(
      'doc-page-1.incomplete-aabbccddeeff.pdf',
    );
  });

  it('扩展名不匹配时不吞字符：原样作主体，仍追加 .incomplete-<摘要标签>.<format>', () => {
    expect(incompleteArtifactFileName('doc-page-1', 'svg', 'aabbccddeeff0011')).toBe(
      'doc-page-1.incomplete-aabbccddeeff.svg',
    );
    expect(incompleteArtifactFileName('doc-page-1.png', 'svg', 'aabbccddeeff0011')).toBe(
      'doc-page-1.png.incomplete-aabbccddeeff.svg',
    );
  });

  it('不同字节必然不同名（E2：四次部分结果曾挤进同一个侧文件互相顶掉）', () => {
    const first = incompleteArtifactFileName('doc-page-1.svg', 'svg', '1111222233334444');
    expect(incompleteArtifactFileName('doc-page-1.svg', 'svg', '9999888877776666')).not.toBe(first);
    // 相同字节幂等：内容一致，覆盖谈不上损失。
    expect(incompleteArtifactFileName('doc-page-1.svg', 'svg', '1111222233334444')).toBe(first);
  });

  it('摘要标签只留十六进制、截到 12 位，非摘要输入不得往文件名塞路径分隔符', () => {
    expect(incompleteArtifactFileName('doc-page-1.svg', 'svg', '../../../../etc/passwd')).toBe(
      'doc-page-1.incomplete-ecad.svg',
    );
    expect(incompleteArtifactFileName('doc-page-1.svg', 'svg', 'AABBCCDDEEFF00112233')).toBe(
      'doc-page-1.incomplete-aabbccddeeff.svg',
    );
    expect(incompleteArtifactFileName('doc-page-1.svg', 'svg', 'zzzz')).toBe(
      'doc-page-1.incomplete-unknown.svg',
    );
  });

  it('renderExport 把场景的完整性事实原样带到返回值（路由据此决定落盘名）', () => {
    const blank = renderExport({
      format: 'svg',
      pageBody: { $format: 'dforge.canvas.page', $version: 1, page: null, tokens: {} },
      context: { documentId: 'doc', pageId: 'page-1' },
    });
    expect(blank.complete).toBe(false);
    expect(blank.truncatedNodes).toBe(0);
    const good = renderExport({
      format: 'svg',
      pageBody: { width: 100, height: 100, background: '#FFFFFF', children: [] },
      context: { documentId: 'doc', pageId: 'page-1' },
    });
    expect(good.complete).toBe(true);
  });
});
