/**
 * 基础组件 barrel（@dforge/ui）。
 *
 * 组件清单与状态族归属见 `../state-families.ts`（F1/F2/F3/F11–F15 逐项打勾的唯一清单）。
 * 所有组件：props 不含业务文案（文案由调用方传）、禁裸值（样式全走令牌变量）。
 */

export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from './Button';
export {
  IconButton,
  type IconButtonProps,
  type IconButtonSize,
  type IconButtonVariant,
} from './IconButton';
export {
  SegmentedControl,
  type SegmentedControlProps,
  type SegmentedOption,
} from './SegmentedControl';
export { Spinner, type SpinnerProps, type SpinnerSize } from './Spinner';
export { Tooltip, type TooltipPlacement, type TooltipProps } from './Tooltip';
