# 10: 环境文档与控制台警告清零

**What to build:** 接手者第一次就能跑起来、控制台不被噪声淹没。文档修正：README 的 daemon 启动要求写准（Node 22.16 需显式开启类型剥离，或声明 ≥22.18，实现票裁决）；桌面壳 dev 装载地址从 127.0.0.1 改为 localhost（127.0.0.1 下实测不水合），或为 dev 服务器配置允许的开发来源（二选一）。警告清零：编辑器路由 data-theme 水合错配（服务端 dark / 客户端 light，每次加载报错）；「script tag while rendering」React 警告（来源未定位，首帧内联脚本是嫌疑，需先定位）；诊断抽屉重复 key 警告；Inspector 效果区等处未翻译键名（如效果区原始键）补齐 i18n。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] README 修正后，按文档从零执行 daemon 与 web 启动成功（Node 22.16 环境可复现）
- [ ] dev 装载地址按所选方案修正；127.0.0.1 与 localhost 至少其一在文档路径下水合正常
- [ ] 浏览器实测：/editor 与 / 加载 console 无水合错配、无 script-tag 警告、无重复 key 警告
- [ ] Inspector 无裸键名，全部文案来自 zh-CN 目录
- [ ] 既有门禁（lint/typecheck/test）全绿
