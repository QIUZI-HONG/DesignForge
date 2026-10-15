'use client';

/**
 * AI 抽屉（F4）——自然语言输入 + 四步步骤流 + 结果区。
 *
 * 口径（清单 F4 / 架构 §4.5.1）：
 * - 步骤流 `queued → llm → validate → compile`，失败落在所在步并可重试；
 * - **降级角标「本地模板」**：无 key / 上游失败时 daemon 给出与真响应同构的降级响应，
 *   本组件只读 `degraded` 一个字段渲染角标，**不为降级写任何分支**；
 * - 建议清单按 kind 渲染动作（配置凭据 → 去设置；稍后重试 → 重试；手动修改 → 提示文案）。
 *
 * 依赖注入：`port` 不给时用真 daemon 端口（`NEXT_PUBLIC_DF_DAEMON_URL` / 回环缺省）。
 */
import { AlertCircleIcon, Button, CheckIcon, Drawer, Spinner } from '@dforge/ui';
import { useMemo, useState } from 'react';

import { t } from '@/i18n';

import { type AiPort, createAiPort } from '../client';
import { AI_STEPS, type AiStepId, type AiStepStatus } from '../steps';
import { aiStyles, stepAccent } from './styles';
import { useAiRun } from './use-ai-run';

/** AiDrawer props。 */
export interface AiDrawerProps {
  /** 端口（测试/门禁注入假实现；缺省真 daemon）。 */
  port?: AiPort;
  /** 受控开合（缺省非受控，记忆键 `dfg-drawer-ai`）。 */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** 建议动作「去配置 key」的落点（设置页由 FE-09 提供；缺省不渲染该按钮）。 */
  onConfigureCredentials?: () => void;
}

/** 步骤图标（活动=转圈 / 完成=对勾 / 失败=警示 / 等待=空心圆）。 */
function StepGlyph({ status }: { status: AiStepStatus }) {
  if (status === 'active') return <Spinner size="sm" />;
  if (status === 'done') return <CheckIcon size={12} title={t('ai.step.status.done')} />;
  if (status === 'failed') return <AlertCircleIcon size={12} title={t('ai.step.status.failed')} />;
  return <span style={aiStyles.stepDot} aria-hidden="true" />;
}

/** 单步（`data-df-step` / `data-df-step-status` 是门禁与测试共用的挂点）。 */
function StepRow({ id, status }: { id: AiStepId; status: AiStepStatus }) {
  return (
    <li
      data-df-step={id}
      data-df-step-status={status}
      aria-current={status === 'active' ? 'step' : undefined}
      style={aiStyles.stepRow}
    >
      <StepGlyph status={status} />
      <span style={{ ...aiStyles.stepLabel, color: stepAccent(status) }}>{t(`ai.step.${id}`)}</span>
      <span style={aiStyles.stepStatus}>{t(`ai.step.status.${status}`)}</span>
    </li>
  );
}

