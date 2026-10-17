/**
 * [独立验证 · engine] 自动布局边界：极端 gap/padding、嵌套 auto-layout、空容器。
 *
 * 重点观察：极值下求解结果是否产出**非法几何**（负宽高已钳制为契约）、命令是否只写变化、
 * 空容器与全隐藏子节点下的包裹尺寸。
 */

import { describe, expect, it } from 'vitest';

import { CommandStack } from '../commands/index';
import {
  autoLayoutCommands,
  hugDirections,
  initialLayoutSize,
  layoutInputs,
  solveAutoLayout,
} from '../layout/auto-layout';
import {
  type AutoLayoutConfig,
  createDocument,
  createFrame,
  createPage,
  createRect,
  type ScenePage,
} from '../model/index';
import { getPage, insertNode } from '../scene/index';

/** 默认布局配置。 */
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

/** 单画板 + 子节点页面。 */
function framePage(
  frameOver: Partial<Parameters<typeof createFrame>[0]>,
  kids: Array<Partial<Parameters<typeof createRect>[0]>>,
): { page: ScenePage; pageId: string } {
  let doc = createDocument({ id: 'd', pages: [createPage({ id: 'p1' })] });
  doc = insertNode(doc, 'p1', createFrame({ id: 'f', ...frameOver }), null);
  doc = kids.reduce(
    (acc, kid, index) =>
      insertNode(
        acc,
        'p1',
        createRect({ id: `k${index}`, x: 0, y: 0, width: 20, height: 20, ...kid }),
        'f',
      ),
    doc,
  );
  return { page: getPage(doc, 'p1'), pageId: 'p1' };
}

