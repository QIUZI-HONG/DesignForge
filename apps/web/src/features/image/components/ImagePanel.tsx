'use client';

/**
 * 出图面板（F5）——提示词表单 + 进度条 + 取消 + 结构化失败态。
 *
 * 口径（清单 F5 / 架构 §5.5）：
 * - 提交后按间隔轮询 `GET /image/runs/:runId`：有进度就确定进度条，没有就不确定进度条；
 * - 取消 = `POST …/cancel`（用户取消是静默非错误）；
 * - **未启动 / 缺模型是一等状态**：失败视图逐项渲染 daemon 给的可执行动作，
 *   OOM 额外给「降档重试」（降一档分辨率与步数后重提交，表单同步为降档后的值）。
 */
import type { ImageRunInputs, ImageRunStatus } from '@dforge/contracts';
import { AlertTriangleIcon, Button, Drawer, Progress } from '@dforge/ui';
import { useEffect, useMemo, useState } from 'react';

import { t } from '@/i18n';

import { createImagePort, type ImagePort } from '../client';
import { type ComfyFailureView, canDowngrade } from '../failure';
import { imageStyles } from './styles';
import { useImageRun } from './use-image-run';

/** ImagePanel props。 */
export interface ImagePanelProps {
  /** 端口（测试/门禁注入假实现；缺省真 daemon）。 */
  port?: ImagePort;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** daemon 已知的可执行动作（未知动作原样显示 id，便于发现契约漂移）。 */
const KNOWN_ACTIONS = new Set([
  'retry-probe',
  'set-base-url',
  'launch',
  'check-model-list',
  'retry-later',
  'adjust-params',
  'lower-resolution',
  'lower-steps',
  'check-template',
  'pick-template',
]);

/** 动作中文名（未知动作回退原 id）。 */
function actionLabel(action: string): string {
  return KNOWN_ACTIONS.has(action) ? t(`image.actions.${action}`) : action;
}

/** 动作行（`retry-probe` 由面板的按钮承担，不再重复成 chip）。 */
function ActionChips({ actions }: { actions: readonly string[] }) {
  const rest = actions.filter((action) => action !== 'retry-probe');
  if (rest.length === 0) return null;
  return (
    <div style={imageStyles.chipRow}>
      {rest.map((action) => (
        <span key={action} style={imageStyles.chip}>
          {actionLabel(action)}
        </span>
      ))}
    </div>
  );
}

/** 失败视图（含 OOM 的降档出路与缺模型的清单）。 */
function FailureView({
  failure,
  canRetryDowngraded,
  onDowngrade,
  onRetryProbe,
}: {
  failure: ComfyFailureView;
  canRetryDowngraded: boolean;
  onDowngrade: () => void;
  onRetryProbe: () => void;
}) {
  return (
    <div style={imageStyles.failureBox} data-df-image-failure={failure.code}>
      <div style={imageStyles.bannerHeader}>
        <AlertTriangleIcon size={14} />
        <span>{t('image.state.failed')}</span>
      </div>
      <p style={imageStyles.failureMessage}>{failure.message}</p>
      {failure.isOom ? <p style={imageStyles.bannerDetail}>{t('image.oom.hint')}</p> : null}
      {failure.missing.length > 0 ? (
        <div style={imageStyles.modelLists}>
          <span>
            {t('image.models.missing')}：{failure.missing.join('、')}
          </span>
          {failure.available.length > 0 ? (
            <span>
              {t('image.models.available')}：{failure.available.join('、')}
            </span>
          ) : null}
        </div>
      ) : null}
      <div style={imageStyles.chipRow}>
        {failure.actions.includes('retry-probe') || failure.code === 'comfy_unreachable' ? (
          <Button size="sm" onClick={onRetryProbe}>
            {t('image.probe.retry')}
          </Button>
        ) : null}
        {failure.isOom ? (
          <Button
            size="sm"
            variant="primary"
            onClick={onDowngrade}
            disabled={!canRetryDowngraded}
            {...(canRetryDowngraded
              ? {}
              : { disabledReason: t('image.action.downgrade.disabled') })}
          >
            {t('image.action.downgrade')}
          </Button>
        ) : null}
      </div>
      <ActionChips actions={failure.actions} />
    </div>
  );
}

/** 任务状态行（排队/生成中/终态）。 */
function statusText(status: ImageRunStatus): string {
  if (status.state === 'queued') {
    return status.queuePosition === null
      ? t('image.state.queued')
      : t('image.state.queued.position', { position: status.queuePosition });
  }
  if (status.state === 'running') {
    return status.progress === null
      ? t('image.state.running', { value: '…', max: '…' })
      : t('image.state.running', { value: status.progress.value, max: status.progress.max });
  }
  if (status.state === 'succeeded') return t('image.state.succeeded');
  if (status.state === 'canceled') return t('image.state.canceled');
  return t('image.state.failed');
}

/** 出图面板。 */
export function ImagePanel(props: ImagePanelProps) {
  const { port: injectedPort, open, defaultOpen, onOpenChange } = props;
  const port = useMemo(() => injectedPort ?? createImagePort(), [injectedPort]);
  const run = useImageRun({ port });

  const [positive, setPositive] = useState('');
  const [negative, setNegative] = useState('');
  const [width, setWidth] = useState(512);
  const [height, setHeight] = useState(512);
  const [steps, setSteps] = useState(20);

  // 表单与「上一次提交」同步：降档重试后表单即时反映降档后的值（所见即所提交）
  useEffect(() => {
    if (run.lastInputs === null) return;
    setWidth(run.lastInputs.width ?? 512);
    setHeight(run.lastInputs.height ?? 512);
    setSteps(run.lastInputs.steps ?? 20);
  }, [run.lastInputs]);

  const activeRun =
    run.status !== null && (run.status.state === 'queued' || run.status.state === 'running');
  const busy = run.submitting || activeRun;

  const inputs = (): ImageRunInputs => ({
    positive: positive.trim(),
    ...(negative.trim().length === 0 ? {} : { negative: negative.trim() }),
    width,
    height,
    steps,
  });

  const footer = (
    <div style={imageStyles.actions}>
      <Button
        variant="primary"
        onClick={() => run.submit(inputs())}
        disabled={busy || positive.trim().length === 0}
        loading={busy}
        loadingLabel={t('image.action.submitting')}
      >
        {t('image.action.submit')}
      </Button>
      {activeRun ? <Button onClick={run.cancel}>{t('image.action.cancel')}</Button> : null}
      <span style={imageStyles.spacer} />
    </div>
  );

  return (
    <Drawer
      {...(open === undefined ? {} : { open })}
      {...(defaultOpen === undefined ? {} : { defaultOpen })}
      {...(onOpenChange === undefined ? {} : { onOpenChange })}
      title={t('image.title')}
      description={t('image.subtitle')}
      closeLabel={t('image.close')}
      rememberKey="dfg-drawer-image"
      width="md"
      footer={footer}
    >
      <div data-df-panel="image" style={imageStyles.body}>
        {run.probing && run.probe === null ? (
          <p style={imageStyles.bannerDetail} role="status">
            {t('image.probe.checking')}
          </p>
        ) : null}

        {run.probe !== null && !run.probe.reachable && run.probe.failure !== null ? (
          <div style={imageStyles.banner} data-df-image-probe="unreachable">
            <div style={imageStyles.bannerHeader}>
              <AlertTriangleIcon size={14} />
              <span>{t('image.probe.unreachable.title')}</span>
            </div>
            <span style={imageStyles.bannerDetail}>{run.probe.failure.message}</span>
            <div style={imageStyles.chipRow}>
              <Button size="sm" onClick={run.recheckProbe}>
                {t('image.probe.retry')}
              </Button>
            </div>
            <ActionChips actions={run.probe.failure.actions} />
          </div>
        ) : null}

        <div style={imageStyles.field}>
          <label style={imageStyles.fieldLabel} htmlFor="dfg-image-positive">
            {t('image.form.positive')}
          </label>
          <textarea
            id="dfg-image-positive"
            value={positive}
            onChange={(event) => setPositive(event.target.value)}
            placeholder={t('image.form.positive.placeholder')}
            style={imageStyles.textarea}
          />
        </div>

        <div style={imageStyles.field}>
          <label style={imageStyles.fieldLabel} htmlFor="dfg-image-negative">
            {t('image.form.negative')}
          </label>
          <input
            id="dfg-image-negative"
            value={negative}
            onChange={(event) => setNegative(event.target.value)}
            style={imageStyles.paramInput}
          />
        </div>

        <div style={imageStyles.paramRow}>
          <label style={imageStyles.paramLabel}>
            {t('image.form.width')}
            <input
              type="number"
              value={width}
              onChange={(event) => setWidth(Number(event.target.value))}
              style={imageStyles.paramInput}
            />
          </label>
          <label style={imageStyles.paramLabel}>
            {t('image.form.height')}
            <input
              type="number"
              value={height}
              onChange={(event) => setHeight(Number(event.target.value))}
              style={imageStyles.paramInput}
            />
          </label>
          <label style={imageStyles.paramLabel}>
            {t('image.form.steps')}
            <input
              type="number"
              value={steps}
              onChange={(event) => setSteps(Number(event.target.value))}
              style={imageStyles.paramInput}
            />
          </label>
        </div>

        {run.status !== null ? (
          <div style={imageStyles.progressArea} data-df-image-run={run.status.state}>
            <div style={imageStyles.progressHeader}>
              <span style={imageStyles.statusText}>{statusText(run.status)}</span>
            </div>
            {activeRun ? (
              run.status.progress === null ? (
                <Progress label={t('image.progress.label')} />
              ) : (
                <Progress
                  label={t('image.progress.label')}
                  value={run.status.progress.value}
                  max={run.status.progress.max}
                />
              )
            ) : null}
          </div>
        ) : null}

        {run.failure !== null ? (
          <FailureView
            failure={run.failure}
            canRetryDowngraded={run.lastInputs !== null && canDowngrade(run.lastInputs)}
            onDowngrade={run.downgradeRetry}
            onRetryProbe={run.recheckProbe}
          />
        ) : null}

        {run.status !== null && run.status.state === 'succeeded' ? (
          <div style={imageStyles.field}>
            <span style={imageStyles.sectionTitle}>{t('image.result.title')}</span>
            {run.status.artifacts.length > 0 ? (
              <ul style={imageStyles.artifactList}>
                {run.status.artifacts.map((artifact) => (
                  <li key={artifact.sha256} style={imageStyles.artifactRow}>
                    <span style={imageStyles.artifactName}>{artifact.fileName}</span>
                    <span style={imageStyles.artifactSize}>
                      {t('image.result.size', { size: Math.round(artifact.sizeBytes / 1024) })}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <span style={imageStyles.emptyText}>{t('image.result.empty')}</span>
            )}
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}
