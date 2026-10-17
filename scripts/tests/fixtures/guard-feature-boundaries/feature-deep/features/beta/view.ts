// 违规夹具①：feature→feature 深导入（直引 alpha 内部 state/session，绕过公开面）。
import { alphaSession } from '@/features/alpha/state/session';

export const betaView = alphaSession;
