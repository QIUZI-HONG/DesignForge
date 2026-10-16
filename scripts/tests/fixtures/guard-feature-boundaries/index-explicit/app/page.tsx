// 违规夹具④：app 显式引 `/index`——等价公开面但非登记写法，应点名公开面写法。
import { alphaView } from '@/features/alpha/index';

export default function Page() {
  return alphaView;
}
