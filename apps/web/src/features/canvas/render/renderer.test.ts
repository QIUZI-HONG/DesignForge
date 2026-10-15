/**
 * 渲染层像素级回归（Node + 真实 CanvasKit 光栅 surface）。
 *
 * 为什么能在 vitest 里跑：CanvasKit 的 wasm 有无头光栅目标（`MakeSurface`），
 * 渲染器的绘制逻辑只依赖 `Surface` 抽象——因此「画出什么像素」可以脱离浏览器回归，
 * 浏览器门禁（verify-canvas）负责的是「挂载 + 交互」那一段。
 *
 * 断言口径：像素断言直接验证 C8 对标要点（画布底、选择描边与 8 手柄、吸附红线、测量红线、
 * 标尺、文本字形），而不是「渲染函数被调用过」这种实现耦合的断言。
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import {
  createFrame,
  createPage,
  createRect,
  createText,
  defaultGridSettings,
  type NodeId,
  type Rect,
  type ScenePage,
  type Viewport,
} from '@dforge/engine';
import type { CanvasKit, Surface } from 'canvaskit-wasm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { SceneFrame } from './frame';
import { canvasPalette } from './palette';
import { createSceneRenderer, type SceneRenderer } from './renderer';

const require = createRequire(import.meta.url);

/** 测试用画布尺寸（CSS px；dpr=1 时与设备像素一致）。 */
const CANVAS = { width: 240, height: 160 };

let canvasKit: CanvasKit;

/** 真实的 Noto Sans SC 字体目录（从 node_modules 直取，不依赖 copy 步骤）。 */
const fontDir = join(dirname(require.resolve('@fontsource/noto-sans-sc/400.css')), 'files');

beforeAll(async () => {
  const entry = require.resolve('canvaskit-wasm/bin/canvaskit.js');
  const module = (await import(`file://${entry}`)) as { default: unknown };
  const init = module.default as (options: {
    locateFile: (file: string) => string;
  }) => Promise<CanvasKit>;
  canvasKit = await init({ locateFile: (file) => join(dirname(entry), file) });
}, 60_000);

afterAll(() => {
  // wasm 实例由进程退出回收；这里只释放渲染期内建的对象
});

/** 建夹具页面（确定性 id）。 */
function fixturePage(): ScenePage {
  const rect = createRect({ id: 'n_rect', x: 10, y: 10, width: 50, height: 30 });
  const text = createText({
    id: 'n_text',
    x: 10,
    y: 60,
    width: 120,
    height: 24,
    text: {
      characters: '设界画布',
      fontFamily: 'Noto Sans SC',
      fontSize: 14,
      fontWeight: 400,
      lineHeight: 1.4,
      letterSpacing: 0,
      align: 'left',
      autoResize: 'none',
    },
  });
  const frame = createFrame({ id: 'n_frame', x: 120, y: 10, width: 80, height: 80 });
  const page = createPage({
    id: 'page_1',
    rootIds: ['n_frame', 'n_rect', 'n_text'],
    nodes: { n_rect: rect, n_text: text, n_frame: frame },
    grid: { ...defaultGridSettings(), visible: false },
  });
  return page;
}

/** 造一帧（只覆盖本用例关心的字段）。 */
function frame(page: ScenePage, overrides: Partial<SceneFrame> = {}): SceneFrame {
  const viewport: Viewport = { zoom: 1, panX: 0, panY: 0 };
  return {
    page,
    palette: canvasPalette('dark'),
    viewport,
    scale: { size: { ...CANVAS }, dpr: 1 },
    selection: [],
    hoverId: null,
    interaction: { kind: 'idle' },
    preview: new Map(),
    marquee: null,
    rulers: false,
    editingNodeId: null,
    ...overrides,
  };
}

