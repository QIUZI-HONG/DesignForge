/**
 * 导出产物内容断言公共件（审计 08 · R-07-01 / R-05-01 的回归资产底座）。
 *
 * 为什么需要：e2e 的导出步骤旧口径只看「完成」文案与文件名，真实编辑器页信封
 * （`dforge.canvas.page`）导出为空白时仍会绿（F-07-01）。这里把「产物里到底画了什么」
 * 收敛成**纯函数 + 外部工具渲染**两层判定：
 *   - PNG：pngjs 解码后按「观察到的背景色」计算非背景像素，并在预期矩形中心取样；
 *   - SVG：解析 rect 标签，断言背景之外还有与设计尺寸/填充色一致的节点；
 *   - PDF：先做结构断言（MediaBox / Count / 内容流填充色），再用 pdfinfo / pdftoppm
 *     外部渲染取像素（工具缺失时降级为结构+颜色断言，调用方须在 detail 注明）。
 *
 * 判定纪律：任何 `ok` 都必须来自产物内容；空产物、只有背景的产物一律 false。
 * 失败信息带可复核数值（尺寸/计数/采样颜色），不返回裸布尔。
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import { PNG } from 'pngjs';

/** 解码 daemon 导出响应信封（`{ ok, result: { artifact } }`）。 */
export function decodeArtifactPayload(payload) {
  if (typeof payload !== 'object' || payload === null || payload.ok !== true) return null;
  const artifact = payload.result?.artifact;
  if (typeof artifact !== 'object' || artifact === null) return null;
  if (typeof artifact.base64 !== 'string' || typeof artifact.format !== 'string') return null;
  const bytes = Buffer.from(artifact.base64, 'base64');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return {
    format: artifact.format,
    mimeType: typeof artifact.mimeType === 'string' ? artifact.mimeType : '',
    fileName: typeof artifact.fileName === 'string' ? artifact.fileName : '',
    length: typeof artifact.length === 'number' ? artifact.length : bytes.length,
    sha256: typeof artifact.sha256 === 'string' ? artifact.sha256 : '',
    sha256Matches: typeof artifact.sha256 === 'string' ? artifact.sha256 === sha256 : null,
    lengthMatches: typeof artifact.length === 'number' ? artifact.length === bytes.length : null,
    bytes,
  };
}

/** 十六进制颜色 → [r, g, b]（支持 #RGB / #RRGGBB；非法返回 null）。 */
export function parseHexColor(value) {
  if (typeof value !== 'string') return null;
  const hex = value.startsWith('#') ? value.slice(1) : value;
  if (hex.length === 3) {
    return [
      Number.parseInt(`${hex[0]}${hex[0]}`, 16),
      Number.parseInt(`${hex[1]}${hex[1]}`, 16),
      Number.parseInt(`${hex[2]}${hex[2]}`, 16),
    ];
  }
  if (hex.length !== 6) return null;
  const parsed = [0, 2, 4].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  return parsed.some((channel) => Number.isNaN(channel)) ? null : parsed;
}

/** 颜色近似比较（只看 RGB；PNG 采样含 alpha）。 */
function colorClose(a, b, tolerance) {
  return (
    Math.abs(a[0] - b[0]) <= tolerance &&
    Math.abs(a[1] - b[1]) <= tolerance &&
    Math.abs(a[2] - b[2]) <= tolerance
  );
}

