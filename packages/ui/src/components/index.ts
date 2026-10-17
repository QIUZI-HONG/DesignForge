/**
 * 基础组件 barrel（@dforge/ui）。
 *
 * 组件清单与状态族归属见 `../state-families.ts`（F1/F2/F3/F11–F15 逐项打勾的唯一清单）。
 * 所有组件：props 不含业务文案（文案由调用方传）、禁裸值（样式全走令牌变量）。
 */

export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from './Button';
export {
  Drawer,
  type DrawerProps,
  type DrawerStorage,
  type DrawerWidth,
} from './Drawer';
export {
  DropdownMenu,
  type DropdownMenuProps,
  type MenuItemSpec,
  type MenuSectionSpec,
  type MenuTriggerState,
} from './DropdownMenu';
export { EmptyState, type EmptyStateProps } from './EmptyState';
export { ErrorState, type ErrorStateProps } from './ErrorState';
export {
  IconButton,
  type IconButtonProps,
  type IconButtonSize,
  type IconButtonVariant,
} from './IconButton';
export { Input, type InputKind, type InputProps } from './Input';
export { LoadingOverlay, type LoadingOverlayProps } from './LoadingOverlay';
export { Modal, type ModalProps, type ModalSize } from './Modal';
export { Overlay, type OverlayProps } from './Overlay';
export { Progress, type ProgressProps, type ProgressTone } from './Progress';
export {
  SegmentedControl,
  type SegmentedControlProps,
  type SegmentedOption,
} from './SegmentedControl';
export {
  Skeleton,
  SkeletonCard,
  type SkeletonCardProps,
  type SkeletonProps,
  SkeletonText,
  type SkeletonTextProps,
} from './Skeleton';
export { Spinner, type SpinnerProps, type SpinnerSize } from './Spinner';
export {
  type ToastAction,
  type ToastHandle,
  type ToastOptions,
  ToastProvider,
  type ToastProviderProps,
  type ToastTone,
  useToast,
} from './Toast';
export { Tooltip, type TooltipPlacement, type TooltipProps } from './Tooltip';
