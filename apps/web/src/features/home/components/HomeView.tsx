'use client';

/**
 * 首页编排（FE-02 · B1「最近」主结构）。
 *
 * 布局：侧栏 240（B2）+ 主区（顶栏 56（B1/B5/B9/B10）+ AI 提示区 + 筛选行 40（B4）+
 * 文件区（4 列网格 B3/B8/B7 或列表））。
 *
 * 状态归属（_shared §3）：界面态在 `home-store`（Zustand），文档真值来自 daemon
 * ——本组件只做编排：拉取 / 过滤 / 串动作，不把文档塞进全局 store。
 *
 * 所有副作用入口都可由外部注入（文档接口 / 市场检索 / 时钟 / store / 导航），
 * 这样页面级行为可以在 jsdom 里完整走通（见 `HomeView.test.tsx`）；数据侧缺省实现
 * 走 daemon 基址解析 + fetch，只在真实浏览器里跑。
 *
 * 导航**不在本组件里取 `useRouter`**：路由上下文属页面（app/page.tsx）——
 * 组件只收 `onOpenDocument` / `onOpenMarket` 两个回调，因此也能在非 Next 容器
 * （如桌面壳的内嵌视图）里复用，测试也不需要 mock Next 运行时。
 */
import type { DocumentListWarning, DocumentSummary } from '@dforge/contracts';
import { useToast } from '@dforge/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type StoreApi, type UseBoundStore, useStore } from 'zustand';

import { t } from '@/i18n';
import { resolveDaemonBaseUrl } from '../api/daemon-url';
import {
  createDocumentsGateway,
  DocumentApiError,
  type DocumentsGateway,
  describeApiErrorCode,
} from '../api/documents';
import { type MarketSearchResult, searchMarketAssets } from '../api/market';
import { cx } from '../lib/cx';
import { resolveEmptyKind } from '../lib/empty-kind';
import { selectDocumentList } from '../lib/filter';
import { createHomeStore, type HomeState } from '../state/home-store';
import { AiHintBar } from './AiHintBar';
import { CreateDocumentDialog } from './CreateDocumentDialog';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';
import { DocumentGrid } from './DocumentGrid';
import { FilterRow } from './FilterRow';
import { HomeSidebar } from './HomeSidebar';
import { HomeEmptyState, HomeErrorState, HomeListSkeleton, HomeWarnings } from './HomeStateViews';
import { HomeTopbar, type MarketPanelState } from './HomeTopbar';
import { TrashList } from './TrashList';

/** 首页 store 类型（工厂返回的 hook 也是 store API）。 */
export type HomeStore = UseBoundStore<StoreApi<HomeState>>;

/** 默认市场检索（走 daemon；基址与文档接口同源解析）。 */
async function defaultSearchMarket(query: string): Promise<MarketSearchResult> {
  const baseUrl = await resolveDaemonBaseUrl();
  return searchMarketAssets({ baseUrl, query });
}

/** 市场检索兜底上限默认值（毫秒）。 */
export const MARKET_SEARCH_DEADLINE_MS = 3000;

/** 首页编排 props（全部可选：缺省即真实浏览器路径）。 */
export interface HomeViewProps {
  /** 文档数据源（测试注入替身）。 */
  documents?: DocumentsGateway;
  /** 市场检索（测试注入替身）。 */
  searchMarket?: (query: string) => Promise<MarketSearchResult>;
  /** 时钟注入（相对时间基准）。 */
  now?: () => Date;
  /** 打开文档（页面注入：跳编辑器地址）。 */
  onOpenDocument: (document: DocumentSummary) => void;
  /** 打开市场资产（页面注入：跳市场详情）。 */
  onOpenMarket: (assetId: string) => void;
  /** store 注入（测试独立实例）。 */
  store?: HomeStore;
  /** 市场检索防抖（毫秒；测试传 0）。 */
  searchDebounceMs?: number;
  /**
   * 市场检索兜底上限（毫秒）：超过仍无结果先落「市场不可用」降级态（可读出口），
   * 结果迟到再覆盖。缺省 {@link MARKET_SEARCH_DEADLINE_MS}——压在 daemon 端口段
   * 健康探测最坏耗时（~2.4s，见 `home/api/daemon-url`）之上，避免误报；测试传小值。
   */
  marketSearchDeadlineMs?: number;
}

