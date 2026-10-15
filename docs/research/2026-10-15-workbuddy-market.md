# WorkBuddy 技能市场形态研究报告

- 票：[#3 WorkBuddy 技能市场形态研究](https://github.com/QIUZI-HONG/DesignForge/issues/3)
- 日期：2026-10-15
- 执行：研究子代理（无人值守）
- 产出：本报告 + 第 4 节「设界市场呈现要求草案 v0」（供「技能市场规格 v1」票引用）

**证据等级标注**：`[实测]` = 本机 WorkBuddy 安装/数据目录实读；`[文档]` = codebuddy.cn 官方文档实抓；`[推断]` = 由上述证据综合、未经直接证实。

**隐私边界**：只读结构与清单；未读取会话、凭据、账号数据；报告不出现本机用户名与账号信息（用户目录一律写 `%USERPROFILE%`）。

---

## 0. 结论摘要（先读这段）

1. **WorkBuddy 的市场是一个「统一市场页」**：一级标签为 技能 / 连接器 / 专家（路由 `/skills`、`/connectors`、`/experts`），技能页内部再分「技能市场 / 已安装」两个二级标签。`[实测]`（渲染层 chunk `market-*.js` 中 `UnifiedMarketPage` 组件与 `resolveTab` 路由判断；locale 键 `unifiedMarket.tab.*`）
2. **技能市场子标签＝来源/生态维度，而不是品类维度**：推荐 / SkillHub / 套件（Plugins）/ Knot / 企业 Skill。`[实测]`（`skills.tab.*` 文案）其中 SkillHub、Knot 是远程技能社区市场的并列接入点。`[推断]`（二者的网络协议未见本机定义）
3. **可观测的条目字段结构以「清单缓存 + 市场 manifest + 已装记录」三层保存**：技能清单 `.skill-list-cache.json`（54 条）、市场清单 `plugins/marketplaces/*/.codebuddy-plugin/marketplace.json`、安装记录 `plugins/installed_plugins.json`（66 项）。来源标注靠 `source` 字段区分 builtin / userSettings / plugin / connector。`[实测]`
4. **卡片与详情的信息集可以逐字还原**（locale 文案即是 UI 结构）：卡片＝名称/描述/来源/指标（下载量/收藏量/使用量/安装量）+ 主按钮（安装|已安装|更新|安装中）；详情＝基本信息（来源/版本/ID/作者/开发者/License）+ 概述（含自动翻译）+ 试试这样用（示例）+ 使用案例（一键做同款）+ 安全评估 + 指标。`[实测]`
5. **装载/卸载/更新是三个带确认门的显式流程**：安装＝确认弹窗（下载到本地技能目录，可覆盖同名）→ 安全检测（科恩实验室评估；安全/低/中/高；可配置强制/跳过）→ 写入；卸载＝确认（含批量、含「同时删除云端记录」选项）；更新＝版本比对 + 「更新会覆盖你的修改」二次确认 + 自动更新开关。`[实测]`＋`[文档]` 互证
6. **权限与能力提示是市场的一部分而非附属**：需 API Key 标签、云端可用标签、安全风险等级与逐文件分析、企业策略（禁止高风险/上传黑白名单）、积分消耗与第三方数据外发提示、启用技能 >80 个的性能警告。`[实测]`＋`[文档]`
7. **场景化入口是 WorkBuddy 组织需求侧的主维度**：`scenes.json` 共 29 个场景（文档处理/金融服务/…/设计系统/品牌设计/视觉海报…），每个场景绑定 plugins + 若干 prompt 模板，分 working / coding / design 三种 mode；其中 9 个 design 场景全部挂 `ardot-design-generator` 套件。`[实测]`
8. **本机这台设备几乎没走市场安装**：54 条技能里仅 1 条 `marketplaceSource=marketplace`；30 条 userSettings、21 条 builtin。说明「本地技能文件夹 + 对话安装」是主路径，市场是增量入口。`[实测]`

---

## 1. 方法与证据源

| 证据源 | 位置 | 等级 |
|---|---|---|
| WorkBuddy 数据目录 | `%USERPROFILE%\.workbuddy\`（本机经 WSL 挂载实读） | 实测 |
| WorkBuddy 安装目录 | `D:\Workbuddy\resources\app.asar` + `app.asar.unpacked` | 实测 |
| 渲染层 UI 文案（zh-CN locale） | `D:\Workbuddy\resources\app.asar.unpacked\renderer\assets\zh-cn-*.js`（11,651 条键值，经 \uXXXX 解码提取） | 实测 |
| 渲染层组件 chunk | `renderer\assets\skills-market-*.js`、`skills-panel-*.js`、`standalone-skill-detail-modal-*.js`、`market-*.js` 等 | 实测 |
| 内置技能安装器提示词 | `resources\plugins\workbuddy-builtin\skills\marketplace-skill-installer\SKILL.md`（unpacked） | 实测 |
| 官方文档 | https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Skills-Market | 文档 |
| 产品首页 | https://www.workbuddy.cn/（无市场文档外链，仅产品页） | 文档 |

方法备注：`app.asar`（98MB）以自写 Python 解析器按需读取文件表与单文件，未整体解包；locale 文件为模板字符串内 `\uXXXX` 转义，需解码后检索，直接用 grep 搜中文会漏（这也是本报告一个过程教训）。

---

## 2. 本机盘点

### 2.1 数据目录骨架（`%USERPROFILE%\.workbuddy\`，实测）

市场/技能相关目录与文件（其余目录如 sessions/audit-log 等未纳入，属隐私范围）：

```
.skill-list-cache.json            72KB，技能清单缓存（54 条）
plugins/
  ├ installed_plugins.json        66 项安装记录
  ├ configured-plugins.json       内置市场插件启用清单（welcomeMode/interactionmode/…）
  ├ known_marketplaces.json       已注册市场（7 个）
  └ marketplaces/                 市场快照落盘（含 .codebuddy-plugin/marketplace.json）
skills/                           本地技能文件夹（SKILL.md 形态，用户自己的技能）
skills-backup-20260917-2113/      技能备份快照（同名文件夹批量副本）
connectors-marketplace/           连接器市场目录快照
  ├ .codebuddy-connector/connectors.json   283 条连接器目录
  └ icons/                        连接器图标（svg/png，按 slug 命名）
plugin-marketplace-state-new/     市场检查状态（版本标记、周期检查标记）
plugin-account-state/             插件账号态
skill-cloud-sync/                 技能云同步状态
plugin-status-daily.json          每日状态汇报
app/                              Electron 应用态（playbook-covers、app-config.json 等）
```

### 2.2 技能条目字段结构（`.skill-list-cache.json`，实测）

顶层：`{version:6, results:[54], watch:{dirs:[…]}, signature:{ok,missing,sum,xor}, scopeKey, savedAt}`。
`results[]` 为技能条目。字段频次与含义（54 条统计）：

| 字段 | 出现 | 含义/取值 | 样例 |
|---|---|---|---|
| `name` | 54 | 展示名（中英混排） | `Word 文档生成` / `buddy-image-processing` |
| `filePath` | 54 | SKILL.md 绝对路径 | `…\.workbuddy\skills\<slug>\SKILL.md`、`D:\Workbuddy\resources\…\workbuddy-builtin\skills\…` |
| `description` | 54 | 描述（默认语言） | — |
| `source` | 54 | **来源维度**：`userSettings`(30) / `builtin`(21) / `plugin`(2) / `connector`(1) | — |
| `type` | 54 | 条目类型，全部为 `prompt` | — |
| `disable` | 54 | 停用开关（本机全 false） | — |
| `disableModelInvocation` | 54 | 禁止模型自动触发（20 条 true＝仅手动） | — |
| `overrideKey` / `slug` | 54 / 22 | 覆盖与目录键 | `minimax-docx` |
| `iconSource` / `iconUrl` | 54 / 1 | 图标（目录内查图标或 local-file:// URL） | `local-file:///…/_icon.svg` |
| `pluginId` | 31 | 归属插件（内置技能挂在插件下） | — |
| `description_en` / `description_zh` | 23 / 3 | 双语描述 | — |
| `examples_zh` / `examples_en` | 1 / 1 | 示例话术数组 | `['生成一份项目方案 Word 文档', …]` |
| `version` | 21 | 版本（更新比对依据） | `1.0.0`、`v20260918`、`${WORKBUDDY_BUILD_VERSION}` |
| `userInvocable` | 20 | 是否用户可手动调用 | — |
| `license` | 7 | 许可证 | `MIT` |
| `allowedTools` | 6 | 该技能被允许使用的工具（能力边界声明） | `search_and_install_skills` |
| `skillId` / `installedAt` | 1 / 1 | 市场技能才有：云端 ID、安装时间 | `skill_2053082396193849344` |
| `marketplaceSource` | 1 | 来自市场时为 `marketplace` | — |
| `isMarketContentEdited` | 1 | 本地改动过市场内容（更新时需二次确认） | — |

**读取要点**：来源四值、版本、双语文案、示例话术、工具白名单、用户改动标记，都能在一个清单缓存里同时表达「已装/来源/可更新/可手动」四种状态。`[实测]`

### 2.3 市场清单与安装记录（实测）

- `plugins/known_marketplaces.json`：7 个市场，字段 `manifestName / type(zip) / source.url / installLocation / description / lastUpdated / autoUpdate / isBuiltIn`。实例：`codebuddy-plugins-official`（“CodeBuddy 官方插件市场”）、`cb_teams_marketplace`（“团队协作与文档处理插件集合”，`isBuiltIn:true`）。下载域：`download.codebuddy.cn`。
- `plugins/installed_plugins.json`：`{"<plugin>@<marketplace>": [{scope, installPath, version, installedAt, lastUpdated}]}`，66 项。更新判定即 version 比对 + lastUpdated。`[推断]`
- `marketplaces/*/.codebuddy-plugin/marketplace.json`：市场 manifest。条目字段 `name/description/source/version/category`（cb_teams 版还带 `author/homepage/license/skills`）。**category 是英文字段**：productivity / development / finance / design / research / content-creation / utility。规模：workbuddy-builtin 33、cb_teams 30、experts 7、codebuddy-plugins-official 206、connector-plugins 380、wecom-unified 1。`[实测]`
- `connectors-marketplace/.codebuddy-connector/connectors.json`：283 条连接器，字段 `id / name / name_en / description_zh / description_en / examples_zh / examples_en / source / auth_mode(server-side 等) / type(mcp) / visible_in(internal, iOA)`。`[实测]`
- 连接器插件实体（`…/connectors/<id>/`）：`.codebuddy-plugin/plugin.json`（含 `extensions["ai.workbuddy"].display` 双语名/双语描述/双语示例、`auth.mode`、`policy.visible_in`、`policy.mcpServers`）+ `mcp.json`（`mcpServers` 端点）。**即「条目详情页要展示的字段」与「运行时字段」同源落在条目目录里**。`[实测]`
- `plugins/marketplaces/cb_teams_marketplace/scenes.json`：**场景清单 29 条**，字段 `id / unified_id / name / icon / mode(working|coding|design) / interactionModes(craft, plan…) / plugins[{name, marketplaceName}] / prompts[] / promptTitles[] / target`。design 场景 9 个：网站设计、移动端App、设计系统、Web App、PPT设计、交互原型、品牌设计、图标&插画、视觉海报——均挂 `ardot-design-generator`。`[实测]`（对设界最有直接参考价值的一份结构）

### 2.4 渲染层 UI 文案（zh-CN locale，实测）

从 `renderer/assets/zh-cn-*.js`（1.1MB）解码得 11,651 条键值。市场相关命名空间的键名即 UI 结构，本报告第 3 节按此组织；后文引用格式为 `键 = 文案`。相关 chunk：`skills-market-*.js`、`skills-panel-*.js`、`standalone-skill-detail-modal-*.js`、`market-*.js`（README 性名称即功能名，如 `skill-market-detail-close-request`、`paid-skill-registry`、`installed-skills-entitlement`、`skill-scan-result-dialog`）。

---

## 3. 市场面形态（逐条）

### 3.1 页面骨架

- 统一市场页三个一级标签：`unifiedMarket.tab.skills = 技能`（“适合高效完成特定的任务”）、`unifiedMarket.tab.connectors = 连接器`（“帮你连接外部应用数据”）、`unifiedMarket.tab.experts = 专家`（“以专家视角完成你的任务”）。`[实测，chunk 代码 + locale]`
- 技能页二级标签：`skills.l1tab.market = 技能市场` / `skills.l1tab.installed = 已安装`；市场内部三等奖签：`skills.tab.recommend = 推荐`、`skills.tab.skillhub = SkillHub`、`skills.tab.plugins = 套件`、`skills.tab.knot = Knot`、`skills.tab.enterprise = 企业 Skill`。`[实测]`
- 官方文档同构描述：技能板块分「技能市场」（推荐技能，一键安装）与「已安装」（可直接在对话中调用）。`[文档]`
- 已安装页再按来源分组：`skills.installed.group.custom = 用户自定义` / `…group.market = 来自市场` / `…group.plugins = 套件`，加载更多 `加载更多（剩 {remaining} 个）`。`[实测]`

### 3.2 列表卡片

卡片可断言的信息与操作（locale 键即卡片 affordance）`[实测]`：

- 主状态按钮：`skills.card.install = 安装`、`skills.card.installed = 已安装`、`skills.skillhub.install/update/updatable/updating/updateAvailable = 安装/更新/可更新/更新中…/有可用更新`、`installing = 安装中`。
- 管理操作（已安装卡片）：`skills.card.enable = 启用`、`disable = 关闭`、`edit = 编辑`、`uninstall = 卸载`、`pin = 置顶`、`unpin`、`more = 更多操作`。
- 指标行：`skills.card.downloads = 下载量 {count}`、`stars = 收藏量 {count}`、`useCount = 使用量 {count}`、`installCount = 安装量 {count}`。
- 标签：`skills.tag.needsApiKey = 需 APIKey`、`skills.tag.cloudAvailable = 云端可用`、`skills.paidTag = 付费`、`skills.enterprise.tag = 企业自建`。
- 安装成功后出现「去试试」：`skills.toast.trySkill = 去试试`、`skills.card.goChat = 去对话`。
- 推荐卡：`skills.recommend.title = 推荐`、`featured = 精选技能`、`refresh = 换一批`、`dismiss = 当前对话不再推荐`（连关 3 次当日不再推荐）。

### 3.3 详情页

详情面字段（`skills.detail.*` / `standalone-skill-detail-modal` chunk）`[实测]`：

- 基本信息 `basicInfo.title`：`来源`、`License`、`版本`（`metricVersion`）、`ID:`、`作者信息` / `开发者信息`（`viewDeveloper = 查看详情`）、描述区（`desc.expand/collapse = 展开/收起`）。
- 指标组 `data-skill-detail-metrics`：版本 / 使用量 / 安装量 / 下载量 / 收藏量；`installCount = 人已使用`。
- `概述`（overview）：长文正文 + 正文内搜索（`搜索概述内容（⌘F / Ctrl+F）`）+ 自动翻译声明（“正文由英文自动翻译，代码、命令和字段名保留原文。”/反向同款）。
- `试试这样用`（examples）：示例话术。
- `使用案例`（usedCases）：案例可 `一键做同款`（`replicate`）——从详情一键进入对话执行。
- 能力与安全区：`requiresApiKey = 需 API Key`、安全等级（见 3.6）。
- 更多：`更多`、`版本：`、`ID:`。
- 详情可从对话内唤起（chunk 名 `skill-detail-request-host` / `skill-market-detail-close-request`），即**详情不是独立路由页面，而是可被宿主随时打开/关闭的模态面板**。`[推断，由 chunk 命名与 route 结构推断]`

### 3.4 搜索与筛选、排序

- 搜索：`skills.searchPlaceholder = 搜索技能`；已安装页独立 `skills.installed.searchPlaceholder = 搜索已安装的技能`；空态 `skills.installed.searchNoMatch.title = 没有找到匹配的技能`；失败态 `skills.search.allFail = 搜索结果加载失败`、`partialFail = 部分社区结果加载失败`（暗示多源聚合搜索）。`[实测]`
- 分类（SkillHub 维度）：`skills.skillhub.allCategories = 全部`；Knot 同款（`skills.knot.allCategories`、`allTags = 全部`）。
- 排序：`skills.skillhub.sort.score = 综合评分`、`downloads = 下载量`、`updated_at = 最近更新`、`installs = 安装量`、`stars = 收藏量`。`[实测]`
- 筛选：`skills.filter.hideInstalled = 仅展示未安装`；分页 `loadMore = 加载更多`；`skills.backToTop = 回到顶部`。
- 场景化入口（需求侧分类）：见 2.3 scenes.json；`discover` 命名空间还有「灵感社区」：`discover.title = 灵感社区`、`subtitle = 常见工作流沉淀成可复用的任务起点`、`browseByScene = 按场景分类`、`featured = 精选`、`shareCode`（分享口令复用）。`[实测]`

### 3.5 装载 / 卸载 / 更新流程

**安装（市场/对话两路径）** `[实测]`＋`[文档]`：

1. 市场卡片 → `skills.installConfirm.title.install = 安装技能 {skillName}？`，正文 `content.install = 该技能包将被下载并安装到本地技能目录。`；同名已存在时 `title.overwrite = 技能 {skillName} 已存在`、`content.overwrite = 是否使用下载的版本覆盖本地已有技能？`，按钮 `覆盖 / 安装`。
2. 安装前安全检测（见 3.6）：`skills.security.scanning`、超时/失败可 `跳过检测并继续安装`。
3. 结果状态（对话安装器协议）：`installed / already_installed / refused`——**未获用户明确同意时安装器必须拒绝**（SKILL.md 原文：“只安装用户明确要求或在看到候选后同意的技能”、“按安装结果逐项报告 installed、already_installed 或 refused，不宣称失败项已安装”）。
4. 导入本地包：`skills.upload.modal.dropTitle = 拖拽文件或点击上传`，要求 `文件夹或者.zip需要包含SKILL.md文件`；上传前 `securityChecking = 安全检测中...`；策略门 `企业管理员已禁止上传个人 Skill`、`不在允许上传 Skill 的名单中`、`包大小超过 {limit}`。官方文档：安装技能三入口＝`添加技能` → `上传技能 / 查找技能 / 创建技能`。`[文档]`

**卸载** `[实测]`＋`[文档]`：

- `skills.delete.title = 卸载技能`、`content = 确定卸载该技能吗？`、`uninstall = 卸载`；批量：`batchUninstall.title = 确认卸载已选技能？`、`description = …将从已安装列表及本地文件夹中移除`；云端条目另有 `cloudOnlyTitle = 删除云端安装记录？`（`同时删除 {count} 个云端安装记录`）。
- 官方文档强调 `关闭 ≠ 卸载`（关闭仅暂停模型调用；卸载彻底删除技能及其开关记录），且开关状态多端同步、不改动技能原文件。`[文档]`

**更新** `[实测]`：

- 版本比对出 `updatable = 可更新`；批量 `batchUpdate.title = 技能更新`（“发现 {count} 个技能有可用更新” → `全部更新`）。
- 本地改动保护：`update.modifiedConfirm.title = 更新会覆盖你的修改`、`desc = 你已编辑过这个技能。更新到市场最新版会覆盖你的本地修改。`、`confirm = 更新并覆盖 / cancel = 暂不更新`（对应缓存里的 `isMarketContentEdited`）。
- 自动更新：`skills.autoUpdate.label = 技能自动更新`、`description = 开启后将自动更新已安装的技能为最新版本，不会更新你在 {name} 中编辑过的技能`。

### 3.6 权限与能力提示

`[实测]`（locale 文案）+`[文档]`（官方安全提示）：

- **能力声明**：条目级 `需 API Key`（`needsApiKey` / `requiresApiKey`）、“云端可用”；技能可声明 `allowedTools` 白名单（本机 SKILL.md 实测，如 `search_and_install_skills`）。
- **安全评估等级**：`skills.security.result.safe/low/medium/high = 安全/低风险/中风险/高风险`；整体判定 `verdict.white/grey/black = 安全/可能存在风险/恶意`；来源评估 `evaluatedBy = 由科恩实验室评估`、`thirdPartySource = 第三方来源，未评估`、`notEvaluated = 官方暂未评估`；高风险有逐文件分析、威胁标签、恶意代码证据、病毒名；高风险提示后提供 `卸载该 Skill / 保留`。
- **门禁**：`security.autoInstall = 非高风险自动安装`（可配）；`policy.forbidHighRisk = 当前企业禁止安装高风险技能…`；高风险需 `继续安装 ({seconds}s)` 倒计时或 `取消安装`。
- **官方文档权限清单原文**（详情/安装须知用词）：可能涉及“账户身份信息、联系方式、用户输入内容、使用行为日志、第三方平台凭证、本地文件读写、屏幕与输入控制权限”；“以您安装与启用 Skill 时所授权的能力为准”；“使用部分 Skill 时可能将输入内容发往第三方”；“涉及复杂的任务和复杂的 Skill 时，积分消耗通常较高”；“仅启用当前任务所需的技能”。
- **过量启用警告**：`skills.enabledWarning = 你当前启用了超过 80 个技能，过多的技能可能会消耗额外积分，也会影响模型的响应效果` + `管理技能 / 不再提醒`。
- **云端上传的凭据风险**（本地技能上云时）：`credentialRiskTitle = 检测到可能的敏感凭据`、`credentialRiskDesc = 技能内 Token、API Key 等凭证上传后将存储到云端并可能被调用，请确认你有权上传且不包含涉密密钥`、`riskAccepted = 我已了解风险，并愿意继续`。

### 3.7 来源与分类维度总表（实测汇总）

| 维度 | 取值 | 载体 |
|---|---|---|
| 来源（条目） | builtin / userSettings（自建）/ plugin（套件）/ connector / enterprise（企业自建）/ marketplace | `.skill-list-cache.json` `source`；UI `企业自建` 标签；`marketplaceSource` |
| 商店页签 | 推荐 / SkillHub / 套件 / Knot / 企业 Skill | `skills.tab.*` |
| 已安装分组 | 用户自定义 / 来自市场 / 套件 | `skills.installed.group.*` |
| 品类（市场 manifest） | productivity / development / finance / design / research / content-creation / utility | `marketplace.json` `category` |
| 场景（需求侧） | 29 个场景，mode: working / coding / design | `scenes.json` |
| 安全评估 | 安全 / 低 / 中 / 高风险；白/灰/黑 | `skills.security.*` |
| 商业化 | 付费（月/无限次/元）、已购买 chip、退款（3 次上限）、已到期 | `skills.paidTag`、`skills.refund.*` |
| 同步 | 未上云 / 仅云端 / 已上云；本地有更新 / 云端有更新 | `skills.sync.*` |

### 3.8 对话内安装协议（实测，SKILL.md）

`marketplace-skill-installer`（内置技能，`allowed-tools: search_and_install_skills`）：提取 1–5 关键词 → `{"action":"search","keywords":[…]}` → 返回 `{skills:[{name, display_name, description}]}` → 用户确认后 `{"action":"install","skill_names":[…]}`（name 必须逐字取自最近一次搜索结果，每次安装前重新搜索）→ 按项报告 `installed / already_installed / refused`。查询与开关另用 `skill_management` 工具。**「AI 代装」是市场的一等入口，且协议层面强制用户同意与逐项如实汇报。**

---

## 4. 设界市场呈现要求草案 v0

> 供「技能市场规格 v1」引用。原则：**骨架照搬（信息架构与交互范式），语义换域（设计领域资产）**，且全部落到设界三支柱：本地真值（`.dfg` 可 diff）、受控 AI（凡有副作用先确认）、数据飞轮（采集→评分→检索→回流）。

### 4.1 照搬的骨架（IA / 交互）

1. **统一市场页 + 两级标签**：一级 资产 / 连接器(MCP) / 模板（对齐 WorkBuddy 技能/连接器/专家三分）；二级 `市场 | 已安装`，市场内按来源生态分页签（推荐 / 官方 / 团队 / 社区）。
2. **卡片信息集**：名称 · 一句话描述 · 来源徽标 · 指标行（下载/安装/收藏/使用——设界对应五维评分与采纳回流计数）· 标签（需 API Key → 设界：需连接器/需云端/本地离线可用）· 主状态按钮（安装|已装|可更新|安装中）+ 更多操作（启用/停用/编辑/卸载/置顶）。
3. **详情面板**（模态，可被对话宿主唤起）：基本信息（来源/License/版本/ID/作者）→ 概述（长文 + 自动翻译声明）→ 试试这样用（示例话术，可一键发到对话）→ 使用案例（一键做同款 → 生成新 `.dfg` 变更提案）→ 安全与能力（见 4.4）→ 更多（版本/ID）。
4. **三流程的确认门**：安装＝确认弹窗（落地位置 + 覆盖同名确认）；卸载＝确认（支持批量 + 「同时删除云端记录」类选项）；更新＝版本比对 + **本地已改动则必须二次确认**（对应 WorkBuddy `isMarketContentEdited`）。自动更新开关默认关，且声明「不覆盖你改过的」。
5. **场景化入口**：卡片列表前放「按场景浏览」（场景＝若干资产 + 若干示例 prompt 的组合，字段照 `scenes.json` 形态：name/icon/mode/items/prompts/promptTitles）。
6. **对话内安装协议**：自然语言 → 搜索 → 候选展示 → **用户确认后**安装 → 逐项如实报告 `installed / already_installed / refused`；查询与开关走独立管理工具。此协议与设界「受控 AI：逐项 diff 审批」同构，直接沿用。
7. **搜索与筛选**：搜索框（`搜索资产`）、分类 chips（全部 + 品类）、`仅展示未安装`、排序（综合评分/下载量/最近更新/安装量/收藏量 → 设界用五维评分/采纳量/最近更新）、换一批（推荐流）。

### 4.2 换成设计领域语义

| WorkBuddy | 设界 |
|---|---|
| Skill（SKILL.md + 说明能力） | **Skill**：AI 可调用的设计动作单元（如“生成设计系统 token”“导出 Figma 图层”），同样用 `SKILL.md` YAML + 正文 |
| Plugin / 套件 | **Plugin**：一组 Skill + 模板 + 连接器声明的打包（如“海报工具箱”） |
| 专家（专家中心） | 暂不引入；若引入＝「设计角色预设」（可选，列入 v1 之后再定） |
| 连接器（MCP） | **连接器**：MCP 双端（ZCode / WorkBuddy）同源的本地连接（Figma 导入、Git、ComfyUI） |
| 模板/场景（scenes.json 的 prompts） | **模板**：可复用任务起点（页面模板、品牌模板、幻灯片模板），字段照抄 scenes.json 的 prompts/promptTitles |
| —（WorkBuddy 无此一等资产） | **设计系统**：token 集 + 组件清单 + 约束，作为一等市场资产（来源可标注“团队自建/社区”） |
| 分类：productivity/finance/… | 品类：`设计系统 / 组件 / 图标插画 / 海报 / 幻灯片 / 网页 / 原型 / 品牌 / 数据可视化`（直接用 scenes.json 的 design 场景名做种子：网站设计、移动端App、设计系统、Web App、PPT设计、交互原型、品牌设计、图标&插画、视觉海报） |
| 来源：builtin/userSettings/marketplace/enterprise | 来源：`内置（随应用） / 本地自建 / 官方 / 团队 / 社区（GitHub）`——社区来源必须显示 GitHub 仓库与 commit 指向（设界“GitHub 技能大数据市场”的采集对象） |
| 付费（月/无限次/退款） | **不照搬**（本地优先、离线完整可用；最多保留“赞助/捐赠”外链，v1 不做） |
| 云端同步/多端 | **不照搬**；改为「本地真值 `.dfg` + Git 远端（用户自有仓库）」的用户自选同步，市场内容本身经 Git 可 diff |

### 4.3 落到三支柱的硬要求

- **本地真值**：安装＝把资产解包进项目内目录（如 `.dfg/market/<type>/<slug>/`），同时更新一个可 diff 的清单缓存（字段集对齐 2.2，去掉本机绝对路径，改相对路径 + content hash）；卸载＝删除目录 + 清单回写，全部可 `git diff` 审阅。`[推断→要求]`
- **受控 AI**：市场操作（装/卸/更新/启用）与对话内代理安装，必须走「提案 → 用户确认 → 单事务写入 → 审计记录」；更新覆盖前检查本地改动（对应 `isMarketContentEdited`）。
- **数据飞轮**：卡片指标与排序键直接对接五维评分与采纳回流（安装量/使用量/收藏量/评分/最近更新），社区资产的“来源”必须可回溯到 GitHub 仓库与版本。

### 4.4 权限与能力提示的换域映射（照搬骨架）

| WorkBuddy 提示位 | 设界对应 |
|---|---|
| 需 API Key 标签 | 需连接器（Figma/MCP）/ 需配置云端 AI key / 需 ComfyUI 本地服务 |
| 安全评估（科恩实验室；安全/低/中/高） | 本地静态审计：脚本可执行文件、网络出站声明、文件写入范围声明；标注校验方为「本地审计（离线）」 |
| 高风险逐文件分析 + 卸载/保留 | 同款：安装确认页展示“该资产包含 N 个脚本 / 声明 N 项文件写入 / 出站域名清单”，一键查看 |
| 企业策略（禁装高风险/黑白名单） | 项目策略（`.dfg/policy.json`）：是否允许社区资产、是否允许脚本、离线模式 |
| 积分消耗提示 | 成本提示：预计 token 消耗档位（DeepSeek 文本上云可关闭；图像本地零成本） |
| 第三方数据外发提示 | 同款且更严：默认零出机；上云动作（文本）需逐次确认，图像永不外发 |
| 启用 >80 个技能警告 | 资产数量/上下文占用警告（超过阈值建议停用不常用资产） |

---

## 5. 缺口与未决问题（未查完，留给后续票）

1. **未运行 GUI、无界面截图**：本机 WSL 环境无法启动 WorkBuddy 界面；页面像素级布局（卡片栅格、间距）无实测证据，卡片/详情结构来自 locale 文案与 chunk 代码，属“结构与文案级”证据。`[实测，但为静态证据]`
2. **SkillHub / Knot 的后端协议未见**：本机未落盘其接口定义（可能为远程 Web 市场，本机仅见 UI 壳与 `加载 SkillHub 失败` 类文案）。「skillhub.cn」域名仅见于搜索摘要、**未证实**，勿引用。`[缺口]`
3. **付费/权益（entitlement）数据结构未细查**：存在 `paid-skill-registry`、`installed-skills-entitlement`、`plugin-account-state` 等 chunk/目录，未展开。设界 v1 不做付费，优先级低。`[缺口]`
4. **`logs/` 未深挖**：时间盒内未在日志中检索市场接口域名与埋点字段，可作为补充证据源。`[缺口]`
5. **企业 Skill 与 `visible_in`（internal/iOA）的判定逻辑**：仅见字段与文案，未见判定代码。`[缺口]`
6. **更新比对算法**：未见“版本更高”的比较实现（semver? 字符串?），仅见 `version` 字段与 `lastUpdated`。`[推断：版本比对，规则未证]`
7. **场景 `prompts` 的具体归属**（哪些场景引用了哪些技能做组合）未逐条导出；如需，可从 `scenes.json` 全量导出（29 场景 × plugins/prompts）。
8. **安装落盘目录的命名规则**：本机用户技能在 `.workbuddy\skills\<slug>\`，插件技能在 `plugins\cache\<marketplace>\<plugin>\<version>\`；市场技能落盘的具体 slug 规则未证（仅 1 条样本 `minimax-docx`）。`[部分实测]`

---

## 6. 证据文件索引（本机，只读）

- `%USERPROFILE%\.workbuddy\.skill-list-cache.json`
- `%USERPROFILE%\.workbuddy\plugins\{installed_plugins.json, known_marketplaces.json, configured-plugins.json}`
- `%USERPROFILE%\.workbuddy\plugins\marketplaces\*\...\marketplace.json`、`scenes.json`、`skills-index.json`
- `%USERPROFILE%\.workbuddy\connectors-marketplace\.codebuddy-connector\connectors.json`（283 条）
- `%USERPROFILE%\.workbuddy\.connectors-marketplace.meta.json`（来源：`https://static.workbuddy.cn/connectors-config-v2/connectors-config.zip`）
- `D:\Workbuddy\resources\app.asar`（渲染层 chunk：`skills-market-*.js`、`skills-panel-*.js`、`standalone-skill-detail-modal-*.js`、`market-*.js`；locale：`zh-cn-*.js`）
- `D:\Workbuddy\resources\app.asar.unpacked\resources\plugins\workbuddy-builtin\skills\marketplace-skill-installer\SKILL.md`
- 官方文档：`https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Skills-Market`
