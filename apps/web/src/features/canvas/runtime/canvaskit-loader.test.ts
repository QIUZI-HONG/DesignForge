// @vitest-environment jsdom
/**
 * CanvasKit 引导测试（jsdom）：脚本注入 → 全局 CanvasKitInit → 单例缓存与失败重试。
 *
 * 这里不加载真实 wasm（7MB 且 jsdom 无 WebAssembly 图形栈）——引导的**契约**才是被测对象：
 * 脚本 URL、locateFile 拼接、并发 single-flight、失败不缓存。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  canvaskitScriptUrl,
  DEFAULT_CANVASKIT_ASSET_DIR,
  loadCanvasKit,
  resetCanvasKitCache,
} from './canvaskit-loader';

/** 假 CanvasKit 实例（只保留引导关心的形状）。 */
const FAKE_INSTANCE = { kind: 'fake-canvaskit' } as unknown as never;

afterEach(() => {
  resetCanvasKitCache();
  delete (globalThis as Record<string, unknown>).CanvasKitInit;
  document.head.innerHTML = '';
});

describe('canvaskitScriptUrl', () => {
  it('默认指向 /canvaskit/canvaskit.js，且容忍尾斜杠', () => {
    expect(canvaskitScriptUrl()).toBe(`${DEFAULT_CANVASKIT_ASSET_DIR}/canvaskit.js`);
    expect(canvaskitScriptUrl('/assets/ck/')).toBe('/assets/ck/canvaskit.js');
  });
});

describe('loadCanvasKit', () => {
  it('注入脚本后调用全局 CanvasKitInit，并把 wasm 定位到同一资产目录', async () => {
    const initCalls: Array<(file: string) => string> = [];
    (globalThis as Record<string, unknown>).CanvasKitInit = vi.fn(
      async (options: { locateFile: (file: string) => string }) => {
        initCalls.push(options.locateFile);
        return FAKE_INSTANCE;
      },
    );
    const loadScript = vi.fn(async () => undefined);

    const instance = await loadCanvasKit({ loadScript });
    expect(instance).toBe(FAKE_INSTANCE);
    expect(loadScript).toHaveBeenCalledWith('/canvaskit/canvaskit.js');
    expect(initCalls[0]?.('canvaskit.wasm')).toBe('/canvaskit/canvaskit.wasm');
  });

  it('并发调用共享同一次初始化（single-flight）', async () => {
    const init = vi.fn(async () => FAKE_INSTANCE);
    (globalThis as Record<string, unknown>).CanvasKitInit = init;
    const loadScript = vi.fn(async () => undefined);

    const [a, b] = await Promise.all([
      loadCanvasKit({ loadScript }),
      loadCanvasKit({ loadScript }),
    ]);
    expect(a).toBe(b);
    expect(loadScript).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledTimes(1);
  });

  it('脚本加载失败时抛出原因（不静默、不缓存失败）', async () => {
    const loadScript = vi.fn(async () => {
      throw new Error('CanvasKit 脚本加载失败：/canvaskit/canvaskit.js');
    });
    await expect(loadCanvasKit({ loadScript })).rejects.toThrow('脚本加载失败');

    // 第二次尝试应重新走脚本加载（失败未进缓存）
    (globalThis as Record<string, unknown>).CanvasKitInit = vi.fn(async () => FAKE_INSTANCE);
    const retryScript = vi.fn(async () => undefined);
    await expect(loadCanvasKit({ loadScript: retryScript })).resolves.toBe(FAKE_INSTANCE);
    expect(retryScript).toHaveBeenCalledTimes(1);
  });

  it('脚本就绪但全局 CanvasKitInit 缺失时报错', async () => {
    const loadScript = vi.fn(async () => undefined);
    await expect(loadCanvasKit({ loadScript })).rejects.toThrow('CanvasKitInit 不存在');
  });

  it('默认加载器注入带 data 标记的 script 标签', async () => {
    const loadScriptDefault = async (): Promise<void> => undefined;
    void loadScriptDefault;
    (globalThis as Record<string, unknown>).CanvasKitInit = vi.fn(async () => FAKE_INSTANCE);
    const promise = loadCanvasKit();
    // 等一轮微任务让 script.onload 触发（jsdom 不会真的加载外部脚本）
    const script = document.querySelector<HTMLScriptElement>('script[data-df-canvaskit]');
    script?.onload?.(new Event('load'));
    await expect(promise).resolves.toBe(FAKE_INSTANCE);
    expect(script?.getAttribute('src')).toBe('/canvaskit/canvaskit.js');
  });
});
