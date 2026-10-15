import { t } from '@/i18n';

/**
 * 落地页（骨架期占位）。
 *
 * 仅证明链路可跑：Next App Router → i18n（ICU）→ 捆绑字体渲染。
 * 真正的首页 / 文件浏览器（对标 Figma 本体的浅色首页族）归 FE-02；
 * 此处不得沉淀任何页面结构与样式，避免与 FE-01 令牌口径冲突。
 */
export default function HomePage() {
  return (
    <main>
      <h1>{t('home.title')}</h1>
      <p>{t('home.subtitle')}</p>
      <p>{t('home.stage', { stage: 'P0' })}</p>
    </main>
  );
}
