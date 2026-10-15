/**
 * 评分原因码与信号码词表（MK-03 · 唯一真源；枚举稳定、可快照）。
 *
 * 规格依据：《技能市场规格 v1》§5.2（每维信号清单）/ §5.3（扣分原因码词表——
 * 规格明示「示例，可扩展」）。本模块是落码真源，纪律：
 *   - 规格词表内的码**原样保留**（`SPEC_VOCABULARY_CODES`，有测试守住不许删/改名，§1.5.2）；
 *   - 扩展码在注释标注「扩展」并写明对应信号与阈值依据；
 *   - 消费方（雷达、「为什么是这个分」列表）一律按码查文案，禁止在算法里散写人话。
 */

/**
 * 扣分原因码词表：码 → 默认人话文案。
 * `SPEC_VOCABULARY_CODES` 列出规格 §5.3 明示的码；其余为本票扩展（规格 §1.5.2 允许新增）。
 */
export const REASON_TEXT = {
  // —— 规范符合度（spec）——
  /** 扩展：frontmatter 必有字段 name 缺失（规格 §2.2 内容校验①）。 */
  S0: '缺 name（frontmatter 必有字段）',
  S1: '缺 description',
  S2: 'description 未写「何时使用」',
  S3: '无显式工作流',
  /** 扩展：规格 §5.2 spec 信号「是否附 references/ 或 examples/」。 */
  S4: '无 references/ 或 examples/ 目录',
  /** 扩展：规格 §5.2 spec 信号「清单 schema 符合度（plugin.json / design-system manifest 字段齐）」。 */
  S5: '清单 schema 字段不全',
  /** 扩展：规格 §2.2 内容校验③（正文非空且非纯清单）。 */
  S6: '正文为空或纯链接清单',

  // —— 维护活跃度（maintenance）——
  M1: '>365 天未更新',
  M2: '僵尸仓（>540 天且 <50★）',
  /** 扩展：pushed_at 在 90–365 天区间（维护放缓，规格 §5.2「pushed_at 新鲜度」梯度）。 */
  M3: '90–365 天未更新（维护放缓）',
  /** 扩展：规格 §5.2「是否有 CI（.github/workflows/ 存在性）」。 */
  M4: '无 CI（.github/workflows/ 缺失）',
  /** 扩展：规格 §5.2「最近 90 天提交数」（v1+ 增强信号，有数据才判）。 */
  M5: '90 天内无提交',
  /** 扩展：规格 §5.2「最近一次 release 距今」（v1+ 增强信号，有数据才判）。 */
  M6: '>365 天无发布',
  /** 扩展：规格 §5.4「归档仓：maintenance 封顶（如 ≤0.3）」。 */
  M7: '归档仓（维护活跃封顶 ≤0.3）',

  // —— 文档完备度（docs）——
  D1: '无 README',
  D2: '无使用示例',
  D3: '无预览资产',
  /** 扩展：规格 §5.2 docs 信号「是否有 changelog」。 */
  D4: '无 changelog',
  /** 扩展：规格 §5.2 docs 信号「许可说明是否清晰（含上游署名）」；细则（缺哪一项）由调用方补齐。 */
  D5: '许可说明不清',

  // —— 安全性（security）——
  X1: '含 postinstall 等安装脚本',
  X2: '未声明权限',
  X3: '未声明出站域名',
  /** 扩展：规格 §5.2 security 信号「敏感路径访问（工作目录外读写）」。 */
  X4: '敏感路径访问（工作目录外读写）',

  // —— 生态热度（ecosystem）——
  E1: '星标增速低',
  /** 扩展：规格 §5.2 ecosystem 信号「fork 数」（防马太：用批内分位，不用绝对排名）。 */
  E2: 'fork 参与度低',
  /** 扩展：规格 §5.2 ecosystem 信号「被引用数（被其他仓引用/同源落点数）」。 */
  E3: '被引用分位低',

  // —— 许可（跨维）——
  L1: '许可档非可装载（不扣分，走守门，§7.2）',
} as const;

/** 扣分原因码（词表键的联合类型）。 */
export type ReasonCode = keyof typeof REASON_TEXT;

/**
 * 规格 §5.3 词表明示的码。测试守住：不许删除、不许改名（§1.5.2 只许新增）。
 * 注意 `L1` 不扣分（delta 恒 0，走守门），保留在词表内。
 */
export const SPEC_VOCABULARY_CODES = [
  'S1',
  'S2',
  'S3',
  'M1',
  'M2',
  'D1',
  'D2',
  'D3',
  'X1',
  'X2',
  'X3',
  'E1',
  'L1',
] as const satisfies readonly ReasonCode[];

/**
 * 信号码 → 人话说明（雷达 tooltip / 调试可读性）。
 * 信号码形如 `<维度>.<信号名>`，维度前缀与 `DIMENSIONS` 一致。
 */
export const SIGNAL_TEXT = {
  // spec
  'spec.frontmatter': 'frontmatter 必要字段（name + description）',
  'spec.description-usage': 'description 是否写明「何时使用」',
  'spec.workflow': '正文是否含显式工作流（步骤/命令块）',
  'spec.aux-dirs': '是否附 references/ 或 examples/',
  'spec.manifest': '清单 schema 字段完整度',
  'spec.body': '正文非空且非纯链接清单',
  // maintenance
  'maintenance.pushed-at': 'pushed_at 新鲜度',
  'maintenance.ci': 'CI 存在性（.github/workflows/）',
  'maintenance.commits-90d': '最近 90 天提交数（v1+ 增强信号）',
  'maintenance.last-release': '最近一次发布距今（v1+ 增强信号）',
  // docs
  'docs.readme': 'README 存在性',
  'docs.usage': 'README 安装与使用示例',
  'docs.preview': '预览资产（preview/ 图或 components.html）',
  'docs.changelog': 'changelog 存在性',
  'docs.license-clarity': '许可说明清晰度（含上游署名）',
  // security
  'security.install-scripts': '安装脚本（postinstall/preinstall/shell 脚本）',
  'security.permissions': '权限声明（allowedTools/capabilities）',
  'security.outbound': '出站域名声明',
  'security.sensitive-paths': '敏感路径访问（工作目录外读写）',
  // ecosystem
  'ecosystem.stars-growth': '星标增速（批内分位）',
  'ecosystem.forks': 'fork 数（批内分位）',
  'ecosystem.referenced': '被引用数（批内分位）',
} as const;

/** 信号码（词表键的联合类型）。 */
export type SignalCode = keyof typeof SIGNAL_TEXT;
