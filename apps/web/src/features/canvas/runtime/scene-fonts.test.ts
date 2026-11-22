/**
 * 场景字体加载测试：注册数量、缺失登记、全失败时的错误态（禁止静默回退）；
 * 以及缺省 fetcher 的超时有界失败（quality-p1 · B9：串行取回 + 每文件
 * AbortSignal.timeout——超时按 missing 降级，不整批放弃、不悬挂启动）。
 */

import type { CanvasKit } from 'canvaskit-wasm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadSceneFonts, SCENE_FONT_WEIGHTS, sceneFontFileName } from './scene-fonts';

/** 假 CanvasKit：只实现字体相关的两个工厂。 */
function fakeCanvasKit(): { canvasKit: CanvasKit; fromDataArgs: () => number } {
  let args = 0;
  const canvasKit = {
    FontMgr: {
      FromData: (...buffers: ArrayBuffer[]) => {
        args = buffers.length;
        return buffers.length === 0 ? null : { familyCount: buffers.length };
      },
    },
    TypefaceFontProvider: { Make: () => ({ familyCount: 0 }) },
  } as unknown as CanvasKit;
  return { canvasKit, fromDataArgs: () => args };
}

/** 全量成功的 fetcher（注入 fetchBytes 路径用）。 */
const okFetcher = async (): Promise<ArrayBuffer> => new ArrayBuffer(8);

/** 记录到的一次缺省 fetch 调用（signal 契约断言用）。 */
interface RecordedFetchCall {
  url: string;
  /** 缺省 fetcher 应给每次调用注入的超时 signal。 */
  signal: AbortSignal | undefined;
  /** 调用瞬间 signal 尚未 abort（超时窗口从该次调用发起时起算）。 */
  notAbortedAtCall: boolean;
}

/**
 * 替身全局 fetch（走缺省 fetcher 路径，模拟真 fetch 的 signal 语义）：
 * 未传 `hang` 时全部 URL 悬挂；命中 `hang` 的 URL 永不自行落定、仅在 signal
 * abort 时以 `signal.reason` 拒绝——等价真 fetch 被 AbortSignal.timeout 到点打断。
 */
