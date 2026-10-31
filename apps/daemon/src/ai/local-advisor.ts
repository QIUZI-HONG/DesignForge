/**
 * @dforge/daemon · 本地建议生成器（票 03 / spec P0-2）。
 *
 * **确定性纯函数**：输入用户提示词，输出结构化中文建议（分步操作 + 注意事项）——
 * 识别按钮 / 颜色 / 圆角 / 布局 / 文本等关键词族，未识别或空输入给通用兜底。
 *
 * 边界（spec P0-2 / P5）：
 * - 输出走既有 AI 契约（content + suggestions），**不产出 Design IR、不触碰命令栈**；
 * - 同输入同输出（表驱动测试断言），便于门禁与测试；
 * - P5 落地后本生成器降级为「上游不可用兜底」，接口不变。
 *
 * 文案口径：本模块是 daemon 侧数据生成（非界面字面量），中文文案与
 * `suggestionsFor`（client.ts）同一层——界面侧文案仍走 web i18n 目录（ADR-0003）。
 */

import type { AiSuggestion } from '@dforge/contracts';

/** 生成器输出（content 进 AI 契约正文位；suggestions 进契约建议位）。 */
export interface LocalAdvice {
  /** 建议正文（多行：识别对象 → 分步操作 → 注意事项；直接渲染）。 */
  content: string;
  /** 建议清单（逐关键词族一条 manual-edit 条目；兜底为空数组）。 */
  suggestions: AiSuggestion[];
}

/** 关键词族定义（顺序即输出排序——确定性来源之一）。 */
interface AdviceTopic {
  /** 族标签（用于正文回显与建议标题）。 */
  label: string;
  /** 关键词表（中文按原样、英文按小写匹配）。 */
  keywords: readonly string[];
  /** 该族的分步操作建议（每步一行）。 */
  steps: readonly string[];
  /** 该族的手动操作建议标题（suggestions 用）。 */
  suggestionTitle: string;
}

/** 关键词族表（文案与编辑器实际能力对齐：画布工具 / 属性面板 / 图层面板）。 */
const TOPICS: readonly AdviceTopic[] = [
  {
    label: '按钮',
    keywords: ['按钮', 'button', 'cta'],
    steps: [
      '用「矩形工具」在画布拖出按钮底形（先建画板则用「画板工具」）；',
      '选中底形，在属性面板「填充」设置按钮主色，需要时在「描边」补充；',
      '在属性面板「圆角」输入统一数值（四角统一生效）；',
      '用「文本工具」添加按钮标签，在「文字」区调整字号与对齐；',
      '在图层面板重命名并整理层级，便于后续维护。',
    ],
    suggestionTitle: '手动新增按钮：矩形工具打底形，填充与圆角在属性面板设置',
  },
  {
    label: '颜色',
    keywords: ['颜色', '配色', '色彩', '色值', '填充', '背景色', '主题色', 'color', 'colour'],
    steps: [
      '选中目标图层（可加选多个批量调整）；',
      '在属性面板「填充」逐项修改颜色；',
      '多处统一颜色时，先调好一处，再复制色值到其余图层；',
      '检查文字与背景的深浅对比，避免影响可读性。',
    ],
    suggestionTitle: '手动调整颜色：选中图层后在属性面板「填充」逐项修改',
  },
  {
    label: '圆角',
    keywords: ['圆角', 'radius', 'rounded'],
    steps: [
      '选中需要调整的图层（可加选多个）；',
      '在属性面板「圆角」区输入统一数值（当前四角统一，暂不支持单独设置某一角）；',
      '尺寸相近的元素使用同一圆角档位，保持视觉一致。',
    ],
    suggestionTitle: '手动统一圆角：属性面板「圆角」输入统一数值（四角统一）',
  },
  {
    label: '布局',
    keywords: ['布局', '间距', '对齐', '排列', '居中', '分布', '位置', 'layout', 'spacing', 'align'],
    steps: [
      '用「选择工具」框选或加选需要对齐的图层；',
      '在属性面板「对齐」区使用左/中/右、顶/中/底与水平/垂直分布；',
      '微调位置可直接在属性面板输入 X / Y 坐标；',
      '层级顺序在图层面板拖拽调整（可撤销）。',
    ],
    suggestionTitle: '手动整理布局：多选图层后用属性面板「对齐」与分布',
  },
  {
    label: '文本',
    keywords: ['文本', '文字', '字体', '字号', '行高', '文案', 'text', 'font'],
    steps: [
      '用「文本工具」在画布点击或拖拽创建文本；',
      '选中后在属性面板「文字」区调整字号、字体与行高；',
      '需要换字体时保持同类文本一致，避免混用多种字族。',
    ],
    suggestionTitle: '手动调整文本：文本工具创建，「文字」区改字号与行高',
  },
];

/** 通用兜底建议（空输入 / 未识别到任何关键词族）。 */
const FALLBACK_STEPS: readonly string[] = [
  '把需求拆成「新增」与「修改」两类，逐项列出目标图层；',
  '用画板 / 矩形 / 椭圆 / 文本工具在画布搭出基础结构；',
  '选中图层后在属性面板调整尺寸、填充、描边、圆角与文字；',
  '在图层面板重命名并整理层级，保持结构清晰。',
];

/** 固定注意事项（每次建议都附；诚实口径：本地规则、不改动文档、AI 需 key）。 */
const NOTES: readonly string[] = [
  '以上为本地规则生成的建议（非 AI 生成），不会改动你的文档；',
  '在设置页配置 DeepSeek key 后，可获得 AI 生成的文字建议。',
];

/** 拼装正文：识别对象行 → 分步编号 → 注意事项。 */
function composeContent(sections: readonly { label: string; steps: readonly string[] }[]): string {
  const lines: string[] = [];
  if (sections.length > 0) {
    const labels = sections.map((section) => `「${section.label}」`).join('');
    lines.push(`针对${labels}的操作建议：`);
    let stepNo = 0;
    for (const section of sections) {
      for (const step of section.steps) {
        stepNo += 1;
        lines.push(`${stepNo}. ${step}`);
      }
    }
  } else {
    lines.push('未能从描述中识别出具体设计对象，先按通用步骤整理：');
    for (const [index, step] of FALLBACK_STEPS.entries()) {
      lines.push(`${index + 1}. ${step}`);
    }
  }
  lines.push('');
  lines.push('注意事项：');
  for (const note of NOTES) {
    lines.push(`- ${note}`);
  }
  return lines.join('\n');
}

/**
 * 生成本地建议（确定性纯函数：同输入同输出；族序固定为表序）。
 *
 * @param prompt 用户提示词（空 / 无关键词走通用兜底）
 */
export function generateLocalAdvice(prompt: string): LocalAdvice {
  // 英文关键词按小写匹配（中文不受影响）；不做分词——子串命中即认为属于该族
  const haystack = prompt.toLowerCase();
  const matched = TOPICS.filter((topic) =>
    topic.keywords.some((keyword) => haystack.includes(keyword)),
  );

  return {
    content: composeContent(
      matched.map((topic) => ({ label: topic.label, steps: topic.steps })),
    ),
    suggestions: matched.map((topic) => ({
      kind: 'manual-edit',
      title: topic.suggestionTitle,
      detail: null,
    })),
  };
}
