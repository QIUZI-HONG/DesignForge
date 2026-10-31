'use client';

/**
 * 资产面板（C4：组件 / Token 分段 + 搜索）。
 *
 * 数据来源都是引擎的只读查询：组件走 `listComponents`（含实例数），
 * 令牌走 `resolveAllTokens`（别名已求值）+ `groupTokenPaths`（点分路径分组）。
 * 组件卡点击 = 设置选择（与画布同源）；组件语义色用**组件紫** `--dfg-color-component`。
 *
 * 状态覆盖（验收标准 §5）：loading（骨架卡）/ empty（无组件、无令牌）/ no-results（搜索无果）/
 * error（加载失败 + 重试）/ hover（卡片悬停）/ active（选中组件）各有挂点属性供截图门禁取样。
 */
import {
  findPage,
  flattenTokens,
  groupTokenPaths,
  listComponents,
  resolveAllTokens,
  TOKEN_NAME_MAX_LENGTH,
  type TokenNameProblemCode,
  type TokenType,
  validateTokenName,
} from '@dforge/engine';
import {
  Button,
  CheckIcon,
  CloseIcon,
  ComponentIcon,
  EmptyState,
  ErrorState,
  Input,
  PencilIcon,
  PlusIcon,
  SegmentedControl,
  Skeleton,
  TrashIcon,
} from '@dforge/ui';
import { type ChangeEvent, type FormEvent, useMemo, useState } from 'react';

import { t } from '@/i18n';
import {
  addTokenCommands,
  deleteTokenCommands,
  updateTokenValueCommands,
} from '../commands/token-commands';
import { usePanelsDocument, usePanelsUi } from '../state/hooks';
import { usePanelsSession } from './panels-context';

import '../editor-panels.css';

/**
 * i18n 纪律（P2-6 口径统一，与 AiDrawer 同一条规则，真源 `src/i18n/catalog-coverage.test.ts`
 * 文件头）：**静态键**（单引号字面量取词）由 catalog-coverage 守卫（目录缺词条即红）；
 * **动态键**（模板串拼前缀）无法静态枚举，由各功能域用例钉住全部取值（AiDrawer 步骤/降级族
 * 见 `src/i18n/index.test.ts` 的 P2-6 段与 AiDrawer.test.tsx 的 it.each）。本面板的
 * TOKEN_TYPE_LABEL_KEYS / addProblemMessage 用显式罗列满足「可检索」——同一纪律的静态
 * 写法，不是对动态键的额外禁令。（注记里不写取词调用的字面形态：catalog-coverage
 * 扫源码正则会把注释里的示例当真引用。）
 */

/** 新建令牌可选的类型（DTCG `$type` 全集，与引擎 `TokenType` 同一清单）。 */
const TOKEN_TYPES: readonly TokenType[] = [
  'color',
  'dimension',
  'fontFamily',
  'fontWeight',
  'number',
  'string',
  'shadow',
  'typography',
];

/** 类型 → i18n 键（显式罗列：可检索、漏译即裸键可见——口径见文件头「i18n 纪律」）。 */
const TOKEN_TYPE_LABEL_KEYS: Record<TokenType, string> = {
  color: 'panels.assets.tokenAdd.type.color',
  dimension: 'panels.assets.tokenAdd.type.dimension',
  fontFamily: 'panels.assets.tokenAdd.type.fontFamily',
  fontWeight: 'panels.assets.tokenAdd.type.fontWeight',
  number: 'panels.assets.tokenAdd.type.number',
  string: 'panels.assets.tokenAdd.type.string',
  shadow: 'panels.assets.tokenAdd.type.shadow',
  typography: 'panels.assets.tokenAdd.type.typography',
};

/** 资产面板 props（loading/error 状态挂点由壳层喂）。 */
export interface AssetsPanelProps {
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** 与左栏页签组合时隐藏自带标题（页签即标题）。 */
  hideHeader?: boolean;
  className?: string;
}

