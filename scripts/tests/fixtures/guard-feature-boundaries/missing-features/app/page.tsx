// 阻塞夹具：源码根存在但缺 features 根（双侧判据不成立）——守卫应 exit 2，禁当通过。
import { alphaView } from '@/features/alpha';

export default function Page() {
  return alphaView;
}
