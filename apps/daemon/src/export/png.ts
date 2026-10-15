/**
 * @dforge/daemon · PNG 渲染（简化实现：纯 TS 光栅化 + 零依赖 PNG 编码）。
 *
 * 边界声明：这是**过渡实现**（引擎/CanvasKit 光栅化接入后替换）——
 * 只画矩形（含圆角）、椭圆与纯色背景；文本与位图跳过（在响应里不报错）。
 * 编码用 Node `zlib` + 手写 CRC（真 PNG，可被任何查看器打开，非近似图）。
 */

import { deflateSync } from 'node:zlib';

import type { RenderNode, RenderScene } from './scene.ts';
import { flattenScene } from './scene.ts';

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** 颜色归一化 → RGBA 0–255。 */
function parseColor(color: string): Rgba {
  const hex = color.startsWith('#') ? color.slice(1) : color;
  const expand =
    hex.length === 3
      ? hex
          .split('')
          .map((char) => `${char}${char}`)
          .join('')
      : hex;
  const r = Number.parseInt(expand.slice(0, 2), 16);
  const g = Number.parseInt(expand.slice(2, 4), 16);
  const b = Number.parseInt(expand.slice(4, 6), 16);
  const a = expand.length >= 8 ? Number.parseInt(expand.slice(6, 8), 16) : 255;
  return { r, g, b, a };
}

/** 源 alpha 混合到目标像素（简单 over 合成）。 */
function blend(buffer: Uint8Array, index: number, color: Rgba, alpha: number): void {
  const srcA = (color.a / 255) * alpha;
  if (srcA <= 0) return;
  const dstA = buffer[index + 3] ?? 0;
  const outA = srcA + (dstA / 255) * (1 - srcA);
  if (outA <= 0) return;
  const mix = (src: number, dst: number): number => (src * srcA + dst * (1 - srcA)) / outA;
  buffer[index] = Math.round(mix(color.r, buffer[index] ?? 0));
  buffer[index + 1] = Math.round(mix(color.g, buffer[index + 1] ?? 0));
  buffer[index + 2] = Math.round(mix(color.b, buffer[index + 2] ?? 0));
  buffer[index + 3] = Math.round(outA * 255);
}

function fillRect(
  buffer: Uint8Array,
  width: number,
  height: number,
  rect: { x: number; y: number; width: number; height: number },
  color: Rgba,
  alpha: number,
  cornerRadius: number,
): void {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(width, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(height, Math.ceil(rect.y + rect.height));
  const radius = Math.max(0, Math.min(cornerRadius, rect.width / 2, rect.height / 2));
  for (let y = y0; y < y1; y += 1) {
    const py = y + 0.5;
    for (let x = x0; x < x1; x += 1) {
      const px = x + 0.5;
      if (radius > 0) {
        // 圆角判定：位于四角方框之外的像素按距离圆心判定
        const cx =
          px < rect.x + radius
            ? rect.x + radius
            : px > rect.x + rect.width - radius
              ? rect.x + rect.width - radius
              : px;
        const cy =
          py < rect.y + radius
            ? rect.y + radius
            : py > rect.y + rect.height - radius
              ? rect.y + rect.height - radius
              : py;
        const dx = px - cx;
        const dy = py - cy;
        if (dx * dx + dy * dy > radius * radius) continue;
      }
      blend(buffer, (y * width + x) * 4, color, alpha);
    }
  }
}

function fillEllipse(
  buffer: Uint8Array,
  imageWidth: number,
  imageHeight: number,
  rect: { x: number; y: number; width: number; height: number },
  color: Rgba,
  alpha: number,
): void {
  const rx = rect.width / 2;
  const ry = rect.height / 2;
  if (rx <= 0 || ry <= 0) return;
  const cx = rect.x + rx;
  const cy = rect.y + ry;
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(imageWidth, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(imageHeight, Math.ceil(rect.y + rect.height));
  for (let y = y0; y < y1; y += 1) {
    const ny = (y + 0.5 - cy) / ry;
    for (let x = x0; x < x1; x += 1) {
      const nx = (x + 0.5 - cx) / rx;
      if (nx * nx + ny * ny <= 1) {
        blend(buffer, (y * imageWidth + x) * 4, color, alpha);
      }
    }
  }
}

/** 场景 → RGBA 像素缓冲（scale 为像素倍率）。 */
export function rasterizeScene(
  scene: RenderScene,
  scale: number,
): { rgba: Uint8Array; width: number; height: number } {
  const width = Math.max(1, Math.round(scene.width * scale));
  const height = Math.max(1, Math.round(scene.height * scale));
  const rgba = new Uint8Array(width * height * 4);
  const background = parseColor(scene.background);
  fillRect(rgba, width, height, { x: 0, y: 0, width, height }, background, 1, 0);

  const paint = (node: RenderNode): void => {
    if (node.fill !== null && node.kind !== 'text' && node.kind !== 'image') {
      const color = parseColor(node.fill);
      const rect = {
        x: node.x * scale,
        y: node.y * scale,
        width: node.width * scale,
        height: node.height * scale,
      };
      if (node.kind === 'ellipse') {
        fillEllipse(rgba, width, height, rect, color, node.opacity);
      } else {
        fillRect(rgba, width, height, rect, color, node.opacity, node.cornerRadius * scale);
      }
    }
  };
  // flattenScene 已展开子树（父先子后即绘制顺序），此处不再递归
  for (const node of flattenScene(scene)) paint(node);

  return { rgba, width, height };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

/** RGBA 缓冲 → PNG 字节（8-bit RGBA、filter 0、deflate）。 */
export function encodePng(rgba: Uint8Array, width: number, height: number): Buffer {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 渲染场景为 PNG 字节。 */
export function renderPng(scene: RenderScene, scale: number): Buffer {
  const { rgba, width, height } = rasterizeScene(scene, scale);
  return encodePng(rgba, width, height);
}
