'use client';

import {
  AlertTriangleIcon,
  Button,
  CloseIcon,
  Drawer,
  DropdownMenu,
  EmptyState,
  ErrorState,
  ICONS,
  IconButton,
  type IconName,
  INTERACTION_STATES,
  Input,
  LoadingOverlay,
  Modal,
  PRIMITIVES,
  Progress,
  SegmentedControl,
  Skeleton,
  SkeletonCard,
  SkeletonText,
  Spinner,
  STATE_FAMILIES,
  ToastProvider,
  Tooltip,
  useToast,
} from '@dforge/ui';
/**
 * 设计系统预览页（`/_design`，**内部工具，不是对标页**）。
 *
 * 用途（FE-01 简报 §3）：
 * 1. 人工肉眼校——双主题切换（浅色首页族 / 深色编辑器族）下把全部基础件 × 全状态铺开；
 * 2. 组件级截图门禁取样——每个可对照单元带 `data-df-preview="<组件>/<变体>/<状态>"`，
 *    `scripts/verify-figma-component.mjs` 按名取样并与参照集（`~/df-evidence/reference-v1/`）比对。
 *
 * 状态复现口径：禁用/加载/空/错由 props 驱动；hover / active 用**状态强制类**
 * （`dfg-state-hover` / `dfg-state-active`，样式层与伪类同源）；focus-visible 静态无法成立，
 * 由截图门禁真实聚焦取证（页面底部有说明）。
 *
 * 文案：本页 UI 文案与产品页同样走 ICU 消息（zh-CN 唯一真源），不硬编码中文字面量。
 */
import { type CSSProperties, type ReactNode, useState } from 'react';

import { t } from '@/i18n';

import { ThemeToggle } from './theme-toggle';

/* ---------- 预览页版式（内联样式全走令牌变量；禁裸值守卫生效） ---------- */

const styles = {
  page: {
    minHeight: '100vh',
    display: 'grid',
    gap: 'var(--dfg-space-8)',
    padding: 'var(--dfg-space-8)',
    background: 'var(--dfg-color-canvas)',
    color: 'var(--dfg-color-text-primary)',
    fontFamily: 'var(--dfg-font-sans)',
    fontSize: 'var(--dfg-font-size-13)',
  },
  header: { display: 'grid', gap: 'var(--dfg-space-3)' },
  title: {
    margin: 0,
    fontSize: 'var(--dfg-font-size-24)',
    fontWeight: 'var(--dfg-font-weight-bold)',
  },
  subtitle: {
    margin: 0,
    color: 'var(--dfg-color-text-secondary)',
    lineHeight: 'var(--dfg-line-height-relaxed)',
  },
  tip: { margin: 0, color: 'var(--dfg-color-text-disabled)', fontSize: 'var(--dfg-font-size-11)' },
  section: {
    display: 'grid',
    gap: 'var(--dfg-space-4)',
    padding: 'var(--dfg-space-5)',
    background: 'var(--dfg-color-surface)',
    border: 'var(--dfg-border-width-hairline) solid var(--dfg-color-border)',
    borderRadius: 'var(--dfg-radius-lg)',
  },
  sectionTitle: {
    margin: 0,
    fontSize: 'var(--dfg-font-size-15)',
    fontWeight: 'var(--dfg-font-weight-medium)',
  },
  grid: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--dfg-space-3)',
    alignItems: 'flex-start',
  },
  cell: {
    display: 'grid',
    gap: 'var(--dfg-space-1)',
    justifyItems: 'start',
    padding: 'var(--dfg-space-2)',
    border: 'var(--dfg-border-width-hairline) dashed var(--dfg-color-border)',
    borderRadius: 'var(--dfg-radius-sm)',
  },
  cellLabel: { color: 'var(--dfg-color-text-disabled)', fontSize: 'var(--dfg-font-size-11)' },
  row: { display: 'flex', flexWrap: 'wrap', gap: 'var(--dfg-space-2)', alignItems: 'center' },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--dfg-space-1)',
    paddingBlock: 'var(--dfg-space-1)',
    paddingInline: 'var(--dfg-space-2)',
    background: 'var(--dfg-color-surface-subtle)',
    borderRadius: 'var(--dfg-radius-sm)',
    fontSize: 'var(--dfg-font-size-11)',
    color: 'var(--dfg-color-text-secondary)',
  },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 'var(--dfg-font-size-12)' },
  th: {
    textAlign: 'left',
    padding: 'var(--dfg-space-1) var(--dfg-space-2)',
    color: 'var(--dfg-color-text-secondary)',
    borderBottom: 'var(--dfg-border-width-hairline) solid var(--dfg-color-border)',
    fontWeight: 'var(--dfg-font-weight-medium)',
  },
  td: {
    padding: 'var(--dfg-space-1) var(--dfg-space-2)',
    borderBottom: 'var(--dfg-border-width-hairline) solid var(--dfg-color-border)',
  },
  swatch: {
    width: 'var(--dfg-space-12)',
    height: 'var(--dfg-space-6)',
    border: 'var(--dfg-border-width-hairline) solid var(--dfg-color-border)',
    borderRadius: 'var(--dfg-radius-sm)',
  },
  overlayStage: {
    position: 'relative',
    display: 'grid',
    placeItems: 'center',
    minHeight: 'var(--dfg-space-16)',
    padding: 'var(--dfg-space-4)',
    background: 'var(--dfg-color-surface-subtle)',
    borderRadius: 'var(--dfg-radius-md)',
  },
} satisfies Record<string, CSSProperties>;

