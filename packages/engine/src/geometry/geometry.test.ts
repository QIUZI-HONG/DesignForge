import { describe, expect, it } from 'vitest';

import {
  createDocument,
  createEllipse,
  createFrame,
  createGroup,
  createPage,
  createRect,
  type DesignDocument,
  type NodeId,
} from '../model/index';
import { getPage, insertNode, insertNodes } from '../scene/index';
import {
  applyToPoint,
  boundsOfPoints,
  clickSelectionTarget,
  HANDLE_IDS,
  type HandleId,
  hitTestAll,
  hitTestHandle,
  hitTestPoint,
  invert,
  localPointToWorld,
  marqueeSelect,
  multiply,
  nodeContainsLocalPoint,
  normalizeAngle,
  quadIntersectsRect,
  rectContainsRect,
  resizeRect,
  resizeRotatedNode,
  rotatedHandlePoints,
  rotateVector,
  rotation,
  rotationDeltaDegrees,
  snapAngle,
  translation,
  unionBounds,
  worldBoundsOfNode,
  worldMatrix,
  worldPointToLocal,
  worldQuad,
  worldRotation,
} from './index';

/** 构造测试文档：页面 + 给定顶层节点。 */
function docWith(nodes: ReturnType<typeof createRect>[]): {
  doc: DesignDocument;
  pageId: string;
} {
  const page = createPage({ id: 'p1' });
  let doc = createDocument({ id: 'd1', pages: [page] });
  for (const node of nodes) doc = insertNode(doc, 'p1', node, null);
  return { doc, pageId: 'p1' };
}

describe('geometry · 矩阵', () => {
  it('平移与旋转合成：先旋转后平移，点变换符合列主序定义', () => {
    const m = multiply(translation(10, 0), rotation(90));
    // 顺时针 90°（y 轴向下）：(1,0) → (0,1)
    expect(applyToPoint(m, { x: 0, y: 0 })).toEqual({ x: 10, y: 0 });
    const p = applyToPoint(m, { x: 1, y: 0 });
    expect(p.x).toBeCloseTo(10);
    expect(p.y).toBeCloseTo(1);
  });

  it('逆矩阵还原原点', () => {
    const m = multiply(translation(3, 7), rotation(37));
    const back = applyToPoint(invert(m), applyToPoint(m, { x: 12, y: -4 }));
    expect(back.x).toBeCloseTo(12);
    expect(back.y).toBeCloseTo(-4);
  });

  it('旋转向量：顺时针 90° 把右向量转成下向量', () => {
    const v = rotateVector({ x: 1, y: 0 }, 90);
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo(1);
  });
});

describe('geometry · 包围盒', () => {
  it('并集与包含判定', () => {
    const union = unionBounds([
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 20, y: 5, width: 10, height: 10 },
    ]);
    expect(union).toEqual({ x: 0, y: 0, width: 30, height: 15 });
    expect(unionBounds([])).toBeNull();
    expect(
      rectContainsRect({ x: 0, y: 0, width: 10, height: 10 }, { x: 2, y: 2, width: 3, height: 3 }),
    ).toBe(true);
    expect(
      rectContainsRect({ x: 0, y: 0, width: 10, height: 10 }, { x: 2, y: 2, width: 30, height: 3 }),
    ).toBe(false);
  });

  it('旋转后的四边形与矩形相交判定（框选旋转节点的基础）', () => {
    // 一个 10×10 的方形绕中心转 45°，其外接圆半径 ≈7.07
    const quad = [
      { x: 5, y: -2.0711 },
      { x: 12.0711, y: 5 },
      { x: 5, y: 12.0711 },
      { x: -2.0711, y: 5 },
    ];
    expect(quadIntersectsRect(quad, { x: 4, y: 4, width: 2, height: 2 })).toBe(true);
    expect(quadIntersectsRect(quad, { x: 100, y: 100, width: 2, height: 2 })).toBe(false);
    expect(boundsOfPoints(quad).width).toBeCloseTo(14.1421, 3);
  });
});

