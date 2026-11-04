/**
 * @dforge/ui —— 设界设计系统。
 *
 * 定位（《前端实现规格 v1》§一.3）：承载**双基准令牌**（浅色首页族 ↔ 深色编辑器族 +
 * 密度映射）与**基础组件**（按钮/输入/下拉菜单/模态/抽屉/Toast/状态族基础件）。
 * 消费方：apps/web 全站页面（FE-02 … FE-11）、apps/desktop 壳（FE-12）。
 *
 * 硬约束：
 * - **组件禁裸值**——颜色/间距/圆角/字号一律取本包令牌（`scripts/guard-tokens.mjs` 守卫）；
 * - **props 不含业务文案**——文案由调用方传入（zh-CN 唯一暴露，ADR-0003）；
 * - 样式随包分发：调用方导入 `@dforge/ui/styles.css`（令牌变量 + 组件样式）。
 */

/** 包标识。 */
export const UI_PACKAGE = '@dforge/ui' as const;

export {
  Button,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
  Collapse,
  type CollapseProps,
  ColorField,
  type ColorFieldProps,
  Drawer,
  type DrawerProps,
  type DrawerStorage,
  type DrawerWidth,
  DropdownMenu,
  type DropdownMenuProps,
  EmptyState,
  type EmptyStateProps,
  ErrorState,
  type ErrorStateProps,
  IconButton,
  type IconButtonProps,
  type IconButtonSize,
  type IconButtonVariant,
  Input,
  type InputKind,
  type InputProps,
  LoadingOverlay,
  type LoadingOverlayProps,
  type MenuItemSpec,
  type MenuSectionSpec,
  type MenuTriggerState,
  Modal,
  type ModalProps,
  type ModalSize,
  NumberField,
  type NumberFieldMessages,
  type NumberFieldProps,
  Overlay,
  type OverlayProps,
  Progress,
  type ProgressProps,
  type ProgressTone,
  SegmentedControl,
  type SegmentedControlProps,
  type SegmentedOption,
  Skeleton,
  SkeletonCard,
  type SkeletonCardProps,
  type SkeletonProps,
  SkeletonText,
  type SkeletonTextProps,
  Spinner,
  type SpinnerProps,
  type SpinnerSize,
  Swatch,
  type SwatchProps,
  TabPanel,
  type TabPanelProps,
  type TabSpec,
  Tabs,
  type TabsProps,
  TechnicalDetails,
  type TechnicalDetailsProps,
  type ToastAction,
  type ToastHandle,
  type ToastOptions,
  ToastProvider,
  type ToastProviderProps,
  type ToastTone,
  Tooltip,
  type TooltipPlacement,
  type TooltipProps,
  Tree,
  type TreeNodeSpec,
  type TreeProps,
  useToast,
} from './components/index';
// 图标整体透出：单个图标（工具条/面板按名引用）与 ICONS 注册表（列举用）都要能取到
export * from './icons/index';
export {
  INTERACTION_STATES,
  type InteractionState,
  STATE_FAMILIES,
  type StateFamilyEntry,
} from './state-families';
export {
  applyDocumentTheme,
  cssVar,
  cssVarName,
  DENSITY,
  type DensityName,
  type DensityScale,
  flattenPrimitives,
  flattenTheme,
  type MotionSemanticScale,
  PRIMITIVES,
  THEMES,
  type Theme,
  type ThemeColors,
  type ThemeElevation,
  type ThemeFocusRing,
  type ThemeName,
  type ThemeShadows,
  type TokenVars,
  themeOf,
} from './tokens';
// 草稿态 + 300ms 提交调度：跨控件的可复用原语（数值编辑 NumberField 与 inspector 文本草稿
// 共用同一份计时/撤销粒度语义）。按 ADR-0004 ② 的「新增公开面 = 显式加行」登记为包公开面
// （arch-fix4 · Spec P3 复核：它不是包内实现细节，而是「输入期间只改草稿、提交时刻才发命令」
// 这一交互规格的公开承载）。
export {
  COMMIT_DELAY_MS,
  type DraftCommit,
  type DraftCommitOptions,
  useDraftCommit,
} from './utils/use-draft-commit';
