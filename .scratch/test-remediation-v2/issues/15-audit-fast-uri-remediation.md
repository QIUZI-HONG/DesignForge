# 15: fix · 依赖安全：`fast-uri` 8 项与 S-04 判据对齐

**What to build:** 测试计划 §3.10 S-04 承诺「`pnpm audit`（prod）0 已知漏洞」。本轮实测 `pnpm audit --prod` **exit=1，8 项**（4 moderate + 4 low），全部落在 `fast-uri`：URI scheme spoofing、host confusion via unchecked、improper path equivalence、scheme injection（日志 `~/df-evidence/test-2026-11-01/audit-prod.log`）。这是**判据与实况背离**，不是新写的代码缺陷。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

blockers:

- [ ] 定位 `fast-uri` 的引入链（哪个直接依赖带进来），升级到已修版本或替换
- [ ] `pnpm audit --prod` 回到 0；若确实不可消除，**改写 S-04 文字**并点名豁免范围 + 复核日期（禁止静默放宽判据，见 `implementation-workflow.md`「门禁不得被调弱」）
- [ ] 把 audit 接入 CI（当前不在 `ci.yml` 链路里，属「CI 差异清单」未记载项）—— 接法本身要判三态：registry 不可达 = 2，有漏洞 = 1
- [ ] 复核上一轮记的「三个 action 仅 tag pin 未 pin SHA」是否随本票一并处理（不处理要写明）
