/**
 * F6 代码生成器（C15 检查态与 F6 同源）。
 *
 * 两档起步（简报口径）：**CSS** 与 **React**——同一份属性投影（`propertiesOf`）
 * 生成两种输出，因此「检查态看到的属性 = 导出的代码」不会漂移（同源）。
 *
 * 确定性约束（快照稳定）：
 * - 属性顺序固定（见 `propertiesOf` 的构造顺序），无时间戳、无随机、无环境相关值；
 * - 取首个可见填充/描边（P0 子集：多填充按文档顺序取第一个可见者）；
 * - 数值格式化去尾零（`0.50` → `0.5`）；颜色原样输出（文档真值的大小写即输出）。
 *
 * 令牌：颜色与尺寸（圆角/字号/字距）尝试反查文档令牌 → `var(--dfg-design-…)`；
 * 未命中输出原始值并在 `notes` 里标记「未绑定令牌」（F6 的说明区直接渲染 notes）。
 */

import {
  isPaintVisible,
  type NodeId,
  resolveNode,
  type SceneNode,
  type ScenePage,
  type TokenSet,
} from '@dforge/engine';

import { bindTokenValue, type TokenBinding } from './tokens-bridge';

/** 代码档位（F6 起步两档）。 */
export type CodeTier = 'css' | 'react';

/** 生成结果。 */
export interface GeneratedCode {
  tier: CodeTier;
  /** 输出语言（CSS 档 = css；React 档 = tsx）。 */
  language: 'css' | 'tsx';
  /** 代码文本（快照稳定）。 */
  code: string;
  /** 令牌绑定说明（F6「Token → CSS 变量」区）。 */
  notes: CodeNote[];
  /** 未绑定令牌的说明条数（回退提示）。 */
  unbound: number;
}

/** 单条令牌说明。 */
export interface CodeNote {
  /** 稳定 id（属性名；用于 UI 列表 key 与测试断言）。 */
  id: string;
  /** 代码里的属性名（CSS 名）。 */
  property: string;
  binding: TokenBinding;
}

/** 生成选项。 */
export interface CodegenOptions {
  /** 文档令牌集（反查用；省略 = 一切走原始值）。 */
  tokens?: TokenSet;
  /** 类名前缀（CSS 档；默认 `df-node`）。 */
  classPrefix?: string;
}

/** 属性投影（两档共享）。 */
interface CodeProperty {
  /** CSS 属性名（notes 的 id）。 */
  cssName: string;
  /** React style 键名。 */
  reactKey: string;
  /** CSS 文本值。 */
  cssValue: string;
  /** React 值表达式（已含引号/数字字面量形态）。 */
  reactValue: string;
  /** 注释文本（命中的令牌路径或 `未绑定令牌`；无注释为 null）。 */
  note: string | null;
  /** 令牌绑定（无绑定尝试为 null）。 */
  binding: TokenBinding | null;
}

/** 生成代码（按档位分派）。 */
export function generateCode(
  page: ScenePage,
  nodeId: NodeId,
  tier: CodeTier,
  options: CodegenOptions = {},
): GeneratedCode {
  return tier === 'css' ? generateCss(page, nodeId, options) : generateReact(page, nodeId, options);
}

/** 生成 CSS 档。 */
export function generateCss(
  page: ScenePage,
  nodeId: NodeId,
  options: CodegenOptions = {},
): GeneratedCode {
  const node = resolveNode(page, nodeId);
  if (node === undefined) return emptyResult('css', 'css');
  const properties = propertiesOf(node, options);
  const classPrefix = options.classPrefix ?? 'df-node';
  const lines = [`/* ${node.name} (${node.id}) */`, `.${classPrefix}-${nodeId} {`];
  for (const property of properties) {
    const comment = property.note === null ? '' : ` /* ${property.note} */`;
    lines.push(`  ${property.cssName}: ${property.cssValue};${comment}`);
  }
  lines.push('}');
  return {
    tier: 'css',
    language: 'css',
    code: `${lines.join('\n')}\n`,
    notes: notesOf(properties),
    unbound: properties.filter((property) => property.binding?.tokenPath === null).length,
  };
}