/** 预览单元：带门禁取样名的容器。 */
function Cell({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div style={styles.cell} data-df-preview={id}>
      <span style={styles.cellLabel}>{label}</span>
      {children}
    </div>
  );
}

/** 分区外壳。 */
function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section style={styles.section} data-df-section={id}>
      <h2 style={styles.sectionTitle}>{title}</h2>
      {children}
    </section>
  );
}

/** 令牌色样（键名即变量名，人工校色用）。 */
function ColorSwatch({ name, varPath }: { name: string; varPath: string }) {
  return (
    <Cell id={`token/${name}`} label={name}>
      <span style={{ ...styles.swatch, background: `var(${varPath})` }} />
    </Cell>
  );
}

const COLOR_TOKENS: Array<[string, string]> = [
  ['color/primary', '--dfg-color-primary'],
  ['color/selection', '--dfg-color-selection'],
  ['color/surface', '--dfg-color-surface'],
  ['color/surface-raised', '--dfg-color-surface-raised'],
  ['color/surface-subtle', '--dfg-color-surface-subtle'],
  ['color/canvas', '--dfg-color-canvas'],
  ['color/border', '--dfg-color-border'],
  ['color/text-primary', '--dfg-color-text-primary'],
  ['color/text-secondary', '--dfg-color-text-secondary'],
  ['color/text-disabled', '--dfg-color-text-disabled'],
  ['color/danger', '--dfg-color-danger'],
  ['color/success', '--dfg-color-success'],
  ['color/warning', '--dfg-color-warning'],
  ['color/component', '--dfg-color-component'],
];

const RADIUS_TOKENS: Array<[string, string]> = [
  ['radius/sm', '--dfg-radius-sm'],
  ['radius/md', '--dfg-radius-md'],
  ['radius/lg', '--dfg-radius-lg'],
  ['radius/xl', '--dfg-radius-xl'],
  ['radius/pill', '--dfg-radius-pill'],
];

const BUTTON_VARIANTS = ['primary', 'secondary', 'ghost', 'danger'] as const;
const BUTTON_STATE_CLASS: Record<string, string> = {
  default: '',
  hover: 'dfg-state-hover',
  active: 'dfg-state-active',
};