/** 资产面板。 */
export function AssetsPanel({
  loading = false,
  error = null,
  onRetry,
  hideHeader = false,
  className,
}: AssetsPanelProps) {
  const session = usePanelsSession();
  const doc = usePanelsDocument(session);
  const segment = usePanelsUi(session, (state) => state.assetSegment);
  const query = usePanelsUi(session, (state) => state.assetQuery);
  const selection = usePanelsUi(session, (state) => state.selection);

  const page = findPage(doc, session.pageId);
  const components = useMemo(() => (page === undefined ? [] : listComponents(page)), [page]);
  const tokenSet = useMemo(() => resolveAllTokens(doc.tokens), [doc.tokens]);

  // 令牌添加表单（票 14）：UI 态留在组件内，文档真值只经命令栈写入
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState('');
  const [addValue, setAddValue] = useState('');
  const [addType, setAddType] = useState<TokenType>('color');
  const [addProblem, setAddProblem] = useState<TokenNameProblemCode | null>(null);

  // 令牌行内管理（票 14 管理半缺）：改值单行编辑态 + 删除（都走命令栈单事务，可撤销）
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editEmpty, setEditEmpty] = useState(false);

  const openAddForm = (): void => {
    setAddName('');
    setAddValue('');
    setAddType('color');
    setAddProblem(null);
    setAddOpen(true);
  };

  const closeAddForm = (): void => {
    setAddOpen(false);
    setAddName('');
    setAddValue('');
    setAddType('color');
    setAddProblem(null);
  };

  /** 名称变更即清错误分因（提示对应的是提交时的名字，不追着旧错打新输入）。 */
  const onAddNameChange = (event: ChangeEvent<HTMLInputElement>): void => {
    setAddName(event.currentTarget.value);
    if (addProblem !== null) setAddProblem(null);
  };

  /** 提交：先校验分因（不写文档），合法才构造命令交给命令栈（一条事务，可撤销）。 */
  const onAddSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const problemCode = validateTokenName(doc.tokens, addName);
    if (problemCode !== null) {
      setAddProblem(problemCode);
      return;
    }
    session.run(
      addTokenCommands(doc.tokens, { name: addName, value: addValue, $type: addType }),
      t('panels.history.tokenAdd'),
    );
    closeAddForm();
  };

  /** 错误分因 → i18n 文案（switch 显式罗列：键可检索、漏译即裸键可见——口径同上）。 */
  const addProblemMessage = (code: TokenNameProblemCode): string => {
    switch (code) {
      case 'empty':
        return t('panels.assets.tokenAdd.error.empty');
      case 'too-long':
        return t('panels.assets.tokenAdd.error.tooLong', { count: TOKEN_NAME_MAX_LENGTH });
      case 'illegal-char':
        return t('panels.assets.tokenAdd.error.illegalChar');
      case 'duplicate':
        return t('panels.assets.tokenAdd.error.duplicate');
    }
  };

  /** 进入单行改值态：预填文档里的**原始** `$value`（别名串原样可改，求值交给解析层）。 */
  const startEditValue = (path: string): void => {
    const raw = flattenTokens(doc.tokens)[path];
    setEditingPath(path);
    // $value 是 TokenValue 联合（别名串/数字/布尔…），编辑框统一按字符串呈现
    setEditValue(raw === undefined ? '' : String(raw.$value));
    setEditEmpty(false);
  };

  const cancelEditValue = (): void => {
    setEditingPath(null);
    setEditValue('');
    setEditEmpty(false);
  };

  /** 提交改值：只改 `$value`（`$type` 沿用既有）；空值不写文档，行内提示。 */
  const onEditSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (editingPath === null) return;
    if (editValue.trim().length === 0) {
      setEditEmpty(true);
      return;
    }
    session.run(
      updateTokenValueCommands(doc.tokens, editingPath, editValue),
      t('panels.history.tokenUpdate'),
    );
    cancelEditValue();
  };

  /** 删除令牌：命令栈单事务（撤销即恢复）；若正编辑该行则先退出编辑态。 */
  const onDeleteToken = (path: string): void => {
    session.run(deleteTokenCommands(doc.tokens, path), t('panels.history.tokenDelete'));
    if (editingPath === path) cancelEditValue();
  };

  const normalized = query.trim().toLowerCase();
  const matches = (text: string): boolean =>
    normalized.length === 0 || text.toLowerCase().includes(normalized);

  const visibleComponents = components.filter((entry) => matches(entry.name));
  const tokenPaths = Object.keys(tokenSet.resolved).sort();
  const visibleTokenPaths = tokenPaths.filter((path) => matches(path));
  const tokenGroups = groupTokenPaths(visibleTokenPaths);

  const componentsEmpty = components.length === 0;

  return (
    <section
      aria-label={t('panels.assets.title')}
      aria-busy={loading}
      data-df-panel="assets"
      data-df-segment={segment}
      className={className === undefined ? 'dfg-panels__panel' : `${className} dfg-panels__panel`}
    >
      {hideHeader ? null : (
        <header className="dfg-panels__header">
          <span className="dfg-panels__header-title">{t('panels.assets.title')}</span>
          <span className="dfg-panels__header-spacer" />
        </header>
      )}

      <div className="dfg-panels__asset-toolbar">
        <SegmentedControl
          label={t('panels.assets.segment.label')}
          size="sm"
          value={segment}
          options={[
            { value: 'components', label: t('panels.assets.segment.components') },
            { value: 'tokens', label: t('panels.assets.segment.tokens') },
          ]}
          onChange={(value) => {
            session.ui.getState().setAssetSegment(value === 'tokens' ? 'tokens' : 'components');
          }}
        />
        <Input
          kind="search"
          size="sm"
          placeholder={t('panels.assets.search.placeholder')}
          value={query}
          onChange={(event) => {
            session.ui.getState().setAssetQuery(event.currentTarget.value);
          }}
        />
      </div>

      {segment === 'tokens' && !loading && error === null ? (
        addOpen ? (
          <form
            className="dfg-panels__token-add"
            data-df-asset-token-add-form="open"
            onSubmit={onAddSubmit}
          >
            <Input
              size="sm"
              fieldLabel={t('panels.assets.tokenAdd.name')}
              placeholder={t('panels.assets.tokenAdd.namePlaceholder')}
              value={addName}
              invalid={addProblem !== null}
              onChange={onAddNameChange}
            />
            {addProblem === null ? null : (
              <p
                className="dfg-panels__token-add-error"
                role="alert"
                data-df-asset-token-add-error={addProblem}
              >
                {addProblemMessage(addProblem)}
              </p>
            )}
            <div className="dfg-panels__token-add-row">
              <label className="dfg-panels__token-add-field">
                <span className="dfg-panels__token-add-label">
                  {t('panels.assets.tokenAdd.type')}
                </span>
                <select
                  className="dfg-panels__token-add-select"
                  aria-label={t('panels.assets.tokenAdd.type')}
                  value={addType}
                  onChange={(event) => {
                    setAddType(event.currentTarget.value as TokenType);
                  }}
                >
                  {TOKEN_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {t(TOKEN_TYPE_LABEL_KEYS[type])}
                    </option>
                  ))}
                </select>
              </label>
              <Input
                size="sm"
                fieldLabel={t('panels.assets.tokenAdd.value')}
                placeholder={t('panels.assets.tokenAdd.valuePlaceholder')}
                value={addValue}
                onChange={(event) => {
                  setAddValue(event.currentTarget.value);
                }}
              />
            </div>
            <div className="dfg-panels__token-add-actions">
              <Button type="submit" size="sm" variant="primary">
                {t('panels.assets.tokenAdd.submit')}
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={closeAddForm}>
                {t('panels.assets.tokenAdd.cancel')}
              </Button>
            </div>
          </form>
        ) : (
          <div className="dfg-panels__token-add-entry">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              fullWidth
              icon={<PlusIcon />}
              data-df-asset-panel-token-add="open"
              onClick={openAddForm}
            >
              {t('panels.assets.tokenAdd.open')}
            </Button>
          </div>
        )
      ) : null}

      {error !== null ? (
        <div data-df-sample="assets/error" className="dfg-panels__body">
          <ErrorState
            title={t('panels.assets.error.title')}
            description={t('panels.assets.error.desc')}
            {...(onRetry === undefined ? {} : { onRetry })}
            retryLabel={t('panels.assets.retry')}
          />
        </div>
      ) : loading ? (
        <div data-df-sample="assets/loading" className="dfg-panels__body">
          <span className="dfg-visually-hidden" role="status">
            {t('panels.assets.loading')}
          </span>
          <div className="dfg-panels__asset-grid">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={`card-${String(index)}`} height="var(--dfg-size-drawer-sm)" />
            ))}
          </div>
        </div>
      ) : segment === 'components' ? (
        <div
          data-df-sample={componentsEmpty ? 'assets/empty' : 'assets/components'}
          className="dfg-panels__body"
        >
          {componentsEmpty ? (
            <EmptyState
              title={t('panels.assets.components.empty.title')}
              description={t('panels.assets.components.empty.desc')}
            />
          ) : visibleComponents.length === 0 ? (
            <div data-df-sample="assets/no-results">
              <EmptyState
                title={t('panels.assets.noResults.title')}
                description={t('panels.assets.noResults.desc')}
              />
            </div>
          ) : (
            <div className="dfg-panels__asset-grid">
              {visibleComponents.map((entry) => {
                const selected = selection.ids.includes(entry.id);
                return (
                  <button
                    key={entry.id}
                    type="button"
                    aria-pressed={selected}
                    aria-label={entry.name}
                    data-df-asset-component={entry.id}
                    data-df-state={selected ? 'selected' : 'default'}
                    className="dfg-panels__asset-card"
                    onClick={() => {
                      session.ui.getState().selectLayer(entry.id);
                    }}
                  >
                    <span aria-hidden className="dfg-panels__asset-thumb">
                      <ComponentIcon size={24} />
                    </span>
                    <span className="dfg-panels__asset-card-name">{entry.name}</span>
                    <span className="dfg-panels__asset-card-meta">
                      {t('panels.assets.component.instances', { count: entry.instanceCount })}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : tokenPaths.length === 0 ? (
        <div data-df-sample="assets/tokens-empty" className="dfg-panels__body">
          <EmptyState
            title={t('panels.assets.tokens.empty.title')}
            description={t('panels.assets.tokens.empty.desc')}
          />
        </div>
      ) : visibleTokenPaths.length === 0 ? (
        <div data-df-sample="assets/no-results" className="dfg-panels__body">
          <EmptyState
            title={t('panels.assets.noResults.title')}
            description={t('panels.assets.noResults.desc')}
          />
        </div>
      ) : (
        <div data-df-sample="assets/tokens" className="dfg-panels__body">
          {Object.entries(tokenGroups).map(([group, paths]) => (
            <div key={group}>
              <div className="dfg-panels__token-group">{group}</div>
              {paths.map((path) => {
                const token = tokenSet.resolved[path];
                const value = token === undefined ? '' : String(token.value);
                const isColor = token !== undefined && token.type === 'color';
                const editing = editingPath === path;
                return (
                  <div key={path} data-df-asset-token={path} className="dfg-panels__token-row">
                    <span
                      aria-hidden
                      title={isColor ? t('panels.assets.token.color') : undefined}
                      data-df-token-swatch={isColor ? 'color' : 'plain'}
                      className="dfg-panels__token-swatch"
                      // 颜色令牌的色块取文档里的解析值（文档数据，动态值豁免——工单 06 登记表）
                      style={isColor ? { background: value } : undefined}
                    />
                    {editing ? (
                      <form
                        className="dfg-panels__token-edit"
                        data-df-asset-token-edit-form={path}
                        onSubmit={onEditSubmit}
                      >
                        <Input
                          size="sm"
                          aria-label={t('panels.assets.tokenEdit.value')}
                          placeholder={t('panels.assets.tokenAdd.valuePlaceholder')}
                          value={editValue}
                          invalid={editEmpty}
                          onChange={(event) => {
                            setEditValue(event.currentTarget.value);
                            if (editEmpty) setEditEmpty(false);
                          }}
                        />
                        <button
                          type="submit"
                          className="dfg-panels__token-icon-btn"
                          aria-label={t('panels.assets.tokenEdit.submit')}
                          data-df-asset-token-edit-submit=""
                        >
                          <CheckIcon size={14} />
                        </button>
                        <button
                          type="button"
                          className="dfg-panels__token-icon-btn"
                          aria-label={t('panels.assets.tokenAdd.cancel')}
                          onClick={cancelEditValue}
                        >
                          <CloseIcon size={14} />
                        </button>
                      </form>
                    ) : (
                      <>
                        <span className="dfg-panels__token-name">{path}</span>
                        <span className="dfg-panels__token-value">{value}</span>
                        <span className="dfg-panels__token-actions">
                          <button
                            type="button"
                            className="dfg-panels__token-icon-btn"
                            aria-label={t('panels.assets.tokenRow.edit')}
                            data-df-asset-token-edit={path}
                            onClick={() => {
                              startEditValue(path);
                            }}
                          >
                            <PencilIcon size={14} />
                          </button>
                          <button
                            type="button"
                            className="dfg-panels__token-icon-btn"
                            aria-label={t('panels.assets.tokenRow.delete')}
                            data-df-asset-token-delete={path}
                            onClick={() => {
                              onDeleteToken(path);
                            }}
                          >
                            <TrashIcon size={14} />
                          </button>
                        </span>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
