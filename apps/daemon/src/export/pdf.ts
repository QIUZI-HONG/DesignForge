/**
 * @dforge/daemon · PDF 渲染（简化实现：单页、纯色矩形/椭圆，手写最小 PDF 语法）。
 *
 * 边界声明：过渡实现（引擎序列化接入后替换）——文本与位图跳过；
 * 坐标系换算：PDF 原点在左下（y 轴向上），故 y_pdf = height - y_top - nodeHeight。
 * 圆角在 PDF 里不表达（简化为直角，文档注明）。
 */

import type { RenderNode, RenderScene } from './scene.ts';
import { flattenScene, normalizeColor } from './scene.ts';

function rgbOf(color: string): { r: number; g: number; b: number } {
  const hex = color.startsWith('#') ? color.slice(1) : color;
  const expand =
    hex.length === 3
      ? hex
          .split('')
          .map((char) => `${char}${char}`)
          .join('')
      : hex;
  return {
    r: Number.parseInt(expand.slice(0, 2), 16) / 255,
    g: Number.parseInt(expand.slice(2, 4), 16) / 255,
    b: Number.parseInt(expand.slice(4, 6), 16) / 255,
  };
}

function fixed(value: number): string {
  return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function fillColorOp(color: string): string {
  const { r, g, b } = rgbOf(color);
  return `${fixed(r)} ${fixed(g)} ${fixed(b)} rg`;
}

/** 椭圆 → 四段三次贝塞尔（k = 0.5523，PDF 标准近似）。 */
function ellipseOps(node: RenderNode, pageHeight: number): string[] {
  const rx = node.width / 2;
  const ry = node.height / 2;
  const cx = node.x + rx;
  const cyTop = node.y + ry;
  const cy = pageHeight - cyTop;
  const kx = rx * 0.5523;
  const ky = ry * 0.5523;
  const ops: string[] = [];
  ops.push(`${fixed(cx + rx)} ${fixed(cy)} m`);
  ops.push(
    `${fixed(cx + rx)} ${fixed(cy + ky)} ${fixed(cx + kx)} ${fixed(cy + ry)} ${fixed(cx)} ${fixed(cy + ry)} c`,
  );
  ops.push(
    `${fixed(cx - kx)} ${fixed(cy + ry)} ${fixed(cx - rx)} ${fixed(cy + ky)} ${fixed(cx - rx)} ${fixed(cy)} c`,
  );
  ops.push(
    `${fixed(cx - rx)} ${fixed(cy - ky)} ${fixed(cx - kx)} ${fixed(cy - ry)} ${fixed(cx)} ${fixed(cy - ry)} c`,
  );
  ops.push(
    `${fixed(cx + kx)} ${fixed(cy - ry)} ${fixed(cx + rx)} ${fixed(cy - ky)} ${fixed(cx + rx)} ${fixed(cy)} c`,
  );
  ops.push('f');
  return ops;
}

/** 渲染场景为 PDF 字节（单页；确定性输出——不含生成时间等易变字段）。 */
export function renderPdf(scene: RenderScene): Buffer {
  const content: string[] = [];
  content.push(fillColorOp(scene.background));
  content.push(`0 0 ${fixed(scene.width)} ${fixed(scene.height)} re f`);
  for (const node of flattenScene(scene)) {
    if (node.fill === null || node.kind === 'text' || node.kind === 'image') continue;
    const color = normalizeColor(node.fill) ?? node.fill;
    content.push(fillColorOp(color));
    if (node.kind === 'ellipse') {
      content.push(...ellipseOps(node, scene.height));
    } else {
      const y = scene.height - node.y - node.height;
      content.push(`${fixed(node.x)} ${fixed(y)} ${fixed(node.width)} ${fixed(node.height)} re f`);
    }
  }
  const contentStream = `${content.join('\n')}\n`;

  const objects: string[] = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fixed(scene.width)} ${fixed(scene.height)}] /Resources << >> /Contents 4 0 R >>\nendobj\n`,
    `4 0 obj\n<< /Length ${Buffer.byteLength(contentStream, 'utf8')} >>\nstream\n${contentStream}endstream\nendobj\n`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += object;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'utf8');
}
