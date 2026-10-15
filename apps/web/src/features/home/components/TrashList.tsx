'use client';

/**
 * 回收站记录列表（FE-02 · 回收站分区的展开形态）。
 *
 * 边界（如实呈现，不美化）：daemon 的删除是**物理删除**——`.dfg` 目录没了，正文不可恢复。
 * 所以这里只列「删除记录」（谁、什么时候删的），动作只有「彻底删除记录」（清本机记录），
 * **没有「恢复」按钮**：给一个恢复出来是空文档的按钮，比不给更糟。
 */
import { IconButton, TrashIcon } from '@dforge/ui';

import { t } from '@/i18n';

import { describeRelativeTime } from '../lib/format';
import type { TrashRecord } from '../lib/trash';

/** 回收站列表 props。 */
export interface TrashListProps {
  records: TrashRecord[];
  now: () => Date;
  /** 清除一条记录（本机记录，不涉及磁盘）。 */
  onPurge: (id: string) => void;
}

/** 相对时间文案（与卡片同一套口径）。 */
function timeText(iso: string, now: Date): string {
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

/** 回收站记录列表。 */
export function TrashList({ records, now, onPurge }: TrashListProps) {
  if (records.length === 0) return null;
  return (
    <div className="dfg-home__trash">
      <p className="dfg-home__notice-desc">{t('home.trash.note')}</p>
      <ul className="dfg-home__trashlist">
        {records.map((record) => (
          <li key={record.id} className="dfg-home__trashrow" data-df-trash-record={record.id}>
            <span className="dfg-home__trashrow-icon" aria-hidden="true">
              <TrashIcon />
            </span>
            <span className="dfg-home__trashrow-name">{record.name}</span>
            <span className="dfg-home__trashrow-time">
              {t('home.trash.deletedAt', { time: timeText(record.deletedAt, now()) })}
            </span>
            <IconButton
              label={`${t('home.trash.purge')}：${record.name}`}
              size="sm"
              icon={<TrashIcon />}
              onClick={() => onPurge(record.id)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