/** 加载态。 */
type LoadStatus = 'loading' | 'ready' | 'error';

/** 下拉里的本地命中条数上限（结果线只做入口，给多了喧宾夺主）。 */
const DOCUMENT_HIT_LIMIT = 5;

/** 首页主视图。 */
export function HomeView({
  documents: injectedDocuments,
  searchMarket,
  now = () => new Date(),
  onOpenDocument,
  onOpenMarket,
  store,
  searchDebounceMs = 200,
  marketSearchDeadlineMs = MARKET_SEARCH_DEADLINE_MS,
}: HomeViewProps) {
  const toast = useToast();
  const activeStore = store ?? useHomeStoreSingleton();
  const home = useStore(activeStore, (state) => state);

  const [docs, setDocs] = useState<DocumentSummary[]>([]);
  const [warnings, setWarnings] = useState<DocumentListWarning[]>([]);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [errorCode, setErrorCode] = useState<string | undefined>(undefined);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [retrying, setRetrying] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<DocumentSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [market, setMarket] = useState<MarketPanelState>({
    loading: false,
    available: true,
    items: [],
  });

  const gatewayRef = useRef<DocumentsGateway | null>(injectedDocuments ?? null);
  /**
   * 创建在飞守卫（同步 ref）。
   *
   * 为什么不能只看 `creating` 状态：状态更新要等重渲染才生效，同一帧内连按两次回车
   * （或双击）时第二次提交读到的仍是旧值 → 会发出两次创建请求（对抗测试实测读数 2）。
   * ref 在调用栈内立即生效，与渲染时机无关。
   */
  const creatingRef = useRef(false);

  /** 取文档接口（缺省按 daemon 基址解析创建，只解析一次）。 */
  const ensureGateway = useCallback(async (): Promise<DocumentsGateway> => {
    if (gatewayRef.current !== null) return gatewayRef.current;
    const baseUrl = await resolveDaemonBaseUrl();
    const gateway = createDocumentsGateway({ baseUrl });
    gatewayRef.current = gateway;
    return gateway;
  }, []);

  /** 拉列表；mode 决定是否切到加载态（刷新不闪骨架）。 */
  const load = useCallback(
    async (mode: 'initial' | 'retry' | 'refresh'): Promise<void> => {
      if (mode === 'initial') setStatus('loading');
      if (mode === 'retry') setRetrying(true);
      try {
        const gateway = await ensureGateway();
        const result = await gateway.list();
        setDocs(result.documents);
        setWarnings(result.warnings);
        setErrorCode(undefined);
        setErrorMessage(undefined);
        setStatus('ready');
      } catch (cause) {
        const apiError =
          cause instanceof DocumentApiError
            ? cause
            : new DocumentApiError('daemon_unreachable', '本地服务不可达。');
        setErrorCode(describeApiErrorCode(apiError.code));
        setErrorMessage(apiError.message);
        setStatus('error');
      } finally {
        setRetrying(false);
      }
    },
    [ensureGateway],
  );

  useEffect(() => {
    void load('initial');
  }, [load]);

  // 市场结果线：输入搜索词后（防抖）查 daemon；清空即复位。
  // 出口保证（三条，不允许永久 loading）：① 落定即用真实结果；② 被拒 → 落「市场不可用」降级态
  // （拒绝不逃逸成 unhandled rejection）；③ 超上限仍未落定 → 先落降级态给可读出口，
  // 结果迟到再覆盖（自愈）。
  useEffect(() => {
    const query = home.query.trim();
    if (query === '') {
      setMarket({ loading: false, available: true, items: [] });
      return undefined;
    }
    let cancelled = false;
    let deadline: ReturnType<typeof setTimeout> | null = null;
    setMarket((current) => ({ ...current, loading: true }));
    const timer = setTimeout(() => {
      deadline = setTimeout(() => {
        if (!cancelled) setMarket({ loading: false, available: false, items: [] });
      }, marketSearchDeadlineMs);
      // `Promise.resolve().then(…)`：连「同步抛错」的实现也归一到拒绝路径，异常不逃出定时器回调
      void Promise.resolve()
        .then(() => (searchMarket ?? defaultSearchMarket)(query))
        .then(
          (result) => {
            if (deadline !== null) clearTimeout(deadline);
            if (cancelled) return;
            setMarket({ loading: false, available: result.available, items: result.items });
          },
          () => {
            if (deadline !== null) clearTimeout(deadline);
            if (cancelled) return;
            setMarket({ loading: false, available: false, items: [] });
          },
        );
    }, searchDebounceMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (deadline !== null) clearTimeout(deadline);
    };
  }, [home.query, searchMarket, searchDebounceMs, marketSearchDeadlineMs]);

  const filtered = home.query.trim() !== '' || home.range !== 'all';
  // 时间基准在每次重算时取一次（`now` 为注入的稳定时钟；不把它当渲染依赖，避免每帧新建 Date）
  const visible = useMemo(
    () => selectDocumentList(docs, { query: home.query, range: home.range, now: now() }, home.sort),
    [docs, home.query, home.range, home.sort, now],
  );
  const documentHits = useMemo(
    () =>
      selectDocumentList(
        docs,
        { query: home.query, range: 'all', now: now() },
        'updated-desc',
      ).slice(0, DOCUMENT_HIT_LIMIT),
    [docs, home.query, now],
  );

  const emptyKind = resolveEmptyKind({
    inTrash: home.section === 'trash',
    totalDocuments: docs.length,
    visibleCount: visible.length,
    filtered,
  });
  const sectionTitle =
    home.section === 'trash'
      ? t('home.section.trash.title')
      : home.section === 'local'
        ? t('home.section.local.title')
        : t('home.section.recent.title');
  const sectionDesc = home.section === 'trash' ? t('home.section.trash.desc') : null;

  /** 两步删除的第二步：真删（成功后记一条删除记录并刷新列表）。 */
  const confirmDelete = useCallback(async (): Promise<void> => {
    const target = pendingDelete;
    if (target === null) return;
    setDeleting(true);
    try {
      const gateway = await ensureGateway();
      await gateway.remove(target.id);
      activeStore.getState().recordDeletion({
        id: target.id,
        name: target.name,
        deletedAt: new Date().toISOString(),
      });
      setPendingDelete(null);
      toast.show({ message: t('home.delete.success', { name: target.name }), tone: 'success' });
      await load('refresh');
    } catch (cause) {
      const message = cause instanceof DocumentApiError ? cause.message : String(cause);
      toast.show({ message: t('home.delete.failed', { message }), tone: 'error' });
    } finally {
      setDeleting(false);
    }
  }, [activeStore, ensureGateway, load, pendingDelete, toast]);

  /** 新建：先落盘再回列表（新卡片出现 + Toast 提示）。 */
  const submitCreate = useCallback(
    async (name: string): Promise<void> => {
      if (creatingRef.current) return; // 在飞守卫：同帧二次提交不是新动作，直接丢弃
      creatingRef.current = true;
      setCreating(true);
      try {
        const gateway = await ensureGateway();
        await gateway.create(name);
        setCreateOpen(false);
        toast.show({ message: t('home.new.success', { name }), tone: 'success' });
        await load('refresh');
      } catch (cause) {
        const message = cause instanceof DocumentApiError ? cause.message : String(cause);
        toast.show({ message: t('home.new.failed', { message }), tone: 'error' });
      } finally {
        creatingRef.current = false;
        setCreating(false);
      }
    },
    [ensureGateway, load, toast],
  );

  const clearFilters = useCallback((): void => {
    activeStore.getState().setQuery('');
    activeStore.getState().setRange('all');
  }, [activeStore]);

  return (
    <div className={cx('dfg-home', home.sidebarCollapsed && 'dfg-home--collapsed')}>
      <HomeSidebar
        section={home.section}
        onSelect={(section) => activeStore.getState().setSection(section)}
        collapsed={home.sidebarCollapsed}
        onToggleCollapse={() => activeStore.getState().toggleSidebar()}
        trashCount={home.trashRecords.length}
      />

      <div className="dfg-home__main">
        <HomeTopbar
          query={home.query}
          onQueryChange={(query) => activeStore.getState().setQuery(query)}
          documentHits={documentHits}
          onOpenDocument={onOpenDocument}
          market={{ loading: market.loading, available: market.available, items: market.items }}
          onOpenMarket={onOpenMarket}
          onCreateDesignFile={() => setCreateOpen(true)}
        />

        <div className="dfg-home__content">
          <AiHintBar onOpenAi={() => toast.show({ message: t('home.ai.stub'), tone: 'info' })} />

          <div className="dfg-home__sectionhead">
            <h1 className="dfg-home__sectiontitle">{sectionTitle}</h1>
            {sectionDesc === null ? null : <p className="dfg-home__sectiondesc">{sectionDesc}</p>}
          </div>

          {home.section === 'trash' ? (
            home.trashRecords.length === 0 ? (
              <HomeEmptyState
                kind="trash"
                onExitTrash={() => activeStore.getState().setSection('local')}
              />
            ) : (
              <TrashList
                records={home.trashRecords}
                now={now}
                onPurge={(id) => activeStore.getState().purgeTrashRecord(id)}
              />
            )
          ) : (
            <>
              <FilterRow
                range={home.range}
                onRangeChange={(range) => activeStore.getState().setRange(range)}
                sort={home.sort}
                onSortChange={(sort) => activeStore.getState().setSort(sort)}
                viewMode={home.viewMode}
                onViewModeChange={(viewMode) => activeStore.getState().setViewMode(viewMode)}
                resultCount={visible.length}
              />
              <HomeWarnings warnings={warnings} />

              {status === 'loading' ? (
                <HomeListSkeleton />
              ) : status === 'error' ? (
                <HomeErrorState
                  {...(errorCode === undefined ? {} : { code: errorCode })}
                  {...(errorMessage === undefined ? {} : { description: errorMessage })}
                  retrying={retrying}
                  onRetry={() => void load('retry')}
                />
              ) : visible.length === 0 ? (
                <HomeEmptyState
                  kind={emptyKind}
                  onCreate={() => setCreateOpen(true)}
                  onClearFilters={clearFilters}
                />
              ) : (
                <DocumentGrid
                  viewMode={home.viewMode}
                  documents={visible}
                  now={now}
                  onOpen={onOpenDocument}
                  onRequestDelete={setPendingDelete}
                />
              )}
            </>
          )}
        </div>
      </div>

      <DeleteConfirmDialog
        open={pendingDelete !== null}
        documentName={pendingDelete?.name ?? ''}
        pending={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />
      <CreateDocumentDialog
        open={createOpen}
        pending={creating}
        onCancel={() => setCreateOpen(false)}
        onSubmit={(name) => void submitCreate(name)}
      />
    </div>
  );
}

/**
 * 缺省 store 单例（页面用）。
 *
 * 为什么放在这里而不是模块顶层调用 `createHomeStore()`：`HomeView` 也可能被服务端
 * 预渲染，模块顶层创建会在 SSR 进程里也建一份；用惰性 getter 把创建推迟到首次渲染，
 * 且 SSR 下 localStorage 缺失时 store 自行降级为不持久化。
 */
let singleton: HomeStore | null = null;
function useHomeStoreSingleton(): HomeStore {
  if (singleton === null) singleton = createHomeStore();
  return singleton;
}
