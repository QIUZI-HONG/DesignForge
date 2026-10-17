/**
 * 正例夹具 · 两类合法写法并存：跨 feature 经公开面（`@/features/alpha`）+
 * 自身 feature 深导入（`@/features/beta/state/local`）——守卫必须都放行。
 */
import { alphaView } from '@/features/alpha';
import { betaLocal } from '@/features/beta/state/local';

export const betaView = `${alphaView}:${betaLocal}`;
