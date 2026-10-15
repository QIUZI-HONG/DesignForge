/**
 * @dforge/daemon · SVG 渲染（简化实现：向量输出，矩形/椭圆/文本）。
 *
 * 说明：文本用 `<text>` + 系统字体（不嵌字体、不做文本度量——B 级视觉等价范畴）；
 * 引擎序列化接入后本文件被替换，导出契约不变。
 */

import type { RenderNode, RenderScene } from './scene.ts';
import { flattenScene } from './scene.ts';

function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function fillAttrs(node: RenderNode): string {
  const opacity = node.opacity < 1 ? ` opacity="${Number(node.opacity.toFixed(4))}"` : '';
  const fill = node.fill === null ? 'none' : node.fill;
  return ` fill="${fill}"${opacity}`;
}

function nodeToSvg(node: RenderNode): string {
  const x = Number(node.x.toFixed(3));
  const y = Number(node.y.toFixed(3));
  const width = Number(node.width.toFixed(3));
  const height = Number(node.height.toFixed(3));
  switch (node.kind) {
    case 'ellipse':
      return `<ellipse cx="${Number((node.x + node.width / 2).toFixed(3))}" cy="${Number((node.y + node.height / 2).toFixed(3))}" rx="${Number((node.width / 2).toFixed(3))}" ry="${Number((node.height / 2).toFixed(3))}"${fillAttrs(node)}/>`;
    case 'text': {
      const content = node.text === null ? '' : escapeXml(node.text);
      if (content.length === 0) return '';
      const baseline = Number((node.y + node.fontSize).toFixed(3));
      return `<text x="${x}" y="${baseline}" font-size="${Number(node.fontSize.toFixed(3))}" font-family="sans-serif" fill="${node.fill ?? '#000000'}">${content}</text>`;
    }
    case 'image':
      // 简化实现：图片节点占位（位图嵌入归后续引擎序列化）
      return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="none" stroke="#B3B3B3"/>`;
    default: {
      const radius =
        node.cornerRadius > 0
          ? ` rx="${Number(node.cornerRadius.toFixed(3))}" ry="${Number(node.cornerRadius.toFixed(3))}"`
          : '';
      return `<rect x="${x}" y="${y}" width="${width}" height="${height}"${radius}${fillAttrs(node)}/>`;
    }
  }
}

/** 渲染场景为 SVG 文本（UTF-8）。 */
export function renderSvg(scene: RenderScene): string {
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}">`,
  );
  parts.push(
    `<rect x="0" y="0" width="${scene.width}" height="${scene.height}" fill="${scene.background}"/>`,
  );
  for (const node of flattenScene(scene)) {
    const svg = nodeToSvg(node);
    if (svg.length > 0) parts.push(svg);
  }
  parts.push('</svg>');
  return `${parts.join('\n')}\n`;
}
