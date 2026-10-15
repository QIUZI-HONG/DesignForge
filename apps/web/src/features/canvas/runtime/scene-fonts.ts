/**
 * 画布字体（ADR-0003：Noto Sans SC 离线捆绑，**不得静默回退**）。
 *
 * CanvasKit 的 FontMgr 按字形覆盖做回退：注册「CJK 全量单文件 + 拉丁单文件」× 三档字重，
 * 中文与 ASCII 都由 Noto Sans SC 出字；注册失败时**显式报错**（console.error + 状态返回），
 * 由调用方决定如何呈现——绝不悄悄换成别的字体。
 */

import type { CanvasKit, FontMgr } from 'canvaskit-wasm';

/** 与 UI 侧同一个字体族名（layout.tsx 引入 @fontsource/noto-sans-sc 的 400/500/700）。 */
export const SCENE_FONT_FAMILY = 'Noto Sans SC';

/** 注册的字重档。 */
export const SCENE_FONT_WEIGHTS: readonly number[] = [400, 500, 700];

/** 子集标识 → 文件名片段。 */
const SUBSETS = ['chinese-simplified', 'latin'] as const;

/** 字体资产文件名。 */
export function sceneFontFileName(weight: number, subset: string): string {
  return `noto-sans-sc-${subset}-${weight}-normal.woff2`;
}

/** 场景字体加载结果。 */
export interface SceneFonts {
  /** 字体管理器（ParagraphBuilder 用）。 */
  fontMgr: FontMgr;
  /** 实际注册成功的 typeface 数量（0 → 加载失败）。 */
  registered: number;
  /** 缺失的文件（加载失败的 URL；非空表示字体不完整，调用方应显现出来）。 */
  missing: string[];
}

/** 加载选项。 */
export interface LoadSceneFontsOptions {
  /** 资产目录（与 CanvasKit 同源，默认 `/canvaskit`）。 */
  assetDir?: string;
  /** fetcher（测试注入）。 */
  fetchBytes?: (url: string) => Promise<ArrayBuffer>;
}

/** 默认取字节：fetch → arrayBuffer。 */
async function defaultFetchBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
  return response.arrayBuffer();
}

/**
 * 加载并注册场景字体。
 *
 * 返回 `registered === 0` 表示一个字体都没成功——调用方必须把它当**错误态**处理
 * （例如画布上给「字体加载失败」提示），而不是当无字形的正常情况。
 */
export async function loadSceneFonts(
  canvasKit: CanvasKit,
  options: LoadSceneFontsOptions = {},
): Promise<SceneFonts> {
  const assetDir = (options.assetDir ?? '/canvaskit').replace(/\/$/, '');
  const fetchBytes = options.fetchBytes ?? defaultFetchBytes;
  const buffers: ArrayBuffer[] = [];
  const missing: string[] = [];
  for (const weight of SCENE_FONT_WEIGHTS) {
    for (const subset of SUBSETS) {
      const url = `${assetDir}/fonts/${sceneFontFileName(weight, subset)}`;
      try {
        buffers.push(await fetchBytes(url));
      } catch (error) {
        missing.push(url);
        console.error(`[canvas] 字体加载失败：${url}`, error);
      }
    }
  }
  if (buffers.length === 0) {
    console.error('[canvas] 没有任何 Noto Sans SC 字体注册成功——画布文本将不可渲染');
    // FontMgr 为空时 CanvasKit 返回 null：这里给一个空 provider 让上层拿到稳定对象（registered=0 已是错误信号）
    const empty = canvasKit.TypefaceFontProvider.Make();
    return { fontMgr: empty, registered: 0, missing };
  }
  const fontMgr = canvasKit.FontMgr.FromData(...buffers);
  if (fontMgr === null) {
    console.error('[canvas] FontMgr.FromData 返回 null（字体数据无法解析）');
    return { fontMgr: canvasKit.TypefaceFontProvider.Make(), registered: 0, missing };
  }
  return { fontMgr, registered: buffers.length, missing };
}