describe('geometry · 8 手柄与缩放解算（C8 对标：8 手柄）', () => {
  const bounds = { x: 0, y: 0, width: 100, height: 50 };

  it('8 个手柄位置齐备且语义正确', () => {
    expect(HANDLE_IDS).toHaveLength(8);
    const points = rotatedHandlePoints(bounds, 0);
    expect(points.nw).toEqual({ x: 0, y: 0 });
    expect(points.n).toEqual({ x: 50, y: 0 });
    expect(points.ne).toEqual({ x: 100, y: 0 });
    expect(points.e).toEqual({ x: 100, y: 25 });
    expect(points.se).toEqual({ x: 100, y: 50 });
    expect(points.s).toEqual({ x: 50, y: 50 });
    expect(points.sw).toEqual({ x: 0, y: 50 });
    expect(points.w).toEqual({ x: 0, y: 25 });
  });

  it('旋转后手柄位置随中心旋转（90° 时 nw 落到右上）', () => {
    // bounds(0,0,100,50) 绕中心 (50,25) 顺时针 90°：左上角 (0,0) → (75,-25)
    const points = rotatedHandlePoints(bounds, 90);
    expect(points.nw.x).toBeCloseTo(75);
    expect(points.nw.y).toBeCloseTo(-25);
    expect(points.se.x).toBeCloseTo(25);
    expect(points.se.y).toBeCloseTo(75);
  });

  it('手柄命中半径内可判定', () => {
    expect(hitTestHandle(bounds, 0, { x: 101, y: 25 }, 4)).toBe('e');
    expect(hitTestHandle(bounds, 0, { x: 160, y: 25 }, 4)).toBeNull();
  });

  it('拖角手柄时对角固定（未按比例）', () => {
    const next = resizeRect(bounds, 'se', { x: 150, y: 80 });
    expect(next).toEqual({ x: 0, y: 0, width: 150, height: 80 });
  });

  it('拖边手柄只改一个方向', () => {
    const next = resizeRect(bounds, 'e', { x: 150, y: 999 });
    expect(next).toEqual({ x: 0, y: 0, width: 150, height: 50 });
  });

  it('Shift 按比例缩放（角手柄）', () => {
    const next = resizeRect(bounds, 'se', { x: 200, y: 60 }, { proportional: true });
    // 宽高比 2:1 → 宽度变化更大，取宽为准
    expect(next.width).toBeCloseTo(200);
    expect(next.height).toBeCloseTo(100);
    expect(next.x).toBe(0);
    expect(next.y).toBe(0);
  });

  it('Alt 以中心为锚点对称缩放', () => {
    const next = resizeRect(bounds, 'e', { x: 120, y: 25 }, { fromCenter: true });
    expect(next.x).toBeCloseTo(-20);
    expect(next.width).toBeCloseTo(140);
    expect(next.y).toBeCloseTo(0);
    expect(next.height).toBeCloseTo(50);
  });

  it('旋转 90° 节点的缩放：对侧锚点在世界空间不动', () => {
    const start = { bounds, rotation: 90 };
    const anchorBefore = handleWorld(start, 'w');
    // 旋转 90° 后节点自身的 x 轴指向世界 +y，因此沿世界 +y 拖动才是「拉宽」
    const before = handleWorld(start, 'e');
    const next = resizeRotatedNode(start, 'e', { x: before.x, y: before.y + 40 }, {});
    expect(next.width).toBeCloseTo(140);
    expect(next.height).toBeCloseTo(50);
    // 对侧（w）手柄世界坐标不动
    const anchorAfter = handleWorld({ bounds: next, rotation: 90 }, 'w');
    expect(anchorAfter.x).toBeCloseTo(anchorBefore.x);
    expect(anchorAfter.y).toBeCloseTo(anchorBefore.y);
  });

  it('旋转角解算与 15° 吸附', () => {
    const delta = rotationDeltaDegrees({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 });
    expect(delta).toBeCloseTo(90);
    expect(snapAngle(16)).toBe(15);
    expect(snapAngle(23)).toBe(30);
    expect(normalizeAngle(370)).toBeCloseTo(10);
    expect(normalizeAngle(-190)).toBeCloseTo(170);
  });
});

/** 手柄的世界坐标（测试辅助：绕中心旋转后的手柄点）。 */
function handleWorld(
  start: { bounds: { x: number; y: number; width: number; height: number }; rotation: number },
  handle: HandleId,
): { x: number; y: number } {
  const points = rotatedHandlePoints(start.bounds, start.rotation);
  return points[handle];
}

