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

  it('脚本加载失败：失败标签摘除，网络恢复后重试真实可用（§E1 回归）', async () => {
    const first = loadCanvasKit();
    const failed = document.querySelector<HTMLScriptElement>('script[data-df-canvaskit]');
    expect(failed).not.toBeNull();
    failed?.dispatchEvent(new Event('error'));
    await expect(first).rejects.toThrow('CanvasKit 脚本加载失败');

    // 失败标签必须摘除：残留标签会让重试误判「已就绪」直接放行 → globalInit() 为 null，
    // 整页会话只有刷新才能恢复（证据 §E1 的毒化路径）
    expect(document.querySelector('script[data-df-canvaskit]')).toBeNull();

    // 网络恢复：重试注入**新**标签并成功初始化
    (globalThis as Record<string, unknown>).CanvasKitInit = vi.fn(async () => FAKE_INSTANCE);
    const retry = loadCanvasKit();
    const fresh = document.querySelector<HTMLScriptElement>('script[data-df-canvaskit]');
    expect(fresh).not.toBeNull();
    expect(fresh).not.toBe(failed);
    fresh?.dispatchEvent(new Event('load'));
    await expect(retry).resolves.toBe(FAKE_INSTANCE);
    expect(document.querySelectorAll('script[data-df-canvaskit]')).toHaveLength(1);
  });

  it('同源标签仍在加载：重入调用跟随原标签结算，不插重复标签也不提前放行', async () => {
    const first = loadCanvasKit();
    const tag = document.querySelector<HTMLScriptElement>('script[data-df-canvaskit]');
    expect(tag).not.toBeNull();

    // 模拟缓存中途被清后的重入：标签仍在加载，第二次调用不得另插标签，
    // 也不得在脚本就绪前放行（提前 resolve 会让 globalInit() 读到 null 而误报资产损坏）
    resetCanvasKitCache();
    const second = loadCanvasKit();
    let settled = false;
    second.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    expect(document.querySelectorAll('script[data-df-canvaskit]')).toHaveLength(1);

    // 排空事件循环后再探：若实现是「见标签即放行」，第二次调用此刻已提前结算（红）；
    // 正确实现应仍 pending，直到脚本真正到达
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);

    // 脚本「到达」：先定义全局初始化函数、再触发 load（真实执行顺序）
    (globalThis as Record<string, unknown>).CanvasKitInit = vi.fn(async () => FAKE_INSTANCE);
    tag?.dispatchEvent(new Event('load'));
    await expect(first).resolves.toBe(FAKE_INSTANCE);
    await expect(second).resolves.toBe(FAKE_INSTANCE);
    expect(settled).toBe(true);
  });

  it('同源标签已就绪：重置缓存后重载复用已加载标签，不插重复标签', async () => {
    (globalThis as Record<string, unknown>).CanvasKitInit = vi.fn(async () => FAKE_INSTANCE);
    const first = loadCanvasKit();
    document
      .querySelector<HTMLScriptElement>('script[data-df-canvaskit]')
      ?.dispatchEvent(new Event('load'));
    await expect(first).resolves.toBe(FAKE_INSTANCE);

    // 「重新初始化」场景：脚本已就绪，重载不应重新注入，直接复用
    resetCanvasKitCache();
    const reload = loadCanvasKit();
    expect(document.querySelectorAll('script[data-df-canvaskit]')).toHaveLength(1);
    await expect(reload).resolves.toBe(FAKE_INSTANCE);
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
