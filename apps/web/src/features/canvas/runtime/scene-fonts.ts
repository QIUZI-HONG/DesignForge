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
  /** 单文件取字节超时上限（毫秒；测试注入小值——生产走缺省，不真等）。 */
  fetchTimeoutMs?: number;
}

/**
 * 单文件取字节的缺省超时上限（毫秒）。字体是**同源静态资产**（`/canvaskit` 产物），
 * 本机毫秒级可达；10s 只防资产服务器/代理挂死时的无界悬挂（quality-p1 · B9：
 * 有界失败——超时走既有 missing 降级路径，不悬挂画布启动）。
 */
export const SCENE_FONT_FETCH_TIMEOUT_MS = 10_000;

/** 默认取字节：fetch（带超时 signal）→ arrayBuffer。 */
async function defaultFetchBytes(url: string, timeoutMs: number): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
  return response.arrayBuffer();
}

/**
 * 给一段取字节的 promise 加总预算：到点未落定即按超时失败（quality-p1 · B9）。
 *
 * 为什么不只靠 `AbortSignal.timeout`：注入的 fetchBytes 替身可能不理会 signal——
 * race 保证本函数到点必然落定（与 `lib/request-timeout` 同一「race + abort 只写一份」
 * 的口径；此处不引入该模块是为保持本模块零 lib 依赖、被 worker/画布运行时直接引用）。
 * 迟到的拒绝由吞错分支消费（不产生 unhandled rejection）；胜利路径撤掉计时器。
 */
function withinDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`字体加载超时（${String(timeoutMs)}ms）`)),
      timeoutMs,
    );
  });
  timeout.catch(() => undefined); // 迟到的拒绝必须有消费者
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * 加载并注册场景字体。
 *
 * 返回 `registered === 0` 表示一个字体都没成功——调用方必须把它当**错误态**处理
 * （例如画布上给「字体加载失败」提示），而不是当无字形的正常情况。
 *
 * 并行口径（quality-p1 · B9）：weights × subsets 全部**并行**发起（页间无依赖；
 * 串行实现是装载期 N × RTT 的启动延迟）；每个文件独立有界失败——超时/失败走既有
 * missing 降级路径（登记 + console.error，不整批放弃，不悬挂启动）。结果顺序与
 * URL 清单一致（FontMgr 注册顺序确定性不变）。
 */
export async function loadSceneFonts(
  canvasKit: CanvasKit,
  options: LoadSceneFontsOptions = {},
): Promise<SceneFonts> {
  const assetDir = (options.assetDir ?? '/canvaskit').replace(/\/$/, '');
  const timeoutMs = options.fetchTimeoutMs ?? SCENE_FONT_FETCH_TIMEOUT_MS;
  const fetchBytes = options.fetchBytes ?? ((url: string) => defaultFetchBytes(url, timeoutMs));
  const urls = SCENE_FONT_WEIGHTS.flatMap((weight) =>
    SUBSETS.map((subset) => `${assetDir}/fonts/${sceneFontFileName(weight, subset)}`),
  );

  const missing: string[] = [];
  // 按索引收集（Promise.all 保位）：missing 顺序 = URL 清单顺序（登记顺序确定性，与串行实现一致）
  const settled = await Promise.all(
    urls.map(async (url, index) => {
      try {
        return { index, buffer: await withinDeadline(fetchBytes(url), timeoutMs) };
      } catch (error) {
        return { index, url, error };
      }
    }),
  );
  const buffers: ArrayBuffer[] = [];
  for (const entry of settled) {
    if ('buffer' in entry) {
      buffers.push(entry.buffer);
      continue;
    }
    missing.push(entry.url);
    console.error(`[canvas] 字体加载失败：${entry.url}`, entry.error);
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