describe('geometry · 变换合成', () => {
  it('嵌套旋转画板内节点的世界矩阵（含父级平移与旋转）', () => {
    let doc = createDocument({ id: 'd1', pages: [createPage({ id: 'p1' })] });
    const frame = createFrame({ id: 'f1', x: 100, y: 50, width: 200, height: 100, rotation: 90 });
    const child = createRect({ id: 'c1', x: 10, y: 20, width: 30, height: 40 });
    doc = insertNode(doc, 'p1', frame, null);
    doc = insertNode(doc, 'p1', child, 'f1');
    const page = getPage(doc, 'p1');

    expect(worldRotation(page, 'c1')).toBe(90);
    // 画板绕其中心 (200, 100) 旋转 90°：(100,50) 是左上角 → 旋转后落在 (250, 0)
    const quad = worldQuad(page, 'f1');
    expect(quad?.[0]?.x).toBeCloseTo(250);
    expect(quad?.[0]?.y).toBeCloseTo(0);

    const matrix = worldMatrix(page, 'c1');
    // 子节点局部原点 (10,20) → 世界（等价于先过画板世界矩阵）
    const world = applyToPoint(matrix, { x: 0, y: 0 });
    const frameMatrix = worldMatrix(page, 'f1');
    const expectedPoint = applyToPoint(frameMatrix, { x: 10, y: 20 });
    expect(world.x).toBeCloseTo(expectedPoint.x);
    expect(world.y).toBeCloseTo(expectedPoint.y);
  });

  it('世界 ↔ 局部双向换算互为逆', () => {
    const { doc } = docWith([
      createRect({ id: 'r1', x: 30, y: 40, width: 20, height: 20, rotation: 30 }),
    ]);
    const page = getPage(doc, 'p1');
    const world = localPointToWorld(page, 'r1', { x: 5, y: 5 });
    expect(world).not.toBeNull();
    const back = worldPointToLocal(page, 'r1', world as { x: number; y: number });
    expect(back?.x).toBeCloseTo(5);
    expect(back?.y).toBeCloseTo(5);
  });

  it('椭圆按椭圆判定命中，边框外角内不算', () => {
    const ellipse = createEllipse({ id: 'e1', width: 100, height: 100 });
    expect(nodeContainsLocalPoint(ellipse, { x: 50, y: 50 })).toBe(true);
    expect(nodeContainsLocalPoint(ellipse, { x: 2, y: 2 })).toBe(false);
  });

  it('旋转节点的世界 AABB 大于原尺寸', () => {
    const { doc } = docWith([
      createRect({ id: 'r1', x: 0, y: 0, width: 100, height: 100, rotation: 45 }),
    ]);
    const page = getPage(doc, 'p1');
    const bounds = worldBoundsOfNode(page, 'r1');
    expect(bounds?.width).toBeCloseTo(141.421, 3);
  });
});