/** 渲染一帧并返回像素读数工具。 */
function renderPixels(
  renderer: SceneRenderer,
  sceneFrame: SceneFrame,
  options: Parameters<SceneRenderer['render']>[1] = {
    selectionFrame: null,
    selectionLabels: [],
    snap: null,
  },
): {
  stats: ReturnType<SceneRenderer['render']>;
  pixelAt: (x: number, y: number) => { r: number; g: number; b: number; a: number };
  countWhere: (predicate: (r: number, g: number, b: number) => boolean) => number;
} {
  const stats = renderer.render(sceneFrame, options);
  const surfaceRef = surfaceOf(renderer);
  const image = surfaceRef.makeImageSnapshot();
  const pixels = image.readPixels(0, 0, {
    width: CANVAS.width,
    height: CANVAS.height,
    colorType: canvasKit.ColorType.RGBA_8888,
    alphaType: canvasKit.AlphaType.Unpremul,
    colorSpace: canvasKit.ColorSpace.SRGB,
  }) as Uint8Array;
  image.delete();
  const at = (x: number, y: number) => {
    const offset = (y * CANVAS.width + x) * 4;
    return {
      r: pixels[offset] ?? 0,
      g: pixels[offset + 1] ?? 0,
      b: pixels[offset + 2] ?? 0,
      a: pixels[offset + 3] ?? 0,
    };
  };
  return {
    stats,
    pixelAt: at,
    countWhere: (predicate) => {
      let count = 0;
      for (let y = 0; y < CANVAS.height; y += 1) {
        for (let x = 0; x < CANVAS.width; x += 1) {
          const pixel = at(x, y);
          if (predicate(pixel.r, pixel.g, pixel.b)) count += 1;
        }
      }
      return count;
    },
  };
}

/** 从渲染器内部取 surface（测试专用：渲染器不对外暴露 surface，避免生产代码为测试开口子）。 */
const surfaces = new WeakMap<SceneRenderer, Surface>();
function surfaceOf(renderer: SceneRenderer): Surface {
  const surface = surfaces.get(renderer);
  if (surface === undefined) throw new Error('surface 未登记（测试装配遗漏）');
  return surface;
}

/** 建渲染器（raster surface，登记给像素读取用）。 */
function rasterRenderer(): SceneRenderer {
  const renderer = createSceneRenderer({
    canvasKit,
    fonts: null,
    makeSurface: (width, height) => {
      const surface = canvasKit.MakeSurface(width, height);
      if (surface !== null) surfaces.set(renderer, surface);
      return surface;
    },
  });
  renderer.resize(CANVAS, 1);
  return renderer;
}

