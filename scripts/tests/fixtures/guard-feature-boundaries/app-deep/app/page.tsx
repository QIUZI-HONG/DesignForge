// 违规夹具②：app→feature 深导入（路由层直引 feature 内部 model/store，绕过公开面）。
import { alphaStore } from '@/features/alpha/model/store';

export default function Page() {
  return alphaStore;
}
