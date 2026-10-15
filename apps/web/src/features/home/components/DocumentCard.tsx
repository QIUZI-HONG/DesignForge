'use client';

import type { DocumentSummary } from '@dforge/contracts';
/**
 * 文件卡片（FE-02 · B3）。
 *
 * 结构（对标浅色基准）：圆角 8 的卡片 + 缩略图区（内圆角 6）+ 名称（13）+ 元信息（11）；
 * 悬停/键盘聚焦时右上角浮出「…」菜单（CSS 控制浮现，键盘可达性由 `:focus-within` 兜住）。
 *
 * 语义拆分：可点击区域是 `<a href>`（缩放预览占位 + 名称 + 元信息），菜单按钮是**兄弟节点**
 * ——避免按钮嵌在链接里的非法结构；点击链接默认交父级做客户端跳转（不 preventDefault 的
 * 情形：带修饰键/中键，让浏览器新开标签的默认行为照常）。
 */
import { DropdownMenu, FrameIcon, IconButton, MoreHorizontalIcon } from '@dforge/ui';
import type { MouseEvent } from 'react';

import { t } from '@/i18n';

import { describeRelativeTime } from '../lib/format';
import { editorHref } from '../lib/routes';

/** 卡片 props。 */
export interface DocumentCardProps {
  document: DocumentSummary;
  /** 时钟（相对时间基准；注入保证测试确定性）。 */
  now: () => Date;
  onOpen: (document: DocumentSummary) => void;
  /** 请求删除：只上报意图，真正的删除走两步确认（B12）。 */
  onRequestDelete: (document: DocumentSummary) => void;
}

/** 相对时间文案（ICU 出词，数值来自 lib/format）。 */
function relativeTimeText(iso: string, now: Date): string {
  const relative = describeRelativeTime(iso, now);
  switch (relative.unit) {
    case 'now':
      return t('home.time.now');
    case 'minute':
      return t('home.time.minutes', { count: relative.value });
    case 'hour':
      return t('home.time.hours', { count: relative.value });
    case 'day':
      return t('home.time.days', { count: relative.value });
    case 'date':
      return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(relative.value);
  }
}

/** 卡片。 */
export function DocumentCard({ document, now, onOpen, onRequestDelete }: DocumentCardProps) {
  const openLabel = t('home.card.open', { name: document.name });
  const meta = t('home.card.meta', {
    pages: document.pageCount,
    time: relativeTimeText(document.updatedAt, now()),
  });

  const handleOpen = (event: MouseEvent<HTMLAnchorElement>): void => {
    // 修饰键/中键：交给浏览器默认行为（新标签打开），不抢
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    onOpen(document);
  };

  return (
    <li className="dfg-home__card" data-df-home-card={document.id}>
      <a
        className="dfg-home__card-link"
        href={editorHref(document.id)}
        aria-label={openLabel}
        onClick={handleOpen}
      >
        <span className="dfg-home__card-thumb" aria-hidden="true">
          <FrameIcon size={24} />
        </span>
        <span className="dfg-home__card-name">{document.name}</span>
        <span className="dfg-home__card-meta">{meta}</span>
      </a>
      <span className="dfg-home__card-menu">
        <DropdownMenu
          label={t('home.card.menu', { name: document.name })}
          align="end"
          trigger={({ triggerProps }) => (
            <IconButton
              {...triggerProps}
              size="sm"
              label={t('home.card.menu', { name: document.name })}
              icon={<MoreHorizontalIcon />}
            />
          )}
          sections={[
            {
              id: 'open',
              items: [
                {
                  id: 'open',
                  label: t('home.card.openItem'),
                  onSelect: () => onOpen(document),
                },
              ],
            },
            {
              id: 'danger',
              items: [
                {
                  id: 'delete',
                  label: t('home.card.deleteItem'),
                  danger: true,
                  onSelect: () => onRequestDelete(document),
                },
              ],
            },
          ]}
        />
      </span>
    </li>
  );
}
