// 混合夹具 · 违规侧：feature→feature 深导入（绕过公开面）→ 应判 exit 1。
import { alphaState } from '@/features/alpha/state/session';

export const betaView = alphaState;
