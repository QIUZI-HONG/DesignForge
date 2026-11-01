# 08: fix · CI 三个「阻塞语义断言」步骤的 exit 0 分支必须附凭据

**What to build:** `verify-figma-baseline` / `verify-motion` / `verify-perf` 三步在 CI 里断言三态语义，但每步都以 `if [ "$code" -eq 0 ]; then echo "…此后应改为必须 exit 0"; exit 0; fi` 开头 —— 门禁退化成「`exit 2`，或者**什么都不测的 `exit 0`**」：若某轮把挂点掏空成零校验直接退 0，CI 会打印「已正式接入」而**没有任何凭据**。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

blockers:

- [ ] exit 0 分支必须校验可复核凭据：证据 JSON 存在且 `assertions >= N`；perf 另需 `provisional === false` + 基线校准时间戳；缺任一 → 判 1
- [ ] 「应改为必须 exit 0」的提示语后附**改判条件清单**（谁能判定条件成立、由哪张票改），不许留成口头承诺
- [ ] 三步的断言逻辑抽成共用 shell 片段或 node 小工具，避免三处各写一套（现三处结构相同、只有 grep 串不同）
- [ ] 对抗夹具：一个「零校验 exit 0」的假门禁脚本必须被本步骤判 1
- [ ] 与票 16 同步实况表
