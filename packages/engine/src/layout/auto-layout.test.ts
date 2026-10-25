/**
 * 自动布局主轴 fill 伸缩单测（工单 11 · ADR-0005 预声明例外）。
 *
 * seam：`solveAutoLayout`（纯求解）与 `layoutInputs` / `autoLayoutCommands`（文档接线）。
 * 语义对齐 Figma 主轴 fill：
 * - fill 子项按主轴剩余空间均分（替换内禀尺寸，可增可减）；
 * - min/max 是水位上下界：触界者退出均摊，余量在其余 fill 子项间重分配；
 * - fill 封顶后剩下的余量走主轴对齐（start/center/end）；
 * - 容器主轴为包裹（hug）时 fill 不可用（Figma 同轴 hug 下 fill 选项不可选），子项保持内禀尺寸；
 * - 可分配量为负：无 min 者钳到 0（负尺寸不是合法几何），有 min 者保 min（容器溢出）。
 *
 * ⚠ 本机（Windows/WSL）无 node/pnpm——本文件与实现一同提交，**测试由 dev 机执行**；
 *   在 dev 机跑红→绿之前不得声称任何用例已通过。
 */

import { describe, expect, it } from 'vitest';

import { CommandStack } from '../commands/index';
import {
  type AutoLayoutConfig,
  createDocument,
  createFrame,
  createPage,
  type DesignDocument,
  type ScenePage,
} from '../model/index';
import { getPage, insertNode } from '../scene/index';
import { autoLayoutCommands, layoutInputs, solveAutoLayout } from './auto-layout';

/** 求解输入配置（与 __verify__/layout-edges.test.ts 同款默认：水平、间距 8、内边距 8、固定尺寸）。 */
function config(over: Partial<AutoLayoutConfig> = {}): AutoLayoutConfig {
  return {
    direction: 'horizontal',
    spacing: 8,
    padding: { top: 8, right: 8, bottom: 8, left: 8 },
    primaryAxisAlign: 'start',
    counterAxisAlign: 'start',
    wrap: false,
    counterAxisSpacing: 8,
    widthSizing: 'fixed',
    heightSizing: 'fixed',
    ...over,
  };
}

/** 父容器（水平固定 300×100）+ 子画板（`autoLayout` 给 null 表示未开启布局）。 */
function parentWithChild(childAutoLayout: AutoLayoutConfig | null): {
  doc: DesignDocument;
  page: ScenePage;
  pageId: string;
} {
  let doc = createDocument({ id: 'd', pages: [createPage({ id: 'p1' })] });
  doc = insertNode(
    doc,
    'p1',
    createFrame({
      id: 'f',
      x: 0,
      y: 0,
      width: 300,
      height: 100,
      autoLayout: config({ spacing: 0 }),
    }),
    null,
  );
  doc = insertNode(
    doc,
    'p1',
    createFrame({
      id: 'child',
      x: 8,
      y: 8,
      width: 100,
      height: 50,
      autoLayout: childAutoLayout,
    }),
    'f',
  );
  return { doc, page: getPage(doc, 'p1'), pageId: 'p1' };
}

describe('布局 · 主轴 fill · 基础分配', () => {
  it('单个 fill 子项吃满主轴剩余空间（替换内禀尺寸）', () => {
    const result = solveAutoLayout(config({ spacing: 0 }), { width: 300, height: 100 }, [
      { id: 'a', width: 100, height: 20, mainSizing: 'fill' },
    ]);
    // 内容宽 = 300 - 16 = 284；fill 替换内禀 100
    expect(result.sizes.a).toEqual({ width: 284, height: 20 });
    expect(result.positions.a).toEqual({ x: 8, y: 8 });
    expect(result.frameSize).toEqual({ width: 300, height: 100 });
  });

  it('固定子项与多个 fill 混排：fill 均分「内容 − 固定项 − 间距」，间距计入所有相邻对', () => {
    const result = solveAutoLayout(config(), { width: 300, height: 100 }, [
      { id: 'a', width: 10, height: 20, mainSizing: 'fill' },
      { id: 'fixed', width: 60, height: 20 },
      { id: 'b', width: 10, height: 20, mainSizing: 'fill' },
    ]);
    // 可分配 = 284 - 60 - 2×8 = 208 → 各 104（子项声明序即视觉序：a → fixed → b）
    expect(result.sizes.a).toEqual({ width: 104, height: 20 });
    expect(result.sizes.b).toEqual({ width: 104, height: 20 });
    expect(result.sizes.fixed).toBeUndefined(); // 固定项不进 sizes
    expect(result.positions.a).toEqual({ x: 8, y: 8 });
    expect(result.positions.fixed).toEqual({ x: 120, y: 8 }); // 8 + 104 + 8
    expect(result.positions.b).toEqual({ x: 188, y: 8 }); // 120 + 60 + 8
    // 右边缘对齐右内边距：188 + 104 = 292 = 300 - 8
  });

  it('fill 可收缩到低于内禀尺寸（fill 是「解析尺寸」，不是只放不收）', () => {
    const result = solveAutoLayout(config({ spacing: 0 }), { width: 300, height: 100 }, [
      { id: 'fixed', width: 80, height: 20 },
      { id: 'a', width: 220, height: 20, mainSizing: 'fill' },
    ]);
    // 可分配 = 284 - 80 = 204 < 内禀 220 → 收缩
    expect(result.sizes.a).toEqual({ width: 204, height: 20 });
    expect(result.positions.fixed).toEqual({ x: 8, y: 8 });
    expect(result.positions.a).toEqual({ x: 88, y: 8 });
  });

  it('全部子项都是 fill：均分全部内容空间', () => {
    const result = solveAutoLayout(config({ spacing: 0 }), { width: 300, height: 100 }, [
      { id: 'a', width: 10, height: 20, mainSizing: 'fill' },
      { id: 'b', width: 10, height: 20, mainSizing: 'fill' },
    ]);
    expect(result.sizes.a?.width).toBe(142);
    expect(result.sizes.b?.width).toBe(142);
    expect(result.positions.b).toEqual({ x: 150, y: 8 }); // 8 + 142
  });
});