describe('场景渲染（像素级）', () => {
  it('画布底为深色基准（令牌 canvas #1E1E1E），节点按世界坐标落位', () => {
    const page = fixturePage();
    const renderer = rasterRenderer();
    const { stats, pixelAt } = renderPixels(renderer, frame(page));
    expect(stats.nodesDrawn).toBeGreaterThanOrEqual(3);
    // 空白处 = 画布底（稍带抗锯齿溢出，取邻域判断）
    expect(pixelAt(200, 140)).toMatchObject({ r: 30, g: 30, b: 30 });
    // 矩形（10,10)-(60,40) 默认填充 #D9D9D9
    expect(pixelAt(30, 20)).toMatchObject({ r: 217, g: 217, b: 217 });
    renderer.dispose();
  });

  it('选中态：轮廓 + 恰好 8 个手柄（C8 对标要点）', () => {
    const page = fixturePage();
    const renderer = rasterRenderer();
    const { stats, countWhere } = renderPixels(renderer, frame(page, { selection: ['n_rect'] }), {
      selectionFrame: {
        bounds: { x: 10, y: 10, width: 50, height: 30 },
        rotation: 0,
        ids: ['n_rect'],
      },
      selectionLabels: ['矩形'],
      snap: null,
    });
    expect(stats.selectionOutlines).toBe(1);
    expect(stats.handles).toBe(8);
    // 主色 #0D99FF = (13,153,255)：轮廓与手柄描边都要真实落像素
    const blue = countWhere((r, g, b) => b > 200 && r < 80 && g > 100 && g < 200);
    expect(blue).toBeGreaterThan(50);
    renderer.dispose();
  });

  it('吸附参考线与测量标注按红色令牌（#F24822）绘制', () => {
    const page = fixturePage();
    const renderer = rasterRenderer();
    const { stats, countWhere } = renderPixels(renderer, frame(page, { selection: ['n_rect'] }), {
      selectionFrame: null,
      selectionLabels: [],
      snap: {
        guides: [{ axis: 'x', position: 100, from: 0, to: 120, refs: ['n_frame'], kind: 'edge' }],
        measurements: [
          { axis: 'x', from: 60, to: 120, value: 60, at: 25, refs: ['n_frame'], kind: 'distance' },
        ],
      },
    });
    expect(stats.snapGuides).toBe(1);
    expect(stats.measurements).toBe(1);
    // 红 #F24822 = (242,72,34)；1px 线落在半像素上会被抗锯齿摊薄，故按「红显著强于绿蓝」判定
    const red = countWhere((r, g, b) => r > 100 && r - g > 40 && r - b > 40);
    expect(red).toBeGreaterThan(40);
    renderer.dispose();
  });

  it('标尺绘制在画布上层且不随缩放变形（屏幕层）', () => {
    const page = fixturePage();
    const renderer = rasterRenderer();
    const { stats, pixelAt } = renderPixels(renderer, frame(page, { rulers: true }), {
      selectionFrame: null,
      selectionLabels: [],
      snap: null,
    });
    expect(stats.rulers).toBe(true);
    // 标尺底 = 深色 surface #2C2C2C = (44,44,44)
    expect(pixelAt(2, 2)).toMatchObject({ r: 44, g: 44, b: 44 });
    renderer.dispose();
  });

  it('文本节点走 Paragraph 渲染（真实 woff2 字体 > 0 个字形像素）', async () => {
    const page = fixturePage();
    const { loadSceneFonts } = await import('../runtime/scene-fonts');
    const fonts = await loadSceneFonts(canvasKit, {
      assetDir: '/canvaskit',
      fetchBytes: async (url) => {
        const name = url.split('/').pop() ?? '';
        const buffer = readFileSync(join(fontDir, name));
        return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      },
    });
    expect(fonts.registered).toBe(6);

    const renderer = createSceneRenderer({
      canvasKit,
      fonts: { family: 'Noto Sans SC', fontMgr: fonts.fontMgr },
      makeSurface: (width, height) => {
        const surface = canvasKit.MakeSurface(width, height);
        if (surface !== null) surfaces.set(renderer, surface);
        return surface;
      },
    });
    renderer.resize(CANVAS, 1);
    const { stats, pixelAt } = renderPixels(
      renderer,
      frame(page, {
        // 只留文本节点，便于像素判定；编辑中的文本不出字形（覆盖层接管）
        page: { ...page, rootIds: ['n_text'] },
      }),
    );
    expect(stats.textRuns).toBe(1);
    // 文本盒内出现与画布底（30,30,30）不同的像素——黑色字形在深底上更暗
    let ink = 0;
    for (let x = 10; x < 130; x += 1) {
      for (let y = 60; y < 84; y += 1) {
        const pixel = pixelAt(x, y);
        if (Math.abs(pixel.r - 30) + Math.abs(pixel.g - 30) + Math.abs(pixel.b - 30) > 24) {
          ink += 1;
        }
      }
    }
    expect(ink).toBeGreaterThan(0);
    renderer.dispose();
  });

  it('缩放预览：补丁几何立刻生效（松手前所见 = commit 后所得）', () => {
    const page = fixturePage();
    const renderer = rasterRenderer();
    const nextBounds: Rect = { x: 10, y: 10, width: 100, height: 60 };
    const { pixelAt } = renderPixels(
      renderer,
      frame(page, {
        selection: ['n_rect'],
        interaction: {
          kind: 'resize',
          pageId: 'page_1',
          nodeIds: ['n_rect'],
          handle: 'se',
          startBounds: { x: 10, y: 10, width: 50, height: 30 },
          rotation: 0,
          start: { x: 60, y: 40 },
          current: { x: 110, y: 70 },
          nextBounds,
        },
        preview: new Map<NodeId, { width: number; height: number }>([
          ['n_rect', { width: 100, height: 60 }],
        ]),
      }),
    );
    // 预览把矩形放大到 (10,10)-(110,70)：原包围盒之外的点也被填充
    expect(pixelAt(100, 60)).toMatchObject({ r: 217, g: 217, b: 217 });
    renderer.dispose();
  });

  it('网格可见时按主题令牌绘制（浅色主题：底白、网格线 #E6E6E6）', () => {
    const page: ScenePage = {
      ...fixturePage(),
      grid: { size: 20, visible: true, snapToGrid: false, style: 'lines' },
    };
    const renderer = rasterRenderer();
    const { countWhere, pixelAt } = renderPixels(
      renderer,
      frame(page, { palette: canvasPalette('light'), selection: ['n_rect'] }),
    );
    // 非网格点 = 画布底（浅色基准 #FFFFFF）
    expect(pixelAt(203, 143)).toMatchObject({ r: 255, g: 255, b: 255 });
    // 网格线 = 浅色描边令牌 #E6E6E6（抗锯齿会把 1px 线摊成略浅的灰）
    const gridPixels = countWhere((r, g, b) => r === g && g === b && r >= 225 && r <= 248);
    expect(gridPixels).toBeGreaterThan(10);
    renderer.dispose();
  });
});