function stubGlobalFetch(hang?: (url: string) => boolean): { calls: RecordedFetchCall[] } {
  const calls: RecordedFetchCall[] = [];
  const fetchMock = vi.fn(async (url: string | URL, init?: { signal?: AbortSignal }) => {
    const urlText = String(url);
    const signal = init?.signal;
    calls.push({ url: urlText, signal, notAbortedAtCall: signal ? !signal.aborted : true });
    if (!(hang ? hang(urlText) : true)) {
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) };
    }
    return new Promise<never>((_resolve, reject) => {
      if (!signal) return; // 无 signal 即永久悬挂（缺省 fetcher 恒带 signal，不应发生）
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls };
}

describe('sceneFontFileName', () => {
  it('命名与 @fontsource 产物一致（复制脚本与加载器共用同一规则）', () => {
    expect(sceneFontFileName(400, 'chinese-simplified')).toBe(
      'noto-sans-sc-chinese-simplified-400-normal.woff2',
    );
    expect(sceneFontFileName(700, 'latin')).toBe('noto-sans-sc-latin-700-normal.woff2');
  });
});

describe('loadSceneFonts', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('三档字重 × 两子集全部注册成功', async () => {
    const { canvasKit, fromDataArgs } = fakeCanvasKit();
    const seen = vi.fn();
    const fonts = await loadSceneFonts(canvasKit, {
      fetchBytes: async (url) => {
        seen(url);
        return new ArrayBuffer(8);
      },
    });
    expect(fonts.registered).toBe(SCENE_FONT_WEIGHTS.length * 2);
    expect(fonts.missing).toEqual([]);
    expect(fromDataArgs()).toBe(6);
    expect(seen).toHaveBeenCalledWith('/canvaskit/fonts/noto-sans-sc-latin-700-normal.woff2');
  });

  it('部分文件缺失：登记 missing 且继续注册其余（不整批放弃）', async () => {
    const { canvasKit } = fakeCanvasKit();
    const fonts = await loadSceneFonts(canvasKit, {
      fetchBytes: async (url) => {
        if (url.includes('chinese-simplified-500')) throw new Error('HTTP 404');
        return new ArrayBuffer(8);
      },
      assetDir: '/assets/',
    });
    expect(fonts.registered).toBe(5);
    expect(fonts.missing).toEqual([
      '/assets/fonts/noto-sans-sc-chinese-simplified-500-normal.woff2',
    ]);
  });

  it('全部失败：registered=0（调用方按错误态处理，禁止静默回退）', async () => {
    const { canvasKit } = fakeCanvasKit();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fonts = await loadSceneFonts(canvasKit, {
      fetchBytes: async () => {
        throw new Error('offline');
      },
    });
    expect(fonts.registered).toBe(0);
    expect(fonts.missing).toHaveLength(6);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('资产目录默认 /canvaskit 且忽略尾斜杠', async () => {
    const { canvasKit } = fakeCanvasKit();
    const urls: string[] = [];
    await loadSceneFonts(canvasKit, {
      fetchBytes: async (url) => {
        urls.push(url);
        return okFetcher();
      },
      assetDir: '/canvaskit/',
    });
    expect(urls[0]).toBe('/canvaskit/fonts/noto-sans-sc-chinese-simplified-400-normal.woff2');
  });

  it('单个文件悬挂 → 缺省 fetcher 到点有界失败走 missing 降级（不整批放弃、不悬挂启动）', async () => {
    const { canvasKit } = fakeCanvasKit();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const startedAt = Date.now();
    stubGlobalFetch((url) => url.includes('latin-500'));
    const fonts = await loadSceneFonts(canvasKit, { fetchTimeoutMs: 40 });
    expect(fonts.registered).toBe(5);
    expect(fonts.missing).toEqual(['/canvaskit/fonts/noto-sans-sc-latin-500-normal.woff2']);
    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('全部悬挂 → registered=0（错误态）且到点落定（不悬挂启动）', async () => {
    const { canvasKit } = fakeCanvasKit();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const startedAt = Date.now();
    stubGlobalFetch();
    const fonts = await loadSceneFonts(canvasKit, { fetchTimeoutMs: 30 });
    expect(fonts.registered).toBe(0);
    expect(fonts.missing).toHaveLength(6);
    expect(Date.now() - startedAt).toBeLessThan(2_000);
    consoleError.mockRestore();
  });

  it('缺省 fetch 收到超时 signal（AbortSignal.timeout）且超时后按 missing 降级', async () => {
    const { canvasKit } = fakeCanvasKit();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { calls } = stubGlobalFetch((url) => url.includes('chinese-simplified-400'));
    const fonts = await loadSceneFonts(canvasKit, { fetchTimeoutMs: 40 });
    expect(calls).toHaveLength(6);
    for (const call of calls) {
      // 注入 fetch 收到 signal：缺省 fetcher 每次调用都注入 AbortSignal
      expect(call.signal).toBeInstanceOf(AbortSignal);
      // 超时窗口从该次调用发起时起算（调用瞬间 signal 尚未 abort）
      expect(call.notAbortedAtCall).toBe(true);
    }
    // 超时经由 signal 生效：悬挂那次的 signal 在落定前已 abort
    expect(calls[0]?.url).toBe('/canvaskit/fonts/noto-sans-sc-chinese-simplified-400-normal.woff2');
    expect(calls[0]?.signal?.aborted).toBe(true);
    // 超时后按 missing 降级：其余 5 个照常注册
    expect(fonts.registered).toBe(5);
    expect(fonts.missing).toEqual([
      '/canvaskit/fonts/noto-sans-sc-chinese-simplified-400-normal.woff2',
    ]);
    consoleError.mockRestore();
  });
});
