/** 阻塞夹具的对照件 · app 根（干净）：本夹具的阻塞来自 features 根侧的动态导入判不出。 */
import { alphaView } from '@/features/alpha';

export default function Page() {
  return alphaView;
}
