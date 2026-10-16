/** 违规夹具的对照件 · app 根（干净：register 接缝在 app 根是登记例外，本夹具的违规只在 features 根侧）。 */
import { AlphaBootstrap } from '@/features/alpha/register';

export default function Page() {
  return AlphaBootstrap ? 'boot' : 'none';
}