describe('[verify] 自动布局 · 极端 spacing / padding', () => {
  it('负 padding 会把内容推到容器外（当前不拒绝，记录实际行为）', () => {
    const result = solveAutoLayout(
      config({ padding: { top: -10, right: -10, bottom: -10, left: -10 }, widthSizing: 'hug' }),
      { width: 100, height: 50 },
      [{ id: 'a', width: 20, height: 20 }],
    );
    // hug 主尺寸 = 内容 20 + (-10 + -10) = 0；交叉轴 fixed → 保持 50
    expect(result.frameSize).toEqual({ width: 0, height: 50 });
    // 位置被负 padding 拉到负坐标（内容越出容器）
    expect(result.positions.a).toEqual({ x: -10, y: -10 });
  });

  it('wrap / counterAxisSpacing 在求解器中被完全忽略（类型承诺了换行，实现不换行）', () => {
    // 容器宽 100，两个 80 宽子项 + gap 8 → 若支持换行应分两行，实际横向溢出
    const result = solveAutoLayout(
      config({ wrap: true, counterAxisSpacing: 50, widthSizing: 'fixed' }),
      { width: 100, height: 40 },
      [
        { id: 'a', width: 80, height: 20 },
        { id: 'b', width: 80, height: 20 },
      ],
    );
    // 两个子项都在同一行，b 的 x = 8 + 80 + 8 = 96 → 右边缘 176 越出容器 100
    expect(result.positions.b).toEqual({ x: 96, y: 8 });
    expect(result.positions.a?.y).toBe(result.positions.b?.y);
    // counterAxisSpacing 完全不参与（数值与求解结果无关）
    const withoutSpacing = solveAutoLayout(
      config({ wrap: true, counterAxisSpacing: 0, widthSizing: 'fixed' }),
      { width: 100, height: 40 },
      [
        { id: 'a', width: 80, height: 20 },
        { id: 'b', width: 80, height: 20 },
      ],
    );
    expect(withoutSpacing).toEqual(result);
  });

  it('极大 gap：hug 容器主尺寸线性增长，子项位置累积 gap', () => {
    const kids = Array.from({ length: 5 }, (_, index) => ({
      id: `k${index}`,
      width: 10,
      height: 10,
    }));
    const result = solveAutoLayout(
      config({ spacing: 1e6, widthSizing: 'hug' }),
      { width: 0, height: 0 },
      kids,
    );
    // 5×10 + 4×1e6 + padding 16 = 66 + 4e6
    expect(result.frameSize.width).toBeCloseTo(4000066, 6);
    expect(result.positions.k4?.x).toBeCloseTo(8 + 4 * (10 + 1e6), 6);
  });

  it('spacing 为负（重叠堆叠）时位置递减但不报错', () => {
    const result = solveAutoLayout(
      config({ spacing: -15, widthSizing: 'fixed' }),
      { width: 100, height: 50 },
      [
        { id: 'a', width: 20, height: 20 },
        { id: 'b', width: 20, height: 20 },
      ],
    );
    expect(result.positions.a).toEqual({ x: 8, y: 8 });
    expect(result.positions.b).toEqual({ x: 13, y: 8 }); // 8 + 20 - 15
  });

  it('NaN / Infinity 尺寸污染：求解结果透传 NaN（校验缺口，记录实际行为）', () => {
    const result = solveAutoLayout(config({ widthSizing: 'hug' }), { width: 100, height: 50 }, [
      { id: 'a', width: Number.NaN, height: 10 },
    ]);
    expect(Number.isNaN(result.frameSize.width)).toBe(true);
    const infinite = solveAutoLayout(config({ widthSizing: 'hug' }), { width: 100, height: 50 }, [
      { id: 'a', width: Number.POSITIVE_INFINITY, height: 10 },
    ]);
    expect(infinite.frameSize.width).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('[verify] 自动布局 · 空容器与隐藏子节点', () => {
  it('空容器：hug 收成 padding 尺寸；fixed 保持不变', () => {
    const hug = solveAutoLayout(
      config({ widthSizing: 'hug', heightSizing: 'hug' }),
      { width: 100, height: 50 },
      [],
    );
    expect(hug.frameSize).toEqual({ width: 16, height: 16 }); // 仅 padding
    const fixed = solveAutoLayout(config(), { width: 100, height: 50 }, []);
    expect(fixed.frameSize).toEqual({ width: 100, height: 50 });
    // 空容器的 padding 0 → 0×0（不会出现负值）
    const zero = solveAutoLayout(
      config({
        widthSizing: 'hug',
        heightSizing: 'hug',
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
      }),
      { width: 100, height: 50 },
      [],
    );
    expect(zero.frameSize).toEqual({ width: 0, height: 0 });
  });

  it('全隐藏子节点：layoutInputs 过滤掉隐藏项 → 等价空容器', () => {
    const { page } = framePage(
      { width: 100, height: 100, autoLayout: config({ widthSizing: 'hug' }) },
      [{ visible: false }],
    );
    const inputs = layoutInputs(page, 'f');
    expect(inputs?.children).toEqual([]);
    const commands = autoLayoutCommands(page, 'p1', 'f');
    // 容器 hug 到 padding 尺寸 16
    expect(commands).toEqual([
      { type: 'node.update', pageId: 'p1', nodeId: 'f', patch: { width: 16, height: 100 } },
    ]);
  });

  it('空容器的 autoLayoutCommands 只改容器尺寸、不产生子命令', () => {
    const { page } = framePage(
      { width: 300, height: 100, autoLayout: config({ widthSizing: 'hug' }) },
      [],
    );
    const commands = autoLayoutCommands(page, 'p1', 'f');
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ nodeId: 'f', patch: { width: 16 } });
  });

  it('非画板 / 未开启自动布局：layoutInputs 与命令均为空', () => {
    const { page } = framePage({ width: 100, height: 100 }, []);
    expect(layoutInputs(page, 'k0')).toBeNull();
    expect(autoLayoutCommands(page, 'p1', 'k0')).toEqual([]);
    expect(autoLayoutCommands(page, 'p1', '幽灵')).toEqual([]);
    expect(autoLayoutOfSafe(page, 'f')).toBeNull();
  });

  it('initialLayoutSize 与 hugDirections 反映包裹方向', () => {
    const size = initialLayoutSize(config({ widthSizing: 'hug' }), [
      { id: 'a', width: 30, height: 40 },
    ]);
    // 容器入参为 0×0：主 hug = 30 + 16 = 46；交叉轴 fixed → 0
    expect(size).toEqual({ width: 46, height: 0 });
    expect(hugDirections(config({ widthSizing: 'hug' }))).toEqual({ width: true, height: false });
  });
});

/** 便捷：取容器当前自动布局配置（保持与实现同名的局部包装，避免直接依赖内部导出）。 */
function autoLayoutOfSafe(page: ScenePage, frameId: string): AutoLayoutConfig | null {
  const node = page.nodes[frameId];
  return node?.type === 'frame' ? node.autoLayout : null;
}

describe('[verify] 自动布局 · 嵌套 auto-layout', () => {
  it('嵌套：内层 hug 结果不会自动传导到外层（P0 不做迭代求解）', () => {
    // 外层 hug 水平，子项是内层画板（固定宽 100）；内层 hug 水平含 3 个 30 宽子项
    let doc = createDocument({ id: 'd', pages: [createPage({ id: 'p1' })] });
    doc = insertNode(
      doc,
      'p1',
      createFrame({
        id: 'outer',
        x: 0,
        y: 0,
        width: 400,
        height: 200,
        autoLayout: config({ widthSizing: 'hug' }),
      }),
      null,
    );
    doc = insertNode(
      doc,
      'p1',
      createFrame({
        id: 'inner',
        x: 0,
        y: 0,
        width: 100,
        height: 40,
        autoLayout: config({ widthSizing: 'hug' }),
      }),
      'outer',
    );
    for (let index = 0; index < 3; index += 1) {
      doc = insertNode(
        doc,
        'p1',
        createRect({ id: `ik${index}`, x: 0, y: 0, width: 30, height: 20 }),
        'inner',
      );
    }
    const page = getPage(doc, 'p1');

    // 外层求解只看内层现有宽高（100），不先求解内层
    const innerCommands = autoLayoutCommands(page, 'p1', 'inner');
    // 内层 hug：3*30 + 2*8 + 16 = 122
    expect(innerCommands).toContainEqual({
      type: 'node.update',
      pageId: 'p1',
      nodeId: 'inner',
      patch: { width: 122, height: 40 },
    });

    // 嵌套顺序：先内后外（内层 122 后外层再求解）→ 外层 hug 到 122+16=138
    const stack = new CommandStack(page2doc(page));
    stack.dispatch(autoLayoutCommands(page, 'p1', 'inner'));
    stack.dispatch(autoLayoutCommands(getPage(stack.document, 'p1'), 'p1', 'outer'));
    const outer = getPage(stack.document, 'p1').nodes.outer as { width: number };
    expect(outer.width).toBe(138);
    // 撤销内层求解后外层尺寸不会自动回退（两条独立历史：局部一致性由调用方保证）
    stack.undo();
    stack.undo();
    expect((getPage(stack.document, 'p1').nodes.outer as { width: number }).width).toBe(400);
  });

  it('嵌套 reverse 顺序（先外后内）会让外层包裹尺寸过期（记录实际行为）', () => {
    let doc = createDocument({ id: 'd', pages: [createPage({ id: 'p1' })] });
    doc = insertNode(
      doc,
      'p1',
      createFrame({
        id: 'outer',
        x: 0,
        y: 0,
        width: 400,
        height: 200,
        autoLayout: config({ widthSizing: 'hug' }),
      }),
      null,
    );
    doc = insertNode(
      doc,
      'p1',
      createFrame({
        id: 'inner',
        x: 0,
        y: 0,
        width: 100,
        height: 40,
        autoLayout: config({ widthSizing: 'hug' }),
      }),
      'outer',
    );
    doc = insertNode(
      doc,
      'p1',
      createRect({ id: 'ik0', x: 0, y: 0, width: 30, height: 20 }),
      'inner',
    );
    doc = insertNode(
      doc,
      'p1',
      createRect({ id: 'ik1', x: 0, y: 0, width: 30, height: 20 }),
      'inner',
    );
    const page = getPage(doc, 'p1');

    const stack = new CommandStack(page2doc(page));
    stack.dispatch(autoLayoutCommands(page, 'p1', 'outer')); // 外层先算：100 → 116
    expect((getPage(stack.document, 'p1').nodes.outer as { width: number }).width).toBe(116);
    stack.dispatch(autoLayoutCommands(getPage(stack.document, 'p1'), 'p1', 'inner')); // 内层再算：100 → 84
    // 外层包裹尺寸现在与实际内容（84）不一致，且不会自愈
    const outer = getPage(stack.document, 'p1').nodes.outer as { width: number };
    const inner = getPage(stack.document, 'p1').nodes.inner as { width: number };
    expect(inner.width).toBe(84);
    expect(outer.width).toBe(116);
    expect(outer.width - inner.width).toBe(32); // 期望 16（单侧 padding 8×2）
  });
});

/** 由页面重新装配成单页文档（命令栈需要文档）。 */
function page2doc(page: ScenePage) {
  return { id: 'd', name: '未命名文件', pages: [page], tokens: createDocument({ id: 't' }).tokens };
}

describe('[verify] 自动布局 · 交叉轴 stretch 与极端尺寸', () => {
  it('stretch 把子项拉到交叉轴内容尺寸；容器小于 padding 时钳制到 0（契约：不产出负尺寸）', () => {
    const normal = solveAutoLayout(
      config({ counterAxisAlign: 'stretch', heightSizing: 'fixed' }),
      { width: 200, height: 100 },
      [{ id: 'a', width: 20, height: 20 }],
    );
    // 交叉轴（高度）：内容 = 100 - 16 = 84 → 子项拉到 84
    expect(normal.sizes.a).toEqual({ width: 20, height: 84 });

    // 容器高度小于 padding 总和：交叉内容 10 - 8 - 8 = -6 → 钳制到 0（负尺寸不是合法几何）
    const degenerate = solveAutoLayout(
      config({ counterAxisAlign: 'stretch' }),
      { width: 200, height: 10 },
      [{ id: 'a', width: 20, height: 20 }],
    );
    expect(degenerate.sizes.a).toEqual({ width: 20, height: 0 });
    // 位置仍是 padding 起点（钳制不迁移布局起点）
    expect(degenerate.positions.a).toEqual({ x: 8, y: 8 });
    // 幂等：把钳制结果当输入再求解，结果不漂移
    const again = solveAutoLayout(
      config({ counterAxisAlign: 'stretch' }),
      { width: 200, height: 10 },
      [{ id: 'a', width: 20, height: degenerate.sizes.a?.height ?? -1 }],
    );
    expect(again.sizes.a).toEqual({ width: 20, height: 0 });

    // 命令层：不把负尺寸写进文档（patch 里没有负数）
    const { page } = framePage(
      { width: 200, height: 10, autoLayout: config({ counterAxisAlign: 'stretch' }) },
      [{ width: 20, height: 20 }],
    );
    const commands = autoLayoutCommands(page, 'p1', 'f');
    const childCommand = commands.find(
      (command) => command.type === 'node.update' && command.nodeId === 'k0',
    );
    expect(childCommand).toMatchObject({ patch: { height: 0 } });
    for (const command of commands) {
      if (command.type !== 'node.update') continue;
      for (const [key, value] of Object.entries(command.patch)) {
        if (typeof value === 'number')
          expect(value, `${command.nodeId}.${key}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('align center/end 只在有余量时偏移，余量为负时不产生负偏移', () => {
    const center = solveAutoLayout(
      config({ primaryAxisAlign: 'center' }),
      { width: 100, height: 50 },
      [{ id: 'a', width: 20, height: 20 }],
    );
    const leftover = 100 - 16 - 20;
    expect(center.positions.a?.x).toBeCloseTo(8 + leftover / 2, 9);
    const end = solveAutoLayout(config({ primaryAxisAlign: 'end' }), { width: 100, height: 50 }, [
      { id: 'a', width: 20, height: 20 },
    ]);
    expect(end.positions.a?.x).toBeCloseTo(8 + leftover, 9);
    // 反例：容器比内容小 → leftover 被 max(0, …) 截断为 0
    const overflow = solveAutoLayout(
      config({ primaryAxisAlign: 'end' }),
      { width: 10, height: 50 },
      [{ id: 'a', width: 20, height: 20 }],
    );
    expect(overflow.positions.a?.x).toBe(8);
  });
});
