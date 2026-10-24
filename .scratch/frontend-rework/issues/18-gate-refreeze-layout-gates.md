# 18: gate · 参照集重冻结 + verify:layout-* 切换

**What to build:** 参照集版本化重冻结（版本/日期/哈希；用途 = B 级人工验收对照物 + 像素诊断基线）；verify:figma-* 系列改造成 verify:layout-*（DOM 几何快照断言，阈值 ±2px）；像素差异率降级为诊断工具（不再拦合并，产出差异热图供人工验收）。

**Blocked by:** 09, 10, 12, 13（阶段 2 主体全绿后布局才稳定）

**Status:** ready-for-agent

blockers: 09,10,12,13

- [ ] 新参照集冻结记录入库（版本递增）
- [ ] layout 门禁真链路运行，锚点集覆盖全部对标页
- [ ] 像素对照降级为诊断（CI 不再以差异率拦合并）