function pixelAt(data, width, x, y) {
  const at = (y * width + x) * 4;
  return [data[at], data[at + 1], data[at + 2], data[at + 3]];
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatPixel(pixel) {
  return `[${pixel.join(',')}]`;
}

/**
 * PNG 内容判定。
 *
 * @param {Buffer} bytes PNG 字节
 * @param {{ width?: number, height?: number, background?: string, shapes?: Array<{x:number,y:number,width:number,height:number,color:string}> }} expected
 */
export function inspectPng(bytes, expected = {}) {
  const png = PNG.sync.read(Buffer.from(bytes));
  const { width, height, data } = png;
  const problems = [];

  if (expected.width !== undefined && width !== expected.width) {
    problems.push(
      `PNG 尺寸 ${String(width)}×${String(height)} 与预期 ${String(expected.width)}×${String(expected.height)} 不符`,
    );
  }
  if (expected.height !== undefined && height !== expected.height) {
    problems.push(`PNG 高 ${String(height)} 与预期 ${String(expected.height)} 不符`);
  }

  const backgroundSample = pixelAt(data, width, 0, 0);
  const expectedBackground =
    typeof expected.background === 'string' ? parseHexColor(expected.background) : null;
  let backgroundMatches = null;
  if (expectedBackground !== null) {
    // 底色是实心填充，采样点在角落（无抗锯齿）：容差收紧到 3——白底与 #F5F5F5 的差（10）
    // 必须判为「背景未生效」，不能因容差过宽把缺陷放过。
    backgroundMatches = colorClose(backgroundSample, expectedBackground, 3);
    if (!backgroundMatches) {
      problems.push(
        `PNG 背景色 ${formatPixel(backgroundSample)} 与页面底色 ${expected.background} 不符（背景未生效）`,
      );
    }
  }

  // 非背景像素以「实际角落像素」为基准：白底空白图不得因与预期底色不同而被算成内容。
  let nonBackgroundPixels = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!colorClose(pixelAt(data, width, x, y), backgroundSample, 8)) nonBackgroundPixels += 1;
    }
  }

  const shapes = (expected.shapes ?? []).map((shape) => {
    const color = parseHexColor(shape.color);
    const left = clamp(Math.floor(shape.x), 0, width - 1);
    const top = clamp(Math.floor(shape.y), 0, height - 1);
    const right = clamp(Math.floor(shape.x + shape.width), 0, width);
    const bottom = clamp(Math.floor(shape.y + shape.height), 0, height);
    const centerX = clamp(Math.floor(shape.x + shape.width / 2), 0, width - 1);
    const centerY = clamp(Math.floor(shape.y + shape.height / 2), 0, height - 1);
    const sample = pixelAt(data, width, centerX, centerY);
    let matchedPixels = 0;
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        if (color !== null && colorClose(pixelAt(data, width, x, y), color, 20)) matchedPixels += 1;
      }
    }
    const area = Math.max(1, (right - left) * (bottom - top));
    const match =
      color !== null && colorClose(sample, color, 20) && matchedPixels >= Math.ceil(area * 0.5);
    if (!match) {
      problems.push(
        `PNG 预期矩形 (${String(shape.x)},${String(shape.y)} ${String(shape.width)}×${String(shape.height)}) 未绘制：中心像素 ${formatPixel(sample)}，填充色匹配 ${String(matchedPixels)}/${String(area)} 像素（预期 ${shape.color}）`,
      );
    }
    return {
      x: shape.x,
      y: shape.y,
      width: shape.width,
      height: shape.height,
      color: shape.color,
      sample,
      matchedPixels,
      area,
      match,
    };
  });

  if (shapes.length > 0 && nonBackgroundPixels === 0) {
    problems.push('PNG 全部像素与背景同色（空白产物）');
  }

  return {
    width,
    height,
    backgroundSample,
    backgroundMatches,
    nonBackgroundPixels,
    shapes,
    ok: problems.length === 0,
    problems,
  };
}

/** 解析一个标签内的属性（SVG 属性都是双引号形态的简化渲染器输出）。 */
function attributesOf(tagText) {
  const attributes = {};
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*"([^"]*)"/g;
  let match = pattern.exec(tagText);
  while (match !== null) {
    attributes[match[1]] = match[2];
    match = pattern.exec(tagText);
  }
  return attributes;
}

/** 取某类标签的全部属性表。 */
function tagsOf(text, tag) {
  const pattern = new RegExp(`<${tag}\\b[^>]*>`, 'gi');
  return (text.match(pattern) ?? []).map(attributesOf);
}

/**
 * SVG 内容判定（背景之外必须还有与设计一致的矩形节点）。
 *
 * @param {string} text SVG 文本
 * @param {{ width?: number, height?: number, background?: string, shapes?: Array<{width:number,height:number,color:string}> }} expected
 */