/** 生成 React 档（函数组件 + style 对象；文本节点渲染 `<span>` 带内容）。 */
export function generateReact(
  page: ScenePage,
  nodeId: NodeId,
  options: CodegenOptions = {},
): GeneratedCode {
  const node = resolveNode(page, nodeId);
  if (node === undefined) return emptyResult('react', 'tsx');
  const properties = propertiesOf(node, options);
  const isText = node.type === 'text';
  const tag = isText ? 'span' : 'div';
  const lines = ['export function DesignNode() {', '  return (', `    <${tag}`];
  lines.push('      style={{');
  for (const property of properties) {
    const comment = property.note === null ? '' : ` // ${property.note}`;
    lines.push(`        ${property.reactKey}: ${property.reactValue},${comment}`);
  }
  lines.push('      }}');
  if (isText) {
    lines.push('    >');
    lines.push(`      ${node.text.characters}`);
    lines.push(`    </${tag}>`);
  } else {
    lines.push('    />');
  }
  lines.push('  );', '}');
  return {
    tier: 'react',
    language: 'tsx',
    code: `${lines.join('\n')}\n`,
    notes: notesOf(properties),
    unbound: properties.filter((property) => property.binding?.tokenPath === null).length,
  };
}

/** 空结果（节点不存在：面板按空态渲染，不抛错）。 */
function emptyResult(tier: CodeTier, language: GeneratedCode['language']): GeneratedCode {
  return { tier, language, code: '', notes: [], unbound: 0 };
}

/** 说明列表（顺序 = 属性顺序；只收录有绑定尝试的属性）。 */
function notesOf(properties: readonly CodeProperty[]): CodeNote[] {
  return properties
    .filter(
      (property): property is CodeProperty & { binding: TokenBinding } => property.binding !== null,
    )
    .map((property) => ({
      id: property.cssName,
      property: property.cssName,
      binding: property.binding,
    }));
}

/** 数值格式化：整数原样、浮点去尾零（0.50 → 0.5）。 */
export function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(3)));
}

/**
 * 属性投影：节点 → 代码属性序列（**两档共享**，属性顺序即输出顺序）。
 * 顺序：定位 → 尺寸 → 变换 → 不透明度 → 填充/描边 → 圆角 → 文本排版。
 */
