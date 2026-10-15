/**
 * 能力白名单词表与 license 三档守门（D2/D4 的展示与门禁输入）。
 *
 * 词表**沿用 v1.1 §4.5.3 / 《技能市场规格 v1》§7.1，不新增词**；本模块只做三件事：
 * 1. 把能力 id 映射到「人话标签 + 授权口径 + 风险档」（词表外的 id 一律归 `unknown`，
 *    **按最保守处理**：视为需显式授权——前向兼容且不乐观默认）；
 * 2. 汇总需显式授权（`ackRequired`）的清单，作为 D4 确认门与一次性 token 的输入；
 * 3. license 三档 → 展示口径（可装载 / 仅看 / 禁）。
 */

/** 能力风险档（决定色标与是否进显式授权清单）。 */
export type CapabilityRisk = 'granted' | 'scoped' | 'declared' | 'denied' | 'unknown';

/** 单个能力的展示口径。 */
export interface CapabilityDescriptor {
  id: string;
  /** i18n 标签键；词表外的能力为 null（界面直接显示原始 id）。 */
  labelKey: string | null;
  /** i18n 授予口径键。 */
  scopeKey: string;
  risk: CapabilityRisk;
  /** 是否需要显式授权（进 `ackRequired`）。 */
  ackRequired: boolean;
}

/** 词表条目（id → 展示与门禁口径）。`connector:` 前缀为动态能力，见 `describeCapability`。 */
const LEXICON: Record<
  string,
  { labelKey: string; scopeKey: string; risk: CapabilityRisk; ackRequired: boolean }
> = {
  'prompt:inject': {
    labelKey: 'market.capability.promptInject.label',
    scopeKey: 'market.capability.promptInject.scope',
    risk: 'granted',
    ackRequired: false,
  },
  'fs:read': {
    labelKey: 'market.capability.fsRead.label',
    scopeKey: 'market.capability.fsRead.scope',
    risk: 'scoped',
    ackRequired: false,
  },
  'fs:write': {
    labelKey: 'market.capability.fsWrite.label',
    scopeKey: 'market.capability.fsWrite.scope',
    risk: 'scoped',
    ackRequired: false,
  },
  mcp: {
    labelKey: 'market.capability.mcp.label',
    scopeKey: 'market.capability.mcp.scope',
    risk: 'scoped',
    ackRequired: false,
  },
  subprocess: {
    labelKey: 'market.capability.subprocess.label',
    scopeKey: 'market.capability.subprocess.scope',
    risk: 'denied',
    ackRequired: true,
  },
  bash: {
    labelKey: 'market.capability.bash.label',
    scopeKey: 'market.capability.bash.scope',
    risk: 'denied',
    ackRequired: true,
  },
  network: {
    labelKey: 'market.capability.network.label',
    scopeKey: 'market.capability.network.scope',
    risk: 'declared',
    ackRequired: true,
  },
  'comfy:generate': {
    labelKey: 'market.capability.comfyGenerate.label',
    scopeKey: 'market.capability.comfyGenerate.scope',
    risk: 'scoped',
    ackRequired: false,
  },
  'llm:call': {
    labelKey: 'market.capability.llmCall.label',
    scopeKey: 'market.capability.llmCall.scope',
    risk: 'scoped',
    ackRequired: false,
  },
};

/** 风险排序权重（高风险在前；D4 清单按此排序，把要授权的东西顶到眼前）。 */
const RISK_ORDER: Record<CapabilityRisk, number> = {
  denied: 0,
  unknown: 1,
  declared: 2,
  scoped: 3,
  granted: 4,
};

/** 描述单个能力（词表外 → unknown，保守标为需显式授权）。 */
export function describeCapability(id: string): CapabilityDescriptor {
  const known = LEXICON[id];
  if (known !== undefined) return { id, ...known };
  if (id.startsWith('connector:')) {
    return {
      id,
      labelKey: 'market.capability.connector.label',
      scopeKey: 'market.capability.connector.scope',
      risk: 'declared',
      ackRequired: true,
    };
  }
  return {
    id,
    labelKey: null,
    scopeKey: 'market.capability.unknown.scope',
    risk: 'unknown',
    ackRequired: true,
  };
}

/**
 * 汇总能力清单：高风险在前、稳定排序；并给出**需显式授权**的清单
 * （词表判定 ∪ 索引 `installGate.ackRequired`——索引写明的必须授权，不能因词表更新而漏）。
 */
export function describeCapabilities(
  ids: readonly string[],
  ackRequiredFromIndex: readonly string[] = [],
): { items: CapabilityDescriptor[]; ackList: string[] } {
  const unique = [...new Set(ids)];
  const items = unique
    .map(describeCapability)
    .sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk] || a.id.localeCompare(b.id) || 0);
  const ackSet = new Set<string>();
  for (const item of items) if (item.ackRequired) ackSet.add(item.id);
  for (const id of ackRequiredFromIndex) ackSet.add(id);
  return { items, ackList: [...ackSet].sort((a, b) => a.localeCompare(b)) };
}

/** license 三档的展示口径（§7.2；工程口径，非法务结论）。 */
export interface LicenseGateDescriptor {
  gate: 'loadable' | 'view-only' | 'blocked';
  labelKey: string;
  noticeKey: string;
  tone: 'ok' | 'warn' | 'danger';
}

/** 描述 license 档位。 */
export function describeLicenseGate(gate: LicenseGateDescriptor['gate']): LicenseGateDescriptor {
  switch (gate) {
    case 'loadable':
      return {
        gate,
        labelKey: 'market.license.loadable.label',
        noticeKey: 'market.license.loadable.notice',
        tone: 'ok',
      };
    case 'blocked':
      return {
        gate,
        labelKey: 'market.license.blocked.label',
        noticeKey: 'market.license.blocked.notice',
        tone: 'danger',
      };
    default:
      return {
        gate: 'view-only',
        labelKey: 'market.license.viewOnly.label',
        noticeKey: 'market.license.viewOnly.notice',
        tone: 'warn',
      };
  }
}

/** 安装门三态 → 主按钮口径（D2 安装三态按钮）。 */
export interface InstallButtonState {
  mode: 'loadable' | 'view-only' | 'blocked';
  labelKey: string;
  disabled: boolean;
  /** 禁用原因（F15：灰化 + tooltip 说明原因）。 */
  disabledReasonKey: string | null;
}

/** 描述安装按钮态；`loaded` 为真时覆盖为「已装载」（仍可重装/更新，按钮不禁用）。 */
export function describeInstallButton(
  mode: InstallButtonState['mode'],
  loaded: boolean,
): InstallButtonState {
  if (loaded) {
    return {
      mode,
      labelKey: 'market.install.loaded',
      disabled: false,
      disabledReasonKey: null,
    };
  }
  switch (mode) {
    case 'loadable':
      return {
        mode,
        labelKey: 'market.install.loadable',
        disabled: false,
        disabledReasonKey: null,
      };
    case 'blocked':
      return {
        mode,
        labelKey: 'market.install.blocked',
        disabled: true,
        disabledReasonKey: 'market.install.blockedReason',
      };
    default:
      return {
        mode: 'view-only',
        labelKey: 'market.install.viewOnly',
        disabled: true,
        disabledReasonKey: 'market.install.viewOnlyReason',
      };
  }
}