describe('geometry · 命中测试', () => {
  function scene(): { doc: DesignDocument; pageId: string } {
    // 页面：f1(画板 0,0,200,200) 内含 r1(10,10,50,50)、r2(100,100,50,50)；
    // g1 编组(300,0,50,50) 内含 r3（父相对 10,10 → 世界 310,10，旋转 45°）
    let doc = createDocument({ id: 'd1', pages: [createPage({ id: 'p1' })] });
    doc = insertNode(
      doc,
      'p1',
      createFrame({ id: 'f1', x: 0, y: 0, width: 200, height: 200 }),
      null,
    );
    doc = insertNodes(
      doc,
      'p1',
      [
        createRect({ id: 'r1', x: 10, y: 10, width: 50, height: 50 }),
        createRect({ id: 'r2', x: 100, y: 100, width: 50, height: 50 }),
      ],
      'f1',
    );
    doc = insertNode(
      doc,
      'p1',
      createGroup({ id: 'g1', x: 300, y: 0, width: 50, height: 50 }),
      null,
    );
    doc = insertNode(
      doc,
      'p1',
      createRect({ id: 'r3', x: 10, y: 10, width: 30, height: 30, rotation: 45 }),
      'g1',
    );
    return { doc, pageId: 'p1' };
  }

  it('点命中最上层节点，顺序从前往后', () => {
    const { doc } = scene();
    const page = getPage(doc, 'p1');
    const all = hitTestAll(page, { x: 20, y: 20 });
    expect(all[0]?.id).toBe('r1');
    expect(all.map((hit) => hit.id)).toContain('f1');
    expect(hitTestPoint(page, { x: 500, y: 500 })).toBeNull();
  });

  it('单击穿过编组选中整组；双击进入子节点', () => {
    const { doc } = scene();
    const page = getPage(doc, 'p1');
    expect(clickSelectionTarget(page, { x: 320, y: 20 })).toBe('g1');
    expect(clickSelectionTarget(page, { x: 320, y: 20 }, { deep: true })).toBe('r3');
  });

  it('画板裁剪：裁剪区外的子节点不可命中', () => {
    let doc = createDocument({ id: 'd1', pages: [createPage({ id: 'p1' })] });
    doc = insertNode(
      doc,
      'p1',
      createFrame({ id: 'f1', x: 0, y: 0, width: 100, height: 100 }),
      null,
    );
    doc = insertNode(
      doc,
      'p1',
      createRect({ id: 'overflow', x: 150, y: 10, width: 50, height: 50 }),
      'f1',
    );
    const page = getPage(doc, 'p1');
    expect(hitTestPoint(page, { x: 160, y: 20 })).toBeNull();
  });

  it('隐藏节点默认不命中，可显式纳入', () => {
    const { doc } = docWith([createRect({ id: 'r1', visible: false, width: 50, height: 50 })]);
    const page = getPage(doc, 'p1');
    expect(hitTestPoint(page, { x: 10, y: 10 })).toBeNull();
    expect(hitTestPoint(page, { x: 10, y: 10 }, { includeHidden: true })?.id).toBe('r1');
  });

  it('框选：完全包含选中容器本身；部分相交时深入子节点', () => {
    const { doc } = scene();
    const page = getPage(doc, 'p1');
    // 完整覆盖画板 → 选中画板
    expect(marqueeSelect(page, { x: -10, y: -10, width: 300, height: 300 })).toContain('f1');
    // 画板内局部框选 → 选中子节点而不是画板
    const inner = marqueeSelect(page, { x: 5, y: 5, width: 60, height: 60 });
    expect(inner).toContain('r1');
    expect(inner).not.toContain('f1');
  });

  it('框选命中旋转节点（OBB 与框相交）', () => {
    const { doc } = scene();
    const page = getPage(doc, 'p1');
    // r3 绕中心转 45°，其外接盒约 (300,0)-(334,34)？——用其世界 AABB 精确断言
    const bounds = worldBoundsOfNode(page, 'r3');
    expect(bounds).not.toBeNull();
    const b = bounds as { x: number; y: number; width: number; height: number };
    const hit = marqueeSelect(page, {
      x: b.x + 1,
      y: b.y + 1,
      width: b.width - 2,
      height: b.height - 2,
    });
    expect(hit).toContain('r3');
    // 只在旋转后空出来的角上框选 → 不命中
    const miss = marqueeSelect(page, { x: b.x, y: b.y, width: 2, height: 2 });
    expect(miss).not.toContain('r3');
  });

  it('框选 contain 模式：只选被完全包住的节点', () => {
    const { doc } = scene();
    const page = getPage(doc, 'p1');
    // 框完全包住 r1（10,10,50,50）但未包住画板 → 选到 r1 而不是画板
    const contained = marqueeSelect(
      page,
      { x: 5, y: 5, width: 60, height: 60 },
      { mode: 'contain' },
    );
    expect(contained).toContain('r1');
    expect(contained).not.toContain('f1');
    const tooSmall = marqueeSelect(
      page,
      { x: 15, y: 15, width: 5, height: 5 },
      { mode: 'contain' },
    );
    expect(tooSmall).not.toContain('r1');
  });
});

describe('geometry · 纯函数不变式', () => {
  it('几何函数不修改输入', () => {
    const bounds = { x: 0, y: 0, width: 10, height: 10 };
    const snapshot = { ...bounds };
    resizeRect(bounds, 'se', { x: 100, y: 100 });
    rotatedHandlePoints(bounds, 30);
    expect(bounds).toEqual(snapshot);
  });

  it('worldQuad 对不存在节点返回 null（不抛错）', () => {
    const { doc } = docWith([]);
    const page = getPage(doc, 'p1');
    expect(worldQuad(page, 'missing')).toBeNull();
    expect(worldBoundsOfNode(page, 'missing')).toBeNull();
  });

  it('节点 id 集合为空时不变式仍成立', () => {
    const { doc } = docWith([]);
    const page = getPage(doc, 'p1');
    expect(hitTestPoint(page, { x: 0, y: 0 })).toBeNull();
    expect(marqueeSelect(page, { x: -1000, y: -1000, width: 2000, height: 2000 })).toEqual([]);
    const nodes: NodeId[] = [];
    expect(unionBounds(nodes.map(() => ({ x: 0, y: 0, width: 0, height: 0 })))).toBeNull();
  });
});
