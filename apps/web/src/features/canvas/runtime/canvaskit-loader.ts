/**
 * CanvasKit（Skia WASM）引导（C8 渲染基座）。
 *
 * 加载口径：`<script src>` 载入 emscripten 胶水脚本 → 取全局 `CanvasKitInit` → 用 `locateFile`
 * 指向同目录的 `.wasm`。**不 import 运行时**（胶水脚本对打包器不友好），只 import 类型；
 * 因此本模块在 Node/jsdom 下可被静态分析，运行时行为由注入的 `loadScript` 决定（测试注入假脚本）。
 *
 * 单例语义：同一页面只初始化一次 Skia（wasm 实例 ~7MB，重复初始化既是浪费也会互相干扰）；
 * 并发调用共享同一个 Promise（single-flight）；失败**不缓存**——下一次调用可重试。
 */

import type { CanvasKit } from 'canvaskit-wasm';

/** 资产目录（由 `tools/copy-canvaskit-assets.mjs` 落盘到 apps/web/public）。 */
export const DEFAULT_CANVASKIT_ASSET_DIR = '/canvaskit';

/** CanvasKit 全局初始化函数（胶水脚本注入）。 */
type CanvasKitInitFn = (options: { locateFile: (file: string) => string }) => Promise<CanvasKit>;

/** 全局名（胶水脚本的 MODULARIZE 产物）。 */
const GLOBAL_INIT_KEY = 'CanvasKitInit';

/** 加载选项（测试注入）；生产路径不传。 */
export interface LoadCanvasKitOptions {
  /** 资产目录（默认 `/canvaskit`）。 */
  assetDir?: string;
  /** 脚本加载器（默认用 `<script>` 标签注入；测试注入以避免真实网络）。 */
  loadScript?: (src: string) => Promise<void>;
}

/** 已加载实例缓存（失败不写缓存）。 */
let cached: Promise<CanvasKit> | null = null;

/** 资产目录下的胶水脚本 URL。 */
export function canvaskitScriptUrl(assetDir: string = DEFAULT_CANVASKIT_ASSET_DIR): string {
  return `${assetDir.replace(/\/$/, '')}/canvaskit.js`;
}

/** 默认脚本加载器：注入 `<script>` 并等 onload/onerror（幂等：同 src 只插一次）。 */
function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('当前环境没有 document，无法注入 CanvasKit 脚本'));
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-df-canvaskit="${src}"]`,
    );
    if (existing !== null) {
      // 已有同源脚本：等到它加载完成（就绪或失败都已在 onload/onerror 处理过，这里直接放行）
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.dfCanvaskit = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`CanvasKit 脚本加载失败：${src}`));
    document.head.appendChild(script);
  });
}

/** 取全局 CanvasKitInit（胶水脚本加载后存在）。 */
function globalInit(): CanvasKitInitFn | null {
  const value = (globalThis as Record<string, unknown>)[GLOBAL_INIT_KEY];
  return typeof value === 'function' ? (value as CanvasKitInitFn) : null;
}

/**
 * 加载（或复用）CanvasKit 实例。
 *
 * @throws Error 脚本加载失败 / 全局 CanvasKitInit 缺失 / wasm 初始化失败
 */
export function loadCanvasKit(options: LoadCanvasKitOptions = {}): Promise<CanvasKit> {
  if (cached !== null) return cached;
  const assetDir = options.assetDir ?? DEFAULT_CANVASKIT_ASSET_DIR;
  const loadScript = options.loadScript ?? injectScript;
  const attempt = (async (): Promise<CanvasKit> => {
    await loadScript(canvaskitScriptUrl(assetDir));
    const init = globalInit();
    if (init === null) {
      throw new Error('CanvasKit 脚本已加载，但全局 CanvasKitInit 不存在（资产损坏？）');
    }
    return init({ locateFile: (file) => `${assetDir.replace(/\/$/, '')}/${file}` });
  })();
  const guarded = attempt.catch((error: unknown) => {
    cached = null; // 失败不缓存：允许下一次重试（例如网络恢复）
    throw error;
  });
  cached = guarded;
  return guarded;
}

/** 清空实例缓存（测试与「重新初始化」场景用）。 */
export function resetCanvasKitCache(): void {
  cached = null;
}