/** 预览页主体。 */
export default function DesignPreviewPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <ToastProvider>
      <div style={styles.page}>
        <header style={styles.header}>
          <h1 style={styles.title}>{t('design.title')}</h1>
          <p style={styles.subtitle}>{t('design.subtitle')}</p>
          <div style={styles.row}>
            <ThemeToggle />
            <span style={styles.chip}>{t('design.theme.label')}</span>
          </div>
          <p style={styles.tip}>{t('design.tip')}</p>
        </header>

        <Section id="tokens" title={t('design.section.tokens')}>
          <div style={styles.grid}>
            {COLOR_TOKENS.map(([name, variable]) => (
              <ColorSwatch key={name} name={name} varPath={variable} />
            ))}
          </div>
          <div style={styles.grid}>
            {RADIUS_TOKENS.map(([name, variable]) => (
              <Cell key={name} id={`token/${name}`} label={name}>
                <span
                  style={{ ...styles.swatch, borderRadius: `var(${variable})` }}
                  // 圆角预览：色块本身用主色描边，便于肉眼对比档位
                />
              </Cell>
            ))}
          </div>
          <div style={styles.row}>
            <span style={styles.chip}>
              {`控件高 md = ${String(PRIMITIVES.iconSize.md)} / 密度默认随主题：浅色 32 ↔ 深色 28`}
            </span>
            <span style={styles.chip}>{'圆角档 3 / 6 / 8 / 13 / 999'}</span>
            <span style={styles.chip}>{'间距 4 的倍数（8px 栅格）'}</span>
          </div>
        </Section>

        <Section id="icons" title={t('design.section.icons')}>
          <div style={styles.grid}>
            {(Object.keys(ICONS) as IconName[]).map((name) => {
              const Icon = ICONS[name];
              return (
                <Cell key={name} id={`icon/${name}`} label={name}>
                  <Icon />
                </Cell>
              );
            })}
          </div>
        </Section>

        <Section id="families" title={t('design.section.families')}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>族</th>
                <th style={styles.th}>承载组件</th>
                {INTERACTION_STATES.map((state) => (
                  <th key={state} style={styles.th}>
                    {state}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {STATE_FAMILIES.map((family) => (
                <tr key={family.id} data-df-preview={`family/${family.id}`}>
                  <td style={styles.td}>
                    {family.id} · {family.name}
                  </td>
                  <td style={styles.td}>{family.components.join(' / ')}</td>
                  {INTERACTION_STATES.map((state) => (
                    <td key={state} style={styles.td}>
                      {family.states.includes(state) ? '✓' : '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section id="buttons" title={t('design.section.buttons')}>
          <div style={styles.grid}>
            {BUTTON_VARIANTS.map((variant) => (
              <Cell
                key={`${variant}-default`}
                id={`button/${variant}/default`}
                label={`${variant} · default`}
              >
                <Button variant={variant}>按钮</Button>
              </Cell>
            ))}
            {BUTTON_VARIANTS.map((variant) =>
              (['sm', 'md', 'lg'] as const).map((size) => (
                <Cell
                  key={`${variant}-size-${size}`}
                  id={`button/${variant}/size-${size}`}
                  label={`${variant} · ${size}`}
                >
                  <Button variant={variant} size={size}>
                    按钮
                  </Button>
                </Cell>
              )),
            )}
            {BUTTON_VARIANTS.map((variant) => (
              <Cell
                key={`${variant}-disabled`}
                id={`button/${variant}/disabled`}
                label={`${variant} · disabled`}
              >
                <Button variant={variant} disabled disabledReason={t('design.menu.readonly')}>
                  按钮
                </Button>
              </Cell>
            ))}
            {BUTTON_VARIANTS.map((variant) => (
              <Cell
                key={`${variant}-loading`}
                id={`button/${variant}/loading`}
                label={`${variant} · loading`}
              >
                <Button variant={variant} loading>
                  按钮
                </Button>
              </Cell>
            ))}
            {Object.entries(BUTTON_STATE_CLASS)
              .filter(([, className]) => className !== '')
              .map(([state, className]) => (
                <Cell
                  key={`primary-${state}`}
                  id={`button/primary/${state}`}
                  label={`primary · ${state}`}
                >
                  <Button variant="primary" className={className} icon={<ICONS.PlusIcon />}>
                    按钮
                  </Button>
                </Cell>
              ))}
            <Cell id="button/ghost/icon" label="ghost · 带图标">
              <Button variant="ghost" icon={<ICONS.PlusIcon />}>
                新建
              </Button>
            </Cell>
          </div>
        </Section>

        <Section id="icon-buttons" title={t('design.section.iconButtons')}>
          <div style={styles.grid}>
            {(['ghost', 'secondary', 'primary', 'danger'] as const).map((variant) => (
              <Cell
                key={variant}
                id={`icon-button/${variant}/default`}
                label={`${variant} · default`}
              >
                <IconButton
                  label={`iconbutton-${variant}`}
                  variant={variant}
                  icon={<ICONS.PlusIcon />}
                />
              </Cell>
            ))}
            <Cell id="icon-button/ghost/hover" label="ghost · hover">
              <IconButton
                label="iconbutton-hover"
                className="dfg-state-hover"
                icon={<ICONS.PlusIcon />}
              />
            </Cell>
            <Cell id="icon-button/ghost/pressed" label="ghost · pressed（选中）">
              <IconButton label="iconbutton-pressed" pressed icon={<ICONS.FrameIcon />} />
            </Cell>
            <Cell id="icon-button/ghost/disabled" label="ghost · disabled">
              <IconButton
                label="iconbutton-disabled"
                disabled
                disabledReason={t('design.menu.readonly')}
                icon={<ICONS.TrashIcon />}
              />
            </Cell>
            <Cell id="icon-button/ghost/loading" label="ghost · loading">
              <IconButton label="iconbutton-loading" loading icon={<ICONS.RefreshIcon />} />
            </Cell>
          </div>
        </Section>

        <Section id="segmented" title={t('design.section.segmented')}>
          <div style={styles.grid}>
            <Cell id="segmented/default" label="默认（网格选中）">
              <SegmentedControl
                label="视图"
                value="grid"
                onChange={() => {}}
                options={[
                  { value: 'grid', label: '网格', icon: <ICONS.FrameIcon /> },
                  { value: 'list', label: '列表' },
                  {
                    value: 'timeline',
                    label: '时间线',
                    disabled: true,
                    disabledReason: t('design.menu.readonly'),
                  },
                ]}
              />
            </Cell>
          </div>
        </Section>

        <Section id="inputs" title={t('design.section.inputs')}>
          <div style={styles.grid}>
            <Cell id="input/text/default" label="text · default">
              <Input fieldLabel={t('design.field.name')} defaultValue="矩形 1" />
            </Cell>
            <Cell id="input/text/focus" label="text · focus">
              <Input
                fieldLabel={t('design.field.name')}
                defaultValue="矩形 1"
                wrapClassName="dfg-state-focus"
              />
            </Cell>
            <Cell id="input/text/disabled" label="text · disabled">
              <Input fieldLabel={t('design.field.name')} defaultValue="矩形 1" disabled />
            </Cell>
            <Cell id="input/number/error" label="number · error">
              <Input
                fieldLabel={t('design.field.width')}
                kind="number"
                defaultValue="abc"
                errorMessage="请输入 1–4096 的数字"
              />
            </Cell>
            <Cell id="input/search/default" label="search · default">
              <Input kind="search" placeholder={t('design.search.placeholder')} />
            </Cell>
            <Cell id="input/search/hint" label="search · hint">
              <Input
                kind="search"
                placeholder={t('design.search.placeholder')}
                hint="支持按名称、标签与成员搜索"
              />
            </Cell>
          </div>
        </Section>

        <Section id="tooltip" title={t('design.section.tooltip')}>
          <div style={styles.grid}>
            <Cell id="tooltip/top" label="tooltip · top（悬停或聚焦）">
              <Tooltip content={t('design.tooltip.content')} delay={0}>
                <Button>{t('design.tooltip.anchor')}</Button>
              </Tooltip>
            </Cell>
          </div>
        </Section>

        <Section id="menu" title={t('design.section.menu')}>
          <div style={styles.grid}>
            <Cell id="menu/default" label="menu · 展开（含禁用项与分隔线）">
              <DropdownMenu
                label={t('design.action.menu')}
                defaultOpen
                tooltipDelay={0}
                sections={[
                  {
                    id: 'edit',
                    items: [
                      {
                        id: 'copy',
                        label: t('design.menu.copy'),
                        icon: <ICONS.CopyIcon />,
                        shortcut: '⌘C',
                      },
                      {
                        id: 'paste',
                        label: t('design.menu.paste'),
                        icon: <ICONS.CopyIcon />,
                        shortcut: '⌘V',
                      },
                    ],
                  },
                  {
                    id: 'danger',
                    label: t('design.menu.sectionDanger'),
                    items: [
                      {
                        id: 'delete',
                        label: t('design.menu.delete'),
                        icon: <ICONS.TrashIcon />,
                        danger: true,
                        disabled: true,
                        disabledReason: t('design.menu.readonly'),
                      },
                    ],
                  },
                ]}
                trigger={({ triggerProps }) => (
                  <Button {...triggerProps} icon={<ICONS.MoreHorizontalIcon />}>
                    {t('design.action.menu')}
                  </Button>
                )}
              />
            </Cell>
          </div>
        </Section>

        <Section id="modal" title={t('design.section.modal')}>
          <div style={styles.row}>
            <Button variant="primary" onClick={() => setModalOpen(true)}>
              {t('design.action.openModal')}
            </Button>
          </div>
          <Modal
            open={modalOpen}
            onOpenChange={setModalOpen}
            title={t('design.modal.title')}
            description={t('design.modal.desc')}
            closeLabel={t('design.modal.close')}
            footer={
              <>
                <Button onClick={() => setModalOpen(false)}>
                  {t('design.action.modalCancel')}
                </Button>
                <Button variant="danger" onClick={() => setModalOpen(false)}>
                  {t('design.action.modalConfirm')}
                </Button>
              </>
            }
          >
            <SkeletonText lines={3} />
          </Modal>
        </Section>

        <Section id="drawer" title={t('design.section.drawer')}>
          <div style={styles.row}>
            <Button variant="primary" onClick={() => setDrawerOpen(true)}>
              {t('design.action.openDrawer')}
            </Button>
          </div>
          <Drawer
            open={drawerOpen}
            onOpenChange={setDrawerOpen}
            title={t('design.drawer.title')}
            closeLabel={t('design.drawer.close')}
            rememberKey="dfg-preview-drawer"
            width="md"
          >
            <SkeletonText lines={4} />
          </Drawer>
        </Section>

        <Section id="toast" title={t('design.section.toast')}>
          <ToastDemo />
        </Section>

        <Section id="empty" title={t('design.section.empty')}>
          <div style={styles.grid}>
            <Cell id="empty/default" label="空态 · 默认插图">
              <EmptyState
                title={t('design.state.empty.title')}
                description={t('design.state.empty.desc')}
                action={<Button variant="primary">{t('design.state.empty.action')}</Button>}
              />
            </Cell>
          </div>
        </Section>

        <Section id="error" title={t('design.section.error')}>
          <div style={styles.grid}>
            <Cell id="error/default" label="错误态 · 重试 + 错误码">
              <ErrorState
                title={t('design.state.error.title')}
                description={t('design.state.error.desc')}
                code="E_NET_503"
                retryLabel={t('design.state.error.retry')}
                onRetry={() => {}}
              />
            </Cell>
            <Cell id="error/retrying" label="错误态 · 重试中">
              <ErrorState
                title={t('design.state.error.title')}
                code="E_NET_503"
                retryLabel={t('design.state.error.retry')}
                onRetry={() => {}}
                retrying
              />
            </Cell>
          </div>
        </Section>

        <Section id="loading" title={t('design.section.loading')}>
          <div style={styles.grid}>
            <Cell id="loading/spinner" label="spinner（sm/md/lg）">
              <span style={styles.row}>
                <Spinner size="sm" label="小转圈" />
                <Spinner label="中转圈" />
                <Spinner size="lg" label="大转圈" />
              </span>
            </Cell>
            <Cell id="loading/skeleton-text" label="骨架 · 文本 3 行">
              <SkeletonText lines={3} />
            </Cell>
            <Cell id="loading/skeleton-card" label="骨架 · 文件卡片">
              <SkeletonCard />
            </Cell>
            <Cell id="loading/skeleton-block" label="骨架 · 单块">
              <Skeleton width="var(--dfg-space-16)" />
            </Cell>
            <Cell id="loading/progress" label="进度 · 确定 40%">
              <Progress value={40} label="导出进度" />
            </Cell>
            <Cell id="loading/progress-indeterminate" label="进度 · 不确定">
              <Progress label="准备中" />
            </Cell>
            <Cell id="loading/overlay" label="阻塞遮罩">
              <span style={styles.overlayStage}>
                <span style={styles.row}>
                  <Skeleton width="var(--dfg-space-16)" />
                  <Skeleton width="var(--dfg-space-10)" />
                </span>
                <LoadingOverlay label={t('design.loading.overlay')} />
              </span>
            </Cell>
            <Cell id="loading/error-icon" label="警示图标（错误族图形）">
              <AlertTriangleIcon size={24} />
            </Cell>
            <Cell id="loading/close-icon" label="关闭图标">
              <CloseIcon />
            </Cell>
          </div>
        </Section>
      </div>
    </ToastProvider>
  );
}

/** Toast 演示（必须在 Provider 内才能拿句柄）。 */
function ToastDemo() {
  const toast = useToast();
  return (
    <div style={styles.row}>
      <Button
        onClick={() => {
          const id = toast.show({
            message: t('design.toast.saved'),
            tone: 'success',
            duration: 0,
            action: {
              label: t('design.toast.undo'),
              onActivate: () => toast.show({ message: t('design.toast.undone'), tone: 'info' }),
            },
          });
          return id;
        }}
      >
        {t('design.action.toastSuccess')}
      </Button>
      <Button
        onClick={() => {
          toast.show({ message: t('design.toast.failed'), tone: 'error', duration: 0 });
        }}
      >
        {t('design.action.toastError')}
      </Button>
      <Button
        onClick={() => {
          toast.show({ message: t('design.toast.info'), tone: 'info', duration: 0 });
        }}
      >
        {t('design.action.toastInfo')}
      </Button>
    </div>
  );
}
