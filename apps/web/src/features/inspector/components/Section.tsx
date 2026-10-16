'use client';

/**
 * Inspector 分区外壳（C5：布局 / 外观 / 文字 / 高级）。
 *
 * 取样挂点：`data-df-inspector-section="<id>"`——三态截图门禁按分区断言结构存在性。
 */

import type { ReactNode } from 'react';

/** 分区 id（四分区 + 画布设置）。 */
export type InspectorSectionId = 'layout' | 'appearance' | 'text' | 'advanced';

/** 分区 props。 */
export interface InspectorSectionProps {
  id: InspectorSectionId;
  title: string;
  children: ReactNode;
}

/** 分区（标题 + 内容）。 */
export function InspectorSection({ id, title, children }: InspectorSectionProps) {
  return (
    <section className="dfi-section" data-df-inspector-section={id}>
      <h3 className="dfi-section__title">{title}</h3>
      <div className="dfi-section__body">{children}</div>
    </section>
  );
}
