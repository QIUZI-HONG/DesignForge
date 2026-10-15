'use client';

/**
 * AI 提示区（FE-02 · B1 主结构里的 AI 提示区）。
 *
 * 边界（如实）：AI 助手本身归编辑器（FE-10 的 AI 抽屉）。本票只落**首页的这一块结构**
 * ——标题 + 一行说明 + 主按钮；按钮当前给出「随编辑器接入」的说明（Toast），
 * 不假装可用、也不做成点了没反应的死按钮。
 */
import { Button } from '@dforge/ui';

import { t } from '@/i18n';

import { SparkleIcon } from '../icons';

/** AI 提示区 props。 */
export interface AiHintBarProps {
  /** 点主按钮（父级给反馈）。 */
  onOpenAi: () => void;
}

/** AI 提示区。 */
export function AiHintBar({ onOpenAi }: AiHintBarProps) {
  return (
    <section className="dfg-home__ai" aria-label={t('home.ai.title')}>
      <span className="dfg-home__ai-icon" aria-hidden="true">
        <SparkleIcon size={24} />
      </span>
      <div className="dfg-home__ai-text">
        <div className="dfg-home__ai-title">{t('home.ai.title')}</div>
        <p className="dfg-home__ai-desc">{t('home.ai.desc')}</p>
      </div>
      <Button variant="primary" onClick={onOpenAi}>
        {t('home.ai.action')}
      </Button>
    </section>
  );
}
