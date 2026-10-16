'use client';

/**
 * 未知路由 404（UX-14 · 工作包 G1）。
 *
 * 为什么自己写一页：Next 缺省 404 是英文页（「This page could not be found.」），
 * 直接违背全中文基线（ADR-0003）；这里给品牌化中文页 + 「返回首页」出口。
 * 出口地址经 `useDaemonEndpointHref`（B 包单点）续写当前 daemon 端点参数——
 * 网关/非默认端口形态下回首页后功能不丢参。
 */
import { Button, EmptyState } from '@dforge/ui';
import Link from 'next/link';

import { t } from '@/i18n';
import { useDaemonEndpointHref } from '@/lib/daemon-href';

/** 404 页。 */
export default function NotFound() {
  const homeHref = useDaemonEndpointHref('/');
  return (
    <main className="dfg-notfound" data-df-state="not-found">
      <p className="dfg-notfound__badge" aria-hidden="true">
        {t('notFound.badge')}
      </p>
      <EmptyState
        title={t('notFound.title')}
        description={t('notFound.desc')}
        action={
          <Link href={homeHref}>
            <Button variant="primary">{t('notFound.home')}</Button>
          </Link>
        }
      />
    </main>
  );
}
