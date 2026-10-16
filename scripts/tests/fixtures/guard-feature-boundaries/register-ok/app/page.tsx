// 登记例外正例：app 路由层引 register 接缝（ADR-0004 ② 具名例外）→ 守卫必须 exit 0。
import { AlphaBootstrap } from '@/features/alpha/register';

export default function Page() {
  return AlphaBootstrap ? 'boot' : 'none';
}