function propertiesOf(node: SceneNode, options: CodegenOptions): CodeProperty[] {
  // 缺省 = 空令牌集（而非「不做反查」）：这样「未绑定令牌」的说明对每个属性都成立，
  // 面板不会因为宿主忘了传令牌而静默丢掉回退提示。
  const tokens: TokenSet = options.tokens ?? {};
  const out: CodeProperty[] = [];
  const isText = node.type === 'text';

  out.push(plain('position', 'position', 'absolute', "'absolute'"));
  out.push(numberProperty('left', 'left', node.x));
  out.push(numberProperty('top', 'top', node.y));
  out.push(numberProperty('width', 'width', node.width));
  out.push(numberProperty('height', 'height', node.height));
  if (node.rotation !== 0) {
    const value = `rotate(${formatNumber(node.rotation)}deg)`;
    out.push(plain('transform', 'transform', value, `'${value}'`));
  }
  if (node.opacity !== 1) {
    out.push({
      cssName: 'opacity',
      reactKey: 'opacity',
      cssValue: formatNumber(node.opacity),
      reactValue: formatNumber(node.opacity),
      note: null,
      binding: null,
    });
  }

  const fill = node.fills.find((paint) => isPaintVisible(paint));
  if (fill !== undefined) {
    const color = colorOf(fill);
    out.push(
      isText
        ? colorProperty(tokens, 'color', 'color', color)
        : colorProperty(tokens, 'background', 'background', color),
    );
  }

  const stroke = node.strokes[0];
  if (stroke !== undefined && isPaintVisible(stroke.paint)) {
    const color = colorOf(stroke.paint);
    const binding = bindTokenValue(tokens, color);
    const expression = binding.tokenPath === null ? color : binding.expression;
    out.push({
      cssName: 'border',
      reactKey: 'border',
      cssValue: `${formatNumber(stroke.width)}px solid ${expression}`,
      reactValue: `'${formatNumber(stroke.width)}px solid ${expression}'`,
      note: binding.tokenPath ?? '未绑定令牌',
      binding,
    });
  }

  if (node.cornerRadius > 0) {
    out.push(
      dimensionProperty(
        tokens,
        'border-radius',
        'borderRadius',
        `${formatNumber(node.cornerRadius)}px`,
        node.cornerRadius,
      ),
    );
  }

  if (isText) {
    const text = node.text;
    out.push(plain('text-align', 'textAlign', text.align, `'${text.align}'`));
    out.push(plain('font-family', 'fontFamily', `"${text.fontFamily}"`, `'${text.fontFamily}'`));
    out.push(
      dimensionProperty(
        tokens,
        'font-size',
        'fontSize',
        `${formatNumber(text.fontSize)}px`,
        text.fontSize,
      ),
    );
    out.push({
      cssName: 'font-weight',
      reactKey: 'fontWeight',
      cssValue: formatNumber(text.fontWeight),
      reactValue: formatNumber(text.fontWeight),
      note: null,
      binding: null,
    });
    out.push({
      cssName: 'line-height',
      reactKey: 'lineHeight',
      cssValue: formatNumber(text.lineHeight),
      reactValue: formatNumber(text.lineHeight),
      note: null,
      binding: null,
    });
    if (text.letterSpacing !== 0) {
      out.push(
        dimensionProperty(
          tokens,
          'letter-spacing',
          'letterSpacing',
          `${formatNumber(text.letterSpacing)}px`,
          text.letterSpacing,
        ),
      );
    }
  }

  return out;
}

/** 无令牌耦合的普通属性。 */
function plain(
  cssName: string,
  reactKey: string,
  cssValue: string,
  reactValue: string,
): CodeProperty {
  return { cssName, reactKey, cssValue, reactValue, note: null, binding: null };
}

/** 数值属性（几何：不尝试令牌反查——几何是布局真值，不是设计资产绑定面）。 */
function numberProperty(cssName: string, reactKey: string, value: number): CodeProperty {
  return {
    cssName,
    reactKey,
    cssValue: `${formatNumber(value)}px`,
    reactValue: formatNumber(value),
    note: null,
    binding: null,
  };
}

/** 颜色属性（尝试令牌反查；React 侧字符串表达式）。 */
function colorProperty(
  tokens: TokenSet,
  cssName: string,
  reactKey: string,
  color: string,
): CodeProperty {
  const binding = bindTokenValue(tokens, color);
  const expression = binding.tokenPath === null ? color : binding.expression;
  return {
    cssName,
    reactKey,
    cssValue: expression,
    reactValue: `'${expression}'`,
    note: binding === null ? null : (binding.tokenPath ?? '未绑定令牌'),
    binding,
  };
}

/** 尺寸属性（带单位字面值；命中令牌时两档都输出 var() 字符串）。 */
function dimensionProperty(
  tokens: TokenSet,
  cssName: string,
  reactKey: string,
  raw: string,
  numericValue: number,
): CodeProperty {
  const binding = bindTokenValue(tokens, raw);
  const bound = binding.tokenPath !== null;
  return {
    cssName,
    reactKey,
    cssValue: bound ? binding.expression : raw,
    reactValue: bound ? `'${binding.expression}'` : formatNumber(numericValue),
    note: binding.tokenPath ?? '未绑定令牌',
    binding,
  };
}

/** 取画刷颜色（纯色/渐变首停靠点）。 */
function colorOf(paint: SceneNode['fills'][number]): string {
  if (paint.type === 'solid') return paint.color;
  return paint.stops[0]?.color ?? '#00000000'; // guard-tokens:allow 文档数据色（极密渐变停靠点缺失时的占位）
}
