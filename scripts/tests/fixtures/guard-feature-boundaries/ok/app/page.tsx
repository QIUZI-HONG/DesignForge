/**
 * 正例夹具 · app 根：公开面 + `register` 接缝 + 样式入口（两处登记例外都在 app 根适用）。
 */

import { AlphaBootstrap } from '@/features/alpha/register';
import { betaViewOnFace } from '@/features/beta';
import '@/features/alpha/alpha.css';

export default function Page() {
  return `${betaViewOnFace}:${AlphaBootstrap ? 'boot' : 'none'}`;
}