export function inspectSvg(text, expected = {}) {
  const problems = [];
  const svgTags = tagsOf(text, 'svg');
  const root = svgTags[0] ?? {};
  const width = root.width === undefined ? null : Number(root.width);
  const height = root.height === undefined ? null : Number(root.height);
  if (expected.width !== undefined && width !== expected.width) {
    problems.push(`SVG 宽度 ${String(width)} 与预期 ${String(expected.width)} 不符`);
  }
  if (expected.height !== undefined && height !== expected.height) {
    problems.push(`SVG 高度 ${String(height)} 与预期 ${String(expected.height)} 不符`);
  }

  const rects = tagsOf(text, 'rect');
  const backgrounds = rects.filter(
    (rect) =>
      Number(rect.width) === expected.width &&
      Number(rect.height) === expected.height &&
      typeof expected.background === 'string' &&
      (rect.fill ?? '').toUpperCase() === expected.background.toUpperCase(),
  );
  const backgroundMatches = expected.background === undefined ? null : backgrounds.length > 0;
  if (backgroundMatches === false) {
    problems.push(
      `SVG 缺少尺寸 ${String(expected.width)}×${String(expected.height)}、填充 ${expected.background} 的背景 rect（页面底色未生效）`,
    );
  }

  const shapes = (expected.shapes ?? []).map((shape) => {
    const hit = rects.find(
      (rect) =>
        Math.abs(Number(rect.width) - shape.width) <= 1 &&
        Math.abs(Number(rect.height) - shape.height) <= 1 &&
        (rect.fill ?? '').toUpperCase() === shape.color.toUpperCase(),
    );
    if (hit === undefined) {
      problems.push(
        `SVG 未找到尺寸 ${String(shape.width)}×${String(shape.height)}、填充 ${shape.color} 的节点矩形（设计节点未进入产物）`,
      );
    }
    return {
      width: shape.width,
      height: shape.height,
      color: shape.color,
      match: hit !== undefined,
    };
  });

  const drawableCount = ['rect', 'ellipse', 'path', 'text', 'image'].reduce(
    (total, tag) => total + tagsOf(text, tag).length,
    0,
  );
  if ((expected.shapes ?? []).length > 0 && drawableCount < (expected.shapes ?? []).length + 1) {
    problems.push(
      `SVG 可绘制元素仅 ${String(drawableCount)} 个（预期背景 + ${String((expected.shapes ?? []).length)} 个节点）`,
    );
  }

  return {
    width,
    height,
    rectCount: rects.length,
    drawableCount,
    backgroundMatches,
    shapes,
    ok: problems.length === 0,
    problems,
  };
}

/** PDF 结构判定（页数 / MediaBox / 内容流填充色）。 */
export function inspectPdf(bytes) {
  const text = Buffer.from(bytes).toString('latin1');
  const isPdf = text.startsWith('%PDF-');
  const pageCountMatch = /\/Type\s*\/Pages\b[^>]*?\/Count\s+(\d+)/.exec(text);
  const mediaBoxMatch = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(text);
  const fillColors = [];
  const rgPattern = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg\b/g;
  let match = rgPattern.exec(text);
  while (match !== null) {
    fillColors.push([Number(match[1]), Number(match[2]), Number(match[3])]);
    match = rgPattern.exec(text);
  }
  const fillRectCount = (text.match(/\bre\s+f\b/g) ?? []).length;
  return {
    isPdf,
    pageCount: pageCountMatch === null ? null : Number(pageCountMatch[1]),
    mediaBox:
      mediaBoxMatch === null
        ? null
        : { width: Number(mediaBoxMatch[1]), height: Number(mediaBoxMatch[2]) },
    fillColors,
    fillRectCount,
  };
}

/** PDF 内容流是否含某十六进制填充色（颜色分量容差默认 0.02）。 */
export function pdfHasFillColor(structure, hexColor, tolerance = 0.02) {
  const expected = parseHexColor(hexColor);
  if (expected === null) return false;
  const normalized = expected.map((channel) => channel / 255);
  return structure.fillColors.some(
    (color) =>
      Math.abs(color[0] - normalized[0]) <= tolerance &&
      Math.abs(color[1] - normalized[1]) <= tolerance &&
      Math.abs(color[2] - normalized[2]) <= tolerance,
  );
}

/** `pdfinfo` 外部校验（缺失 → blocked，不是失败）。 */
export function pdfInfo(pdfPath) {
  const result = spawnSync('pdfinfo', [pdfPath], { encoding: 'utf8' });
  if (result.error?.code === 'ENOENT') {
    return { blocked: true, reason: 'pdfinfo 不可用', pages: null, pageSize: null };
  }
  if (result.status !== 0) {
    return { blocked: false, pages: null, pageSize: null, stderr: (result.stderr ?? '').trim() };
  }
  const pages = /^Pages:\s+(\d+)$/m.exec(result.stdout);
  const size = /^Page size:\s+([\d.]+)\s+x\s+([\d.]+)\s+pts/m.exec(result.stdout);
  return {
    blocked: false,
    pages: pages === null ? null : Number(pages[1]),
    pageSize: size === null ? null : { width: Number(size[1]), height: Number(size[2]) },
    stdout: result.stdout,
  };
}

/** `pdftoppm` 外部渲染第 1 页为 PNG（缺失 → blocked，不是失败）。 */
export function renderPdfPage(pdfPath, outputPrefix) {
  const result = spawnSync(
    'pdftoppm',
    ['-png', '-r', '72', '-f', '1', '-l', '1', '-singlefile', pdfPath, outputPrefix],
    { encoding: 'utf8' },
  );
  if (result.error?.code === 'ENOENT') {
    return { blocked: true, reason: 'pdftoppm 不可用', pngPath: null };
  }
  if (result.status !== 0) {
    return { blocked: false, pngPath: null, stderr: (result.stderr ?? '').trim() };
  }
  return { blocked: false, pngPath: `${outputPrefix}.png`, stderr: (result.stderr ?? '').trim() };
}
