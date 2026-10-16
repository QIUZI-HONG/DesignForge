/**
 * 门禁公共件：差异像素包围盒（验收标准 §4 证据字段 `diff.bbox`）。
 *
 * 为什么独立成模块：六处截图对照门禁（verify-figma-{home,editor,inspector,inspect,component}
 * 与 verify-canvas）都要把 pixelmatch 的差异图折算成「差异落点」——写六遍算法必漂移；
 * 这里给出**唯一实现**，并由 `scripts/tests/bbox-of-diff.test.mjs` 用夹具锁定行为
 * （有差异 → 精确包围盒；无差异 → null；容差阈值下的边界像素不入盒）。
 *
 * 口径：pixelmatch 把差异像素涂成不透明红（255,0,0,255）；抗锯齿产生的黄色
 * （255,255,0）不算差异（本门禁 `includeAA: false`，且算法只认纯红）。
 */

/**
 * 差异包围盒（相对图像左上角，像素单位）。
 *
 * @param {{ data: Uint8Array | Buffer, width: number, height: number }} diffPng
 * @returns {{ x: number, y: number, width: number, height: number } | null} 无差异像素时 null
 */
export function bboxOfDiff(diffPng) {
  const { data, width, height } = diffPng;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      // pixelmatch 把差异像素涂成红色（255,0,0）；AA 黄（255,255,0）不计
      if (data[index] === 255 && data[index + 1] === 0 && data[index + 2] === 0) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}
