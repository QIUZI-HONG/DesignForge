/**
 * 状态族登记表（FE-01 交付的「逐项打勾」唯一清单）。
 *
 * 依据：《前端验收标准 v1》§5 状态覆盖清单（hover / active(focus-visible) / disabled /
 * loading / empty / error）+ 《对照页面清单 v1》F 区族号。
 * 用法：
 * - `/_design` 预览页按本表铺矩阵（族 → 承载组件 → 六态）；
 * - `scripts/verify-figma-component.mjs` 按本表生成证据 JSON 的状态待办项（参照集未冻结时 exit 2）；
 * - 测试断言「族号齐备 + 承载组件确实从包入口导出 + 六态被各族覆盖」。
 *
 * 注意：本表登记**基础件**；页面级用例（如「无文件空态」）由各页票在其页面上取证。
 */
import type { IconName } from './icons/index';

/** 验收标准 §5 的六态。 */
export type InteractionState = 'hover' | 'active' | 'disabled' | 'loading' | 'empty' | 'error';

/** 六态全集（顺序即矩阵铺开顺序）。 */
export const INTERACTION_STATES: InteractionState[] = [
  'hover',
  'active',
  'disabled',
  'loading',
  'empty',
  'error',
];

/** 状态族条目。 */
export interface StateFamilyEntry {
  /** 族号（清单 F 区）。 */
  id: string;
  /** 族名（与清单/GLOSSARY 用词一致）。 */
  name: string;
  /** 归属说明：基础件归 FE-01，页面级用例归对应页票。 */
  owner: string;
  /** 承载组件（包入口导出名；测试断言可解析）。 */
  components: string[];
  /** 本族覆盖的六态。 */
  states: InteractionState[];
  /** 预览页示例用图标（视觉密集度用，不是语义依赖）。 */
  icon: IconName;
}

/** 本票落地的状态族（F1/F2/F3/F11–F15）。 */
export const STATE_FAMILIES: StateFamilyEntry[] = [
  {
    id: 'F1',
    name: '模态族',
    owner: 'FE-01 基础件（Modal）；页面级 8 种模态归各页票',
    components: ['Modal'],
    states: ['hover', 'active', 'disabled', 'loading', 'error'],
    icon: 'FrameIcon',
  },
  {
    id: 'F2',
    name: '抽屉族',
    owner: 'FE-01 基础件（Drawer）；AI/出图面板归 FE-10',
    components: ['Drawer'],
    states: ['hover', 'active', 'disabled', 'loading', 'error'],
    icon: 'LayersIcon',
  },
  {
    id: 'F3',
    name: '弹出菜单族',
    owner: 'FE-01 基础件（DropdownMenu）；页面级 4 种菜单归各页票',
    components: ['DropdownMenu'],
    states: ['hover', 'active', 'disabled', 'error'],
    icon: 'MoreHorizontalIcon',
  },
  {
    id: 'F11',
    name: 'Toast',
    owner: 'FE-01 基础件（ToastProvider/useToast）',
    components: ['ToastProvider', 'useToast'],
    states: ['active', 'disabled', 'loading', 'error'],
    icon: 'CheckCircleIcon',
  },
  {
    id: 'F12',
    name: '空态族',
    owner: 'FE-01 基础件（EmptyState）；各页空态文案归各页票',
    components: ['EmptyState'],
    states: ['empty', 'disabled'],
    icon: 'BoxIcon',
  },
  {
    id: 'F13',
    name: '加载态族',
    owner: 'FE-01 基础件（Spinner/Skeleton/Progress/LoadingOverlay/Button.loading）',
    components: [
      'Spinner',
      'Skeleton',
      'SkeletonText',
      'SkeletonCard',
      'Progress',
      'LoadingOverlay',
    ],
    states: ['loading', 'disabled', 'empty'],
    icon: 'RefreshIcon',
  },
  {
    id: 'F14',
    name: '错误态族',
    owner: 'FE-01 基础件（ErrorState）；网络/权限/崩溃分类归各页票与 FE-10 诊断',
    components: ['ErrorState'],
    states: ['error', 'active', 'disabled'],
    icon: 'AlertTriangleIcon',
  },
  {
    id: 'F15',
    name: '禁用态族',
    owner: 'FE-01 基础件（各组件 disabled/disabledReason + Tooltip 原因）',
    components: ['Button', 'IconButton', 'Input', 'DropdownMenu', 'SegmentedControl', 'Tooltip'],
    states: ['disabled', 'hover', 'error'],
    icon: 'LockIcon',
  },
];
