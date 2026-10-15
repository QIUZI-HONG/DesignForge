// @vitest-environment jsdom
/**
 * ExportPanel（导出三档 PNG / SVG / PDF）规格。
 *
 * 断言：三档按钮各自触发一次 daemon 导出（请求含 documentId/pageId/format）、
 * 进行中给出进度语义、失败态给出错误码 + 重试（重试后成功则转完成态）、
 * 完成态给出文件名与字节数（证据引用对）。
 */

import type { ExportArtifact, ExportRequest } from '@dforge/contracts';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { ExportClient, ExportOutcome } from '../model/export-client';
import { ExportPanel } from './ExportPanel';

/** 造产物（形状按 @dforge/contracts）。 */
function artifactOf(format: ExportArtifact['format'], length: number): ExportArtifact {
  return {
    format,
    mimeType:
      format === 'png' ? 'image/png' : format === 'svg' ? 'image/svg+xml' : 'application/pdf',
    fileName: `export_p1.${format}`,
    length,
    sha256: 'b'.repeat(64),
    base64: 'AAAA',
    filePath: `/tmp/exports/export_p1.${format}`,
  };
}

/** 可编排的假客户端：按请求顺序返回预设结果。 */
function fakeClient(results: ExportOutcome[]): {
  client: ExportClient;
  calls: ExportRequest[];
  pending: Array<() => void>;
} {
  const calls: ExportRequest[] = [];
  const pending: Array<() => void> = [];
  let index = 0;
  return {
    calls,
    pending,
    client: {
      exportDocument: (request: ExportRequest): Promise<ExportOutcome> => {
        calls.push(request);
        const result = results[index] ?? { ok: false, code: 'internal', message: '没有更多预设' };
        index += 1;
        // 「进行中」态断言需要可控结算：不传 resolve 装载函数时立即结算
        return new Promise<ExportOutcome>((resolve) => {
          pending.push(() => resolve(result));
        });
      },
    },
  };
}

/** 立即结算的假客户端。 */
function immediateClient(results: ExportOutcome[]): {
  client: ExportClient;
  calls: ExportRequest[];
} {
  const calls: ExportRequest[] = [];
  let index = 0;
  return {
    calls,
    client: {
      exportDocument: async (request: ExportRequest): Promise<ExportOutcome> => {
        calls.push(request);
        const result = results[index] ?? { ok: false, code: 'internal', message: '没有更多预设' };
        index += 1;
        return result;
      },
    },
  };
}

function setup(results: ExportOutcome[]) {
  const { client, calls, pending } = fakeClient(results);
  render(<ExportPanel documentId="doc1" pageId="p1" client={client} />);
  return { calls, pending };
}

afterEach(() => {
  cleanup();
});

describe('ExportPanel · 三档导出', () => {
  it('渲染三档按钮（PNG / SVG / PDF）', () => {
    setup([]);
    for (const format of ['PNG', 'SVG', 'PDF']) {
      expect(screen.getByRole('button', { name: `导出 ${format}` })).toBeDefined();
    }
  });

  it('点 PNG：请求带 documentId/pageId/format，进行中按钮忙碌', async () => {
    const { calls, pending } = setup([{ ok: true, artifact: artifactOf('png', 4096) }]);
    fireEvent.click(screen.getByRole('button', { name: '导出 PNG' }));
    expect(calls).toEqual([{ documentId: 'doc1', pageId: 'p1', format: 'png' }]);
    const button = screen.getByRole('button', { name: /导出 PNG|正在导出 PNG/ });
    expect(button.getAttribute('aria-busy')).toBe('true');

    for (const settle of pending) settle();
    await waitFor(() => expect(screen.getByText(/已导出 export_p1\.png/)).toBeDefined());
  });

  it('完成态给出文件名与字节数', async () => {
    const { client } = immediateClient([{ ok: true, artifact: artifactOf('svg', 2048) }]);
    render(<ExportPanel documentId="doc1" pageId="p1" client={client} />);
    fireEvent.click(screen.getByRole('button', { name: '导出 SVG' }));
    expect(await screen.findByText('已导出 export_p1.svg（2048 字节）')).toBeDefined();
  });

  it('三档各自独立（PDF 失败不影响 SVG 的完成态）', async () => {
    const { client } = immediateClient([
      { ok: true, artifact: artifactOf('svg', 100) },
      { ok: false, code: 'export_render_failed', message: '渲染失败' },
    ]);
    render(<ExportPanel documentId="doc1" pageId="p1" client={client} />);
    fireEvent.click(screen.getByRole('button', { name: '导出 SVG' }));
    await screen.findByText('已导出 export_p1.svg（100 字节）');
    fireEvent.click(screen.getByRole('button', { name: '导出 PDF' }));
    expect(await screen.findByText('导出失败：渲染失败')).toBeDefined();
    // SVG 的完成态仍在（互不覆盖）
    expect(screen.getByText('已导出 export_p1.svg（100 字节）')).toBeDefined();
  });
});

describe('ExportPanel · 失败态与重试', () => {
  it('daemon 500：显示错误码与文案，并提供重试', async () => {
    const { client, calls } = immediateClient([
      { ok: false, code: 'export_render_failed', message: '渲染失败：坏数据' },
    ]);
    render(<ExportPanel documentId="doc1" pageId="p1" client={client} />);
    fireEvent.click(screen.getByRole('button', { name: '导出 PDF' }));

    const error = await screen.findByRole('alert');
    expect(error.textContent).toContain('导出失败：渲染失败：坏数据');
    expect(error.textContent).toContain('错误码：export_render_failed');
    expect(screen.getByRole('button', { name: '重试' })).toBeDefined();
    expect(calls).toHaveLength(1);
  });

  it('重试：成功后转完成态（同一档位，不重复计数）', async () => {
    const { client, calls } = immediateClient([
      { ok: false, code: 'export_render_failed', message: '渲染失败' },
      { ok: true, artifact: artifactOf('pdf', 512) },
    ]);
    render(<ExportPanel documentId="doc1" pageId="p1" client={client} />);
    fireEvent.click(screen.getByRole('button', { name: '导出 PDF' }));
    fireEvent.click(await screen.findByRole('button', { name: '重试' }));

    expect(await screen.findByText('已导出 export_p1.pdf（512 字节）')).toBeDefined();
    expect(calls).toHaveLength(2);
    expect(calls[1]?.format).toBe('pdf');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('离线（daemon 未启动）：给出「本地服务未启动」提示', async () => {
    const { client } = immediateClient([
      { ok: false, code: 'daemon_offline', message: 'fetch failed' },
    ]);
    render(<ExportPanel documentId="doc1" pageId="p1" client={client} />);
    fireEvent.click(screen.getByRole('button', { name: '导出 PNG' }));
    const error = await screen.findByRole('alert');
    expect(error.textContent).toContain('本地服务未启动');
    expect(error.textContent).toContain('错误码：daemon_offline');
  });
});
