/**
 * 场景字体加载测试：注册数量、缺失登记、全失败时的错误态（禁止静默回退）。
 */

import type { CanvasKit } from 'canvaskit-wasm';
import { describe, expect, it, vi } from 'vitest';

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

/** 全量成功的 fetcher。 */
const okFetcher = async (): Promise<ArrayBuffer> => new ArrayBuffer(8);

describe('sceneFontFileName', () => {
  it('命名与 @fontsource 产物一致（复制脚本与加载器共用同一规则）', () => {
    expect(sceneFontFileName(400, 'chinese-simplified')).toBe(
      'noto-sans-sc-chinese-simplified-400-normal.woff2',
    );
    expect(sceneFontFileName(700, 'latin')).toBe('noto-sans-sc-latin-700-normal.woff2');
  });
});

describe('loadSceneFonts', () => {
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
});
