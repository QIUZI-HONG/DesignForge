'use client';

/**
 * 编辑器左栏组合（图层 / 资产双页签）——FE-03 编辑器壳把它挂在编辑器路由左栏。
 *
 * 为什么合成一个组件：Figma 的左面板就是「文件（图层）」与「资产」两个页签共享一栏；
 * 面板各自独立（`LayersPanel` / `AssetsPanel`）仍可单独挂载，
 * 组合后的整栏带 `data-df-panel-group` 供面板级截图门禁取样（保留完整面板边界 + spec 规定的固定外扩边距）。
 * 样式单轨（工单 06）：整栏/页签条样式走 editor-panels.css 类（.dfg-panels__group / __tab-strip）。
 *
 * 扩展页签（票 16）：`left-panel-tabs` 槽注册的页签族扩展（如「市场」）追加在内置页签之后，
 * 页签选中时才渲染其面板体；打开态不改写 `leftTab`（见 panels-store 的 leftExtensionTab），
 * 「关闭」回打开前的原页签。扩展页签被注销（热重载）时渲染回退到内置页签，不残留面板体。
 */
import { SegmentedControl } from '@dforge/ui';

import { useEditorSlotItems } from '@/features/editor-shell';
import { t } from '@/i18n';
import { usePanelsUi } from '../state/hooks';
import type { LeftPanelTab } from '../state/panels-store';
import { AssetsPanel, type AssetsPanelProps } from './AssetsPanel';
import { LayersPanel, type LayersPanelProps } from './LayersPanel';
import { usePanelsSession } from './panels-context';

import '../editor-panels.css';

/** 内置页签 id（页签切换时区分「切内置」与「开扩展」）。 */
const BUILTIN_TAB_IDS: readonly LeftPanelTab[] = ['layers', 'assets'];

/** 左栏组合 props：与两个面板共用同一份数据态（loading/error/retry）。 */
export interface EditorPanelsProps extends LayersPanelProps, AssetsPanelProps {}

/** 编辑器左栏（图层 / 资产 + 槽位注册的扩展页签族）。 */
export function EditorPanels({ loading, error, onRetry, className }: EditorPanelsProps) {
  const session = usePanelsSession();
  const leftTab = usePanelsUi(session, (state) => state.leftTab);
  const leftExtensionTab = usePanelsUi(session, (state) => state.leftExtensionTab);
  const extensionItems = useEditorSlotItems('left-panel-tabs');
  // 打开的扩展页签若已注销（热重载），渲染回退到内置页签（状态不动，注册回来即恢复）
  const activeExtension = extensionItems.find((item) => item.id === leftExtensionTab) ?? null;
  const activeValue = activeExtension === null ? leftTab : activeExtension.id;

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
          value={activeValue}
          options={[
            { value: 'layers', label: t('panels.layers.title') },
            { value: 'assets', label: t('panels.assets.title') },
            ...extensionItems.map((item) => ({
              value: item.id,
              label: item.label?.() ?? item.id,
            })),
          ]}
          onChange={(value) => {
            const ui = session.ui.getState();
            if ((BUILTIN_TAB_IDS as readonly string[]).includes(value)) {
              // 切内置页签 = 同时关闭扩展页签（打开态不改写 leftTab，这里显式落位）
              ui.setLeftTab(value as LeftPanelTab);
              ui.closeLeftExtensionTab();
            } else {
              ui.openLeftExtensionTab(value);
            }
          }}
        />
        {activeExtension === null ? null : (
          <button
            type="button"
            className="dfg-panels__tab-close"
            data-df-panel-action="close-extension"
            onClick={() => {
              session.ui.getState().closeLeftExtensionTab();
            }}
          >
            {t('panels.extension.close')}
          </button>
        )}
      </div>
      {activeExtension !== null ? (
        <div className="dfg-panels__extension-body" data-df-panel-extension={activeExtension.id}>
          {activeExtension.render()}
        </div>
      ) : leftTab === 'assets' ? (
        <AssetsPanel {...shared} hideHeader />
      ) : (
        <LayersPanel {...shared} hideHeader />
      )}
    </div>
  );
}
