'use client';

/**
 * UsageExamples —— 使用示例话术列表（票② · D2「试试这样用」升级）。
 *
 * 数据口径：来自索引卡片 `usageExamples`（SKILL.md frontmatter `examples:` 透传——
 * **存在才填、缺失省略、不编造**）；本组件只在非空数组时被渲染，不处理空态。
 * 每条话术可一键复制；剪贴板不可用或写入被拒时给「手动复制」出口（失败有说法，不静默）。
 */

import { Button } from '@dforge/ui';
import { useState } from 'react';

import { t } from '@/i18n';

/** 复制文本到剪贴板（环境不支持/写入被拒 → false；调用方据此给手动复制出口）。 */
async function copyText(text: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || navigator.clipboard === undefined) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** 使用示例 props。 */
export interface UsageExamplesProps {
  examples: readonly string[];
}

/** 使用示例话术列表（每条可复制）。 */
export function UsageExamples({ examples }: UsageExamplesProps) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);

  const copy = async (text: string, index: number): Promise<void> => {
    const ok = await copyText(text);
    setCopiedIndex(ok ? index : null);
    setCopyFailed(!ok);
  };

  return (
    <div className="dfg-market__usage-examples" data-df-market="usage-examples">
      <h3 className="dfg-market__usage-examples-title">{t('market.detail.usageExamples')}</h3>
      <ul className="dfg-market__usage-list">
        {examples.map((example, index) => (
          <li key={`${index}:${example}`} className="dfg-market__usage-item">
            <span className="dfg-market__usage-text">{example}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void copy(example, index)}
              data-df-market="usage-copy"
              data-df-state={copiedIndex === index ? 'copied' : 'default'}
            >
              {copiedIndex === index
                ? t('market.detail.usageExamplesCopied')
                : t('market.detail.usageExamplesCopy')}
            </Button>
          </li>
        ))}
      </ul>
      {copyFailed ? (
        <p className="dfg-market__hint" role="status" data-df-market="usage-copy-failed">
          {t('market.detail.usageExamplesCopyFailed')}
        </p>
      ) : null}
    </div>
  );
}