describe('布局 · 主轴 fill · min/max 水位边界', () => {
  it('min 下界：触界者拿 min 退出，余量在其余 fill 间重分配', () => {
    const result = solveAutoLayout(config(), { width: 300, height: 100 }, [
      { id: 'a', width: 10, height: 20, mainSizing: 'fill', mainMin: 150 },
      { id: 'b', width: 10, height: 20, mainSizing: 'fill' },
      { id: 'c', width: 10, height: 20, mainSizing: 'fill' },
    ]);
    // 均份 (284-16)/3 ≈ 89.3 < 150 → a 拿 150；余 118 → b、c 各 59
    expect(result.sizes.a?.width).toBe(150);
    expect(result.sizes.b?.width).toBe(59);
    expect(result.sizes.c?.width).toBe(59);
    expect(result.positions.a).toEqual({ x: 8, y: 8 });
    expect(result.positions.b).toEqual({ x: 166, y: 8 }); // 8 + 150 + 8
    expect(result.positions.c).toEqual({ x: 233, y: 8 }); // 166 + 59 + 8
  });

  it('max 上界：封顶后剩余余量走主轴对齐（end / center）', () => {
    const kids = [
      { id: 'a', width: 10, height: 20, mainSizing: 'fill' as const, mainMax: 60 },
      { id: 'b', width: 10, height: 20, mainSizing: 'fill' as const, mainMax: 60 },
    ];
    const end = solveAutoLayout(
      config({ spacing: 0, primaryAxisAlign: 'end' }),
      { width: 300, height: 100 },
      kids,
    );
    // 均份 142 > 60 → 各封顶 60；剩余 284 - 120 = 164 → end 偏移 164
    expect(end.sizes.a?.width).toBe(60);
    expect(end.positions.a).toEqual({ x: 172, y: 8 }); // 8 + 164
    expect(end.positions.b).toEqual({ x: 232, y: 8 }); // 172 + 60

    const center = solveAutoLayout(
      config({ spacing: 0, primaryAxisAlign: 'center' }),
      { width: 300, height: 100 },
      kids,
    );
    expect(center.positions.a).toEqual({ x: 90, y: 8 }); // 8 + 82
    expect(center.positions.b).toEqual({ x: 150, y: 8 });
  });

  it('min 优先于可用空间：空间不足时保 min、容器溢出（对齐 Figma）', () => {
    const result = solveAutoLayout(config({ spacing: 0 }), { width: 50, height: 100 }, [
      { id: 'fixed', width: 40, height: 20 },
      { id: 'a', width: 30, height: 20, mainSizing: 'fill', mainMin: 20 },
    ]);
    // 内容宽 34 < 固定项 40 → 可分配 -6；min 是硬下界 → a = 20，越出容器（沿用溢出语义）
    expect(result.sizes.a?.width).toBe(20);
    expect(result.positions.a).toEqual({ x: 48, y: 8 }); // 8 + 40
  });

  it('非法区间 min > max：min 胜出（与 CSS 同口径），不产出越界尺寸', () => {
    const result = solveAutoLayout(config({ spacing: 0 }), { width: 300, height: 100 }, [
      { id: 'a', width: 10, height: 20, mainSizing: 'fill', mainMin: 100, mainMax: 50 },
    ]);
    expect(result.sizes.a?.width).toBe(100);
  });

  it('水位分配不产出负几何：空间不足且无 min → fill 钳到 0', () => {
    const result = solveAutoLayout(config({ spacing: 0 }), { width: 50, height: 100 }, [
      { id: 'fixed', width: 40, height: 20 },
      { id: 'a', width: 30, height: 20, mainSizing: 'fill' },
    ]);
    expect(result.sizes.a?.width).toBe(0);
    expect(result.positions.a).toEqual({ x: 48, y: 8 });
    for (const size of Object.values(result.sizes)) {
      expect(size.width).toBeGreaterThanOrEqual(0);
      expect(size.height).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('布局 · 主轴 fill · 与既有语义集成', () => {
  it('反向轴（垂直主轴）：fill 沿高度分配，宽度保持内禀', () => {
    const result = solveAutoLayout(
      config({ direction: 'vertical', spacing: 0 }),
      { width: 100, height: 300 },
      [
        { id: 'a', width: 50, height: 40, mainSizing: 'fill' },
        { id: 'b', width: 50, height: 40, mainSizing: 'fill' },
      ],
    );
    // 可分配 = 300 - 16 = 284 → 各 142
    expect(result.sizes.a).toEqual({ width: 50, height: 142 });
    expect(result.sizes.b).toEqual({ width: 50, height: 142 });
    expect(result.positions.a).toEqual({ x: 8, y: 8 });
    expect(result.positions.b).toEqual({ x: 8, y: 150 }); // 8 + 142
  });

  it('主轴 hug 时 fill 不可用（对齐 Figma：同轴 hug 下 fill 不可选）→ 保持内禀尺寸', () => {
    const result = solveAutoLayout(
      config({ spacing: 0, widthSizing: 'hug' }),
      { width: 300, height: 100 },
      [{ id: 'a', width: 100, height: 20, mainSizing: 'fill' }],
    );
    expect(result.sizes.a).toBeUndefined();
    expect(result.frameSize.width).toBe(116); // 100 + 16：包裹按内禀尺寸
    expect(result.positions.a).toEqual({ x: 8, y: 8 });
  });

  it('fill 与交叉轴 stretch 叠加：主轴分配 + 交叉轴拉满同时生效', () => {
    const result = solveAutoLayout(
      config({ spacing: 0, counterAxisAlign: 'stretch' }),
      { width: 300, height: 100 },
      [{ id: 'a', width: 100, height: 20, mainSizing: 'fill' }],
    );
    expect(result.sizes.a).toEqual({ width: 284, height: 84 });
    expect(result.positions.a).toEqual({ x: 8, y: 8 });
  });

  it('无 fill 声明：结果与既有两遍求解逐字段一致（回归护栏）', () => {
    const result = solveAutoLayout(config(), { width: 300, height: 100 }, [
      { id: 'a', width: 20, height: 20 },
      { id: 'b', width: 30, height: 10 },
    ]);
    expect(result.positions.a).toEqual({ x: 8, y: 8 });
    expect(result.positions.b).toEqual({ x: 36, y: 8 });
    expect(result.sizes).toEqual({});
    expect(result.frameSize).toEqual({ width: 300, height: 100 });
  });
});

describe('布局 · 主轴 fill · 文档接线（layoutInputs 派生 + 命令落盘）', () => {
  it('layoutInputs 从子画板自身配置派生 fill 声明（Design IR 无 per-child 字段，格式不变）', () => {
    const { page } = parentWithChild(config({ spacing: 0, widthSizing: 'fill' }));
    expect(layoutInputs(page, 'f')?.children).toEqual([
      { id: 'child', width: 100, height: 50, mainSizing: 'fill' },
    ]);
  });

  it('未开启自动布局的子画板不派生 fill：子项保持内禀尺寸（fill 承载只在子画板自身 sizing）', () => {
    const { page } = parentWithChild(null);
    expect(layoutInputs(page, 'f')?.children).toEqual([{ id: 'child', width: 100, height: 50 }]);
  });

  it('autoLayoutCommands 把 fill 伸缩落盘；结果写回后再次求解收敛为空（幂等）', () => {
    const { doc, pageId } = parentWithChild(config({ spacing: 0, widthSizing: 'fill' }));
    const stack = new CommandStack(doc);
    const commands = autoLayoutCommands(getPage(stack.document, 'p1'), pageId, 'f');
    expect(commands).toContainEqual({
      type: 'node.update',
      pageId: 'p1',
      nodeId: 'child',
      patch: { width: 284, height: 50 },
    });
    stack.dispatch(commands);
    // 幂等：分配结果已写回文档 → 再次求解无命令（fill 不漂移）
    const again = autoLayoutCommands(getPage(stack.document, 'p1'), pageId, 'f');
    expect(again).toEqual([]);
  });
});
