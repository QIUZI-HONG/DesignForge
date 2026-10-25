'use client';

/**
 * 编辑器左栏组合（图层 / 资产双页签）——FE-03 编辑器壳把它挂在编辑器路由左栏。
 *
 * 为什么合成一个组件：Figma 的左面板就是「文件（图层）」与「资产」两个页签共享一栏；
 * 面板各自独立（`LayersPanel` / `AssetsPanel`）仍可单独挂载，
 * 组合后的整栏带 `data-df-panel-group` 供面板级截图门禁取样（保留完整面板边界 + spec 规定的固定外扩边距）。
 * 样式单轨（工单 06）：整栏/页签条样式走 editor-panels.css 类（.dfg-panels__group / __tab-strip）。
 */
import { SegmentedControl } from '@dforge/ui';

import { t } from '@/i18n';
import { usePanelsUi } from '../state/hooks';
import type { LeftPanelTab } from '../state/panels-store';
import { AssetsPanel, type AssetsPanelProps } from './AssetsPanel';
import { LayersPanel, type LayersPanelProps } from './LayersPanel';
import { usePanelsSession } from './panels-context';

import '../editor-panels.css';

/** 左栏组合 props：与两个面板共用同一份数据态（loading/error/retry）。 */
export interface EditorPanelsProps extends LayersPanelProps, AssetsPanelProps {}

/** 编辑器左栏（图层 / 资产）。 */
export function EditorPanels({ loading, error, onRetry, className }: EditorPanelsProps) {
  const session = usePanelsSession();
  const leftTab = usePanelsUi(session, (state) => state.leftTab);

  const shared: LayersPanelProps = {
    ...(loading === undefined ? {} : { loading }),
    ...(error === undefined ? {} : { error }),
    ...(onRetry === undefined ? {} : { onRetry }),
  };
  const groupClass =
    className === undefined ? 'dfg-panels__group' : `${className} dfg-panels__group`;

  return (
    <div data-df-panel-group="editor-panels" className={groupClass}>
      <div className="dfg-panels__tab-strip">
        <SegmentedControl
          label={t('panels.tabs.label')}
          size="sm"
          value={leftTab}
          options={[
            { value: 'layers', label: t('panels.layers.title') },
            { value: 'assets', label: t('panels.assets.title') },
          ]}
          onChange={(value) => {
            session.ui.getState().setLeftTab(value as LeftPanelTab);
          }}
        />
      </div>
      {leftTab === 'assets' ? (
        <AssetsPanel {...shared} hideHeader />
      ) : (
        <LayersPanel {...shared} hideHeader />
      )}
    </div>
  );
}