/** 建议清单（降级与部分失败场景的可操作出口）。 */
function Suggestions({
  suggestions,
  onRetry,
  onConfigureCredentials,
}: {
  suggestions: readonly {
    kind: string;
    title: string;
    detail: string | null;
  }[];
  onRetry: () => void;
  onConfigureCredentials?: (() => void) | undefined;
}) {
  if (suggestions.length === 0) return null;
  return (
    <ul aria-label={t('ai.suggestion.actions')} style={aiStyles.suggestionList}>
      {suggestions.map((suggestion, index) => (
        <li key={`${suggestion.kind}-${String(index)}`} style={aiStyles.suggestionRow}>
          <span style={aiStyles.suggestionText}>
            <span>{suggestion.title}</span>
            {suggestion.detail === null ? null : (
              <span style={aiStyles.suggestionDetail}>{suggestion.detail}</span>
            )}
          </span>
          {suggestion.kind === 'configure-credentials' && onConfigureCredentials !== undefined ? (
            <Button size="sm" variant="primary" onClick={onConfigureCredentials}>
              {t('ai.suggestion.configure')}
            </Button>
          ) : null}
          {suggestion.kind === 'retry-later' || suggestion.kind === 'check-network' ? (
            <Button size="sm" onClick={onRetry}>
              {t('ai.suggestion.retry')}
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** AI 抽屉。 */
export function AiDrawer(props: AiDrawerProps) {
  const { port: injectedPort, open, defaultOpen, onOpenChange, onConfigureCredentials } = props;
  const port = useMemo(() => injectedPort ?? createAiPort(), [injectedPort]);
  const { state, status, submit, retry } = useAiRun({ port });
  const [prompt, setPrompt] = useState('');
  const running = state.phase === 'running';

  const footer = (
    <div style={aiStyles.actions}>
      <Button
        variant="primary"
        onClick={() => submit(prompt)}
        disabled={running || prompt.trim().length === 0}
        loading={running}
        loadingLabel={t('ai.action.submitting')}
      >
        {t('ai.action.submit')}
      </Button>
      <span style={aiStyles.spacer} />
      {state.attempt > 0 ? (
        <span style={aiStyles.stepStatus}>{t('ai.attempt', { count: state.attempt })}</span>
      ) : null}
    </div>
  );

  return (
    <Drawer
      {...(open === undefined ? {} : { open })}
      {...(defaultOpen === undefined ? {} : { defaultOpen })}
      {...(onOpenChange === undefined ? {} : { onOpenChange })}
      title={t('ai.title')}
      description={t('ai.subtitle')}
      closeLabel={t('ai.close')}
      rememberKey="dfg-drawer-ai"
      width="md"
      footer={footer}
    >
      <div style={aiStyles.body}>
        {status !== null && !status.configured && status.degradedHint !== null ? (
          <p role="status" style={aiStyles.hint}>
            {status.degradedHint}
          </p>
        ) : null}

        <div style={aiStyles.field}>
          <label style={aiStyles.fieldLabel} htmlFor="dfg-ai-prompt">
            {t('ai.input.label')}
          </label>
          <textarea
            id="dfg-ai-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={t('ai.input.placeholder')}
            disabled={running}
            style={aiStyles.textarea}
          />
        </div>

        <section aria-label={t('ai.steps.label')} style={aiStyles.field}>
          <span style={aiStyles.sectionTitle}>{t('ai.steps.label')}</span>
          <ul aria-label={t('ai.steps.label')} style={aiStyles.stepList}>
            {AI_STEPS.map((id) => (
              <StepRow key={id} id={id} status={state.steps[id]} />
            ))}
          </ul>
        </section>

        <section
          aria-label={t('ai.result.title')}
          style={aiStyles.result}
          data-df-ai-result={state.phase}
        >
          <div style={aiStyles.resultHeader}>
            <span style={aiStyles.sectionTitle}>{t('ai.result.title')}</span>
            <span style={aiStyles.spacer} />
            {state.degraded ? (
              <span
                data-df-badge="local-template"
                title={t('ai.badge.localTemplate.desc')}
                style={aiStyles.badge}
              >
                {t('ai.badge.localTemplate')}
              </span>
            ) : null}
          </div>

          {state.phase === 'failed' && state.error !== null ? (
            <div style={aiStyles.actions}>
              <span style={aiStyles.errorText}>{state.error}</span>
              <span style={aiStyles.spacer} />
              <Button size="sm" onClick={retry}>
                {t('ai.action.retry')}
              </Button>
            </div>
          ) : null}

          {state.content.length > 0 ? (
            <p style={aiStyles.content}>{state.content}</p>
          ) : state.phase === 'done' && state.degraded ? (
            <p style={aiStyles.suggestionDetail}>{t('ai.badge.localTemplate.desc')}</p>
          ) : state.phase === 'idle' ? (
            <p style={aiStyles.suggestionDetail}>{t('ai.result.empty')}</p>
          ) : null}

          {state.phase === 'done' ? (
            <Suggestions
              suggestions={state.suggestions}
              onRetry={retry}
              onConfigureCredentials={onConfigureCredentials}
            />
          ) : null}
        </section>
      </div>
    </Drawer>
  );
}
