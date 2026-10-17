# 审计 v1 报告索引

审计规格：[#50](https://github.com/QIUZI-HONG/DesignForge/issues/50)。基线 `main` @ `c6b1654`；集成分支 `integration/audit-v1` @ `f559cb4`。审计阶段未改产品代码。

| 报告 | 内容 | 状态 |
|---|---|---|
| [`01-baseline.md`](01-baseline.md) | 29 次门禁复跑（0×22 / 1×0 / 2×7）、生产构建、CI 事实与覆盖矩阵 | 已完成 |
| [`02-capability.md`](02-capability.md) | 五态能力表 59 项（39 working / 9 partial / 5 missing / 0 broken / 6 blocked）+ 全规格差距 26 项 | 已完成 |
| [`03-data-security.md`](03-data-security.md) | 数据完整性/安全深挖；14 findings（A2/B3/C9）；韧性接缝 47 步 | 已完成 |
| [`04-editor-review.md`](04-editor-review.md) | 编辑器/评审深挖；10 findings（B5/C5）；axe 2 critical + 5 serious | 已完成 |
| [`05-market-shell-mcp.md`](05-market-shell-mcp.md) | 市场/桌面壳/MCP 深挖；6 findings（B5/C1）；MCP 契约快照接 CI | 已完成 |
| [`06-ai-image.md`](06-ai-image.md) | AI/出图两态深挖；13 findings（B5/C8） | 已完成 |
| [`07-io-settings.md`](07-io-settings.md) | 导入导出/设置深挖；10 findings（A1/B4/C5）；真实导出空白 | 已完成 |
| [`08-cross-domain.md`](08-cross-domain.md) | 跨域 e2e；6 场景 114 步 = 110 pass / 4 fail；导出内容断言 | 已完成 |
| [`09-final-report.md`](09-final-report.md) | 最终报告：去重登记、5 epic/40 issue、CI 改造清单、blocked/human | 已完成 |

## 收口结果

- 5 个 epic：[#62](https://github.com/QIUZI-HONG/DesignForge/issues/62)（数据/安全）、[#63](https://github.com/QIUZI-HONG/DesignForge/issues/63)（编辑器/评审）、[#64](https://github.com/QIUZI-HONG/DesignForge/issues/64)（AI/出图）、[#65](https://github.com/QIUZI-HONG/DesignForge/issues/65)（市场/壳/MCP）、[#66](https://github.com/QIUZI-HONG/DesignForge/issues/66)（导入导出/设置）。
- 40 个子 issue #67–#106：A 3 / B 23 / C 14；缺陷 21 / 观察 13 / planned 缺口 6。
- A 级 3 条：[#67](https://github.com/QIUZI-HONG/DesignForge/issues/67) 跨进程丢页、[#68](https://github.com/QIUZI-HONG/DesignForge/issues/68) CORS `Origin: null`、[#69](https://github.com/QIUZI-HONG/DesignForge/issues/69) 导出空白。
- 只登记不建票：REF-01 [#28](https://github.com/QIUZI-HONG/DesignForge/issues/28)、digest [#39](https://github.com/QIUZI-HONG/DesignForge/issues/39)、批次 5 [#46](https://github.com/QIUZI-HONG/DesignForge/issues/46)、Mimosa [#47](https://github.com/QIUZI-HONG/DesignForge/issues/47)、#48/#49；质量缺口统一归 [#60](https://github.com/QIUZI-HONG/DesignForge/issues/60)。
- 机器可读登记表：`~/df-evidence/audit-50/aud-09/register.json`（人类可读 `register.md`）。

结论：审计完成，A/B 缺陷与缺口已登记，放行判断由负责人按分级决定。
