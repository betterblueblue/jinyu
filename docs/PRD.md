# PRD: 瑾瑜（通用命名 Web · 0→1）

Status: ready-for-agent

Source intent: `docs/intent/2026-07-23-001-jinyu.md`（grill 修订版，用户已确认修改）

**Project home:** `E:\agent\jinyu\` — 产品/技术文档在 `docs/`，实现切片在 `issues/`，应用代码在仓库根下统一管理。

**Brand & slug:** 对外品牌 **「瑾瑜」**；工程/目录/包名统一用 **`jinyu`**（拼音），**不再使用** `baby-name-web`。与既有代码库 `jinyutreasury` 区分：本产品为新应用，不在 `jinyutreasury` 上补齐。

Delivery stance: **Greenfield 0→1 runtime** — 新建独立 Web 应用与代码边界；**不**在 `jinyutreasury` 代码库上补齐、挂载路由或共用其运行时/数据库。  
**文化与表达层可复用 jinyutreasury**：命名理念介绍、风格原型（prototype）文案与意象、瑾瑜气质的版式/字体/配色等，允许**移植、改编后迁入新应用**（复制源文件或重写等价物均可）。  
不可复用为产品基线的：其多轮精修主路径、开放式多场景产品壳、异步队列实现细节、与本 INTENT 冲突的交互（如默认精修、Top 海量等）。

---

## Problem Statement

准父母、亲友或起名协助者需要在浏览器里完成一次取名，并得到一份**能看、能转发摘要**的正式命名结果。现状工具要么只有聊天式三行推荐，要么报告假大空、名字网红同质化、八字胡说，要么依赖命令行/Claude Code，不适合当「交付物」保存和回看。

用户要的是：登录后填命名字段 → 一次生成结构化在线全文报告 → 可下载精选摘要图 → 历史能打开**当时那份**快照，而不是每次重算变样。

## Solution

做一个全新的网页端通用命名应用（给宝宝起名、成人改名皆可），**品牌名「瑾瑜」**（MVP 固定单账号）：

1. 打开先登录（预置唯一账号，无开放注册）。
2. 统一表单只收「命名」字段（不区分宝宝/成人，也不区分本人/代取角色）。
3. 提交后同步等待并展示阶段：候选生成 → 硬规则过滤 → 报告排版。
4. 在线展示完整正式报告（先总览名字与首推，再逐名详解，再不推荐/可选命理/决策建议）。
5. 下载图片仅为精选摘要卡（多名一行一句、首推、回看全文入口），不是 PDF、不是整报告长图。
6. 生成架构为 **LLM 出候选 + 服务端硬规则闸门**；八字默认关且表述克制；反网红 L1 硬拦 / L2 软标；辈分/避讳双硬；风格软偏好。
7. 历史列表打开生成时的全文快照，可再下摘要图。

MVP 成功口径（不纠结细指标）：**能看完整在线报告 + 能下载摘要图**。首版按 INTENT 保留能力全量交付。

## User Stories

1. As a 命名操作者, I want 在浏览器里完成取名全流程, so that 我不依赖 Claude Code 或命令行。
2. As a 命名操作者, I want 打开应用时先登录, so that 只有授权的固定账号能使用。
3. As a 系统管理员, I want 只有一个预置账号且无开放注册, so that MVP 账号体系保持极简。
4. As a 命名操作者, I want 登录后看到统一取名入口, so that 我不需要选择「本人/代取」身份。
5. As a 命名操作者, I want 只填写命名相关字段, so that 表单焦点在结果质量上。
6. As a 命名操作者, I want 必填姓氏, so that 推荐名可以组成完整姓名。
7. As a 命名操作者, I want 必填性别状态（男/女/未知）, so that 报告模板与分组策略正确。
8. As a 命名操作者, I want 选择名字是「两个字的名」或「一个字的名」且默认两个字, so that 结果字数统一、好对比。
9. As a 命名操作者, I want 同一次报告内名字字数一致, so that 摘要卡和列表不会单双混排。
10. As a 命名操作者, I want 显式选择已出生/未出生/不确定, so that 备名与已出生路径清晰。
11. As a 命名操作者, I want 未出生时可选填预产期, so that 报告可标明备名语境。
12. As a 命名操作者, I want 未出生时不能开启精确八字排盘, so that 避免用预产期胡说四柱。
13. As a 命名操作者, I want 八字/五行开关默认关闭, so that 主路径不被命理绑架。
14. As a 命名操作者, I want 打开八字后必须填公历生日, so that 排盘有最小依据。
15. As a 命名操作者, I want 开八字但无时辰时仍能出六字盘并标注精度有限, so that 我不被强制填时辰。
16. As a 命名操作者, I want 可选填辈分字及位置（默认名第一字）, so that 家族辈分被强制满足。
17. As a 命名操作者, I want 可选填避讳字, so that 禁用字绝不会出现在推荐里。
18. As a 命名操作者, I want 可选填风格/寓意偏好, so that 系统尽量往我喜欢的方向靠。
19. As a 命名操作者, I want 不填风格时仍有默认端庄耐看方向, so that 空表单也能出合理结果。
20. As a 命名操作者, I want 「尽量避开热门名」默认开启, so that 默认少网红模板。
21. As a 命名操作者, I want 关闭避开热门时只放松轻度热门限制而仍拦截最烂大街模板, so that 松绑有边界。
22. As a 命名操作者, I want 提交后一次生成完整在线报告, so that 我不必多轮精修。
23. As a 命名操作者, I want 等待时看到阶段提示（候选→过滤→排版）, so that 我知道系统在忙什么。
24. As a 命名操作者, I want 超时或失败后可以重试, so that 偶发失败不堵死。
25. As a 命名操作者, I want 候选不足时系统先有限重试再仅放宽软约束并注明, so that 尽量出满又不破坏硬规则。
26. As a 命名操作者, I want 仍不足时看到失败原因（辈分/避讳/热门等）并回去改表单, so that 我知道怎么放宽。
27. As a 命名操作者, I want 系统永不拿 L1 黑名或避讳字或缺辈分的名来凑数, so that 结果可信。
28. As a 命名操作者, I want 报告里有明确的推荐姓名列表, so that 不是只有空分析。
29. As a 命名操作者, I want 性别已知时大约 3～5 个精选名, so that 决策负担可控。
30. As a 命名操作者, I want 性别未知时男向+女向分组约 4～5 个, so that 两边都有备选。
31. As a 命名操作者, I want 报告说明未知性别时出生后按性别收窄, so that 预期清晰。
32. As a 命名操作者, I want 在线报告先看到总览（首推+名单+一句话建议）, so that 我先抓住结论。
33. As a 命名操作者, I want 每个名字有音韵与字形说明, so that 我知道好不好念、好不好写。
34. As a 命名操作者, I want 每个名字有寓意与出处说明, so that 内容具体不空。
35. As a 命名操作者, I want 系统不保证出处零幻觉且首版无字典核验, so that 预期诚实（提示约束模型即可）。
36. As a 命名操作者, I want 每个名字有实用避坑说明, so that 谐音多音等问题被点明。
37. As a 命名操作者, I want 报告有不推荐/淘汰说明, so that 我知道为何不走常见烂大街路线。
38. As a 命名操作者, I want 开启八字时报告有命理摘要且措辞克制, so that 有参考但不胡说定论。
39. As a 命名操作者, I want 未开八字时报告不出现精确四柱表演, so that 界面干净。
40. As a 命名操作者, I want 有决策建议（首推与备选定位）, so that 我更好选。
41. As a 命名操作者, I want 未出生报告标明备名, so that 不与已出生定名混淆。
42. As a 命名操作者, I want L1 网红组合绝不能进推荐列表, so that 「名字太网红」痛点被硬处理。
43. As a 命名操作者, I want L2 偏热名字可出现但默认不进首推并有标记, so that 热度风险可见。
44. As a 命名操作者, I want 可下载精选摘要图, so that 方便转发带走。
45. As a 命名操作者, I want 摘要图含 3～5 名（或男女组）各一行一句、首推标记、回看全文入口, so that 图是摘要不是假完整件。
46. As a 命名操作者, I want 摘要图不塞满音韵出处命理全文, so that 图可读。
47. As a 命名操作者, I want 完整正式内容在在线页与历史快照中, so that 「正式报告」心智正确。
48. As a 命名操作者, I want 历史列表看到时间、姓、性别、名摘要, so that 我能找到某次生成。
49. As a 命名操作者, I want 点进历史看到生成时的全文快照且不重新跑模型, so that 内容稳定可回看。
50. As a 命名操作者, I want 在历史详情再次下载摘要图, so that 不必重新生成。
51. As a 命名操作者, I want 登出后不能继续取名, so that 固定账号边界成立。
52. As a 命名操作者, I want 错误信息用白话说明缺什么字段, so that 我能快速修正。
53. As a 命名操作者, I want 生成中避免重复狂点造成混乱请求, so that 体验稳定。
54. As a 命名操作者, I want 软偏好贴合不足时报告仍出满推荐并说明, so that 风格不会导致硬失败。
55. As a 命名操作者, I want 填了辈分时每个推荐名都含辈分字, so that 家族规则不被模型忽略。
56. As a 命名操作者, I want 单字名模式下辈分规则仍可执行, so that 一字名场景可用。
57. As a 命名操作者, I want 多音高风险字被闸门处理或标注, so that 日常误读风险下降。
58. As a 系统维护者, I want L1/L2 名单可配置维护, so that 热门趋势可迭代而不改核心代码。
59. As a 系统维护者, I want LLM 调用可替换/可 mock, so that 测试与本地开发不依赖真实模型。
60. As a 系统维护者, I want 硬规则与 LLM 解耦, so that 规则行为可单测且不被 prompt 漂移吞掉。
61. As a 命名操作者, I want 不做多轮精修流程, so that 首版交互保持「一次交付」。
62. As a 命名操作者, I want 不要 Top20 打分海表, so that 结果保持精选。
63. As a 命名操作者, I want 不要 PDF/多格式导出, so that 首版交付形态单一清晰。
64. As a 命名操作者, I want 不要付费墙, so that MVP 无商业化打扰。
65. As a 产品实现者, I want 新建独立应用目录 `jinyu/` 与依赖, so that 运行时与 jinyutreasury 解耦，且工程名与品牌瑾瑜一致（不用 baby-name-web）。
66. As a 产品实现者, I want 可借鉴 baby-name-skill / skills-baby-name 的规则思想与词表, so that 领域质量有起点但不当迁移基线。
66a. As a 命名操作者, I want 产品品牌显示为「瑾瑜」, so that 与既有文化认知一致。
66b. As a 命名操作者, I want 看到瑾瑜气质的命名理念介绍, so that 产品不像冷冰冰的表单工具。
66c. As a 命名操作者, I want 风格选择呈现为有意象的原型卡片而非干巴标签, so that 偏好表达更有文化与可感性。
66d. As a 产品实现者, I want 从既有 jinyutreasury 工程移植介绍文案、风格原型与视觉语言并改编进新应用 `jinyu/`, so that 有文化底子又不绑旧运行时。
67. As a 命名操作者, I want 报告语气正式、少空话套话, so that 内容像可交付说明而非聊天。
68. As a 命名操作者, I want 首推在总览与摘要图上一致可识别, so that 决策信号统一。
69. As a 命名操作者, I want 放宽软约束时在报告中看到「已放宽 XX」说明, so that 过程透明。
70. As a 命名操作者, I want 关闭浏览器后用同一账号仍能看历史快照, so that 交付物可沉淀。

## Implementation Decisions

### Product / architecture stance

1. **Greenfield runtime**：新建独立 Web 应用，目录与包名定为 **`jinyu/`**（勿用 `baby-name-web`）。禁止把现有 `jinyutreasury` 代码库作为运行时依赖、路由宿主、共享 DB 或「在其上补齐」的基线。
2. **品牌：瑾瑜**：所有用户可见文案、导航标题、关于页、摘要图角标、浏览器标题等统一使用 **「瑾瑜」**；英文 slug 仅用 `jinyu`，与品牌对应。
3. **文化层主动复用 jinyutreasury（鼓励）**：下列内容应优先从 `jinyutreasury` **移植并改编**进新应用 `jinyu/`，品牌保持瑾瑜：
   - **命名介绍 / 关于页**：如「名字是父母写给孩子的第一封信」、使用说明、隐私说明等（须按本产品改写：一次报告、摘要图、固定单账号、无多轮精修主推等）。
   - **风格原型（style prototypes）**：当前实现为 4 个用字特征型风格（古典雅致/自然清灵/大气端庄/现代简洁），每个含名称、意象、soft-prompt 与关键词（见 `src/config/style-prototypes.ts`；原计划可迁 jinyutreasury 的风格卡片，现以表单下拉落地）。
   - **视觉文化**：墨色/留白、字距、标题气质、divider 等设计语言；迁 design tokens 与关键展示组件即可。
   - 迁入方式：复制进新应用后维护；**不** `import` 旧 jinyutreasury 包。
4. **领域与 skill**：`baby-name-skill` / `skills-baby-name` 仍作规则与闸门思路参考；与 jinyutreasury 的规则引擎若有可抄算法，同样**迁入后独立维护**。
5. **MVP 全量**：按 INTENT 保留项交付；无「二期缓冲」作为砍 scope 的默认借口（工期压力应显式变更 INTENT，而非静默漏做）。

### Auth & tenancy

4. **固定单账号**：环境/配置预置用户名与密码（或等价密钥）；无注册、无邀请码、无多租户。
5. **先登录后用**：未登录访问取名/生成/历史/导出均拒绝并导向登录。
6. **会话**：服务端 session 或签名 cookie 即可；实现可选，但须可登出。

### Domain modules（逻辑边界，非强制文件路径）

7. **Form / Request Normalizer**：校验必填与条件必填；规范化出生状态、字数模式、八字开关、辈分位置、热门开关等。非法输入不得进入生成。
8. **LLM Candidate Provider（端口）**：输入规范化请求 → 输出原始候选名+草稿解释；必须可替换为 FakeProvider 做测试。
9. **Hard Rule Gate**：对候选执行 L1 丢弃、L2 打标、辈分必须、避讳丢弃、字数统一、多音/禁忌等；输出「可进报告的候选 + 淘汰原因」。
10. **Soft Preference Ranker**：风格/寓意软排序与贴合说明；不得单独导致硬失败。
11. **Bazi Optional Engine**：仅开关打开且允许排盘时运行；未出生/预产期拒绝精确排盘；无时辰六字+精度有限；输出克制摘要 DTO，禁止「必然用神/铁口」文案。
12. **Report Assembler**：将过闸候选 + 可选八字摘要 + 淘汰说明 → **Report Document**（固定章节顺序）。这是在线页与快照的单一事实来源。
13. **Generation Orchestrator**：同步阶段状态机：`candidates → filter → assemble`；有限重试；A+ 放宽策略；超时；错误映射为用户可读原因。
14. **Report Store**：持久化 Report Document 快照 + 列表索引字段；读取历史不得重跑 LLM/闸门。
15. **Summary Card Renderer**：Report Document → 摘要卡图片字节流；只含名单层信息与回看入口。
16. **Config Lists**：L1 组合/模板、L2 单字等外部化数据，便于维护。

### Report document shape（决策级）

17. 在线报告章节顺序固定：
    - Overview（首推、名单、一句话建议）
    - Per-name details（音韵字形、寓意出处、避坑、风格贴合、L2 标记等）
    - Not-recommended / eliminated
    - Bazi summary（仅开启时）
    - Decision advice（可与 overview 呼应）
18. 推荐数量：性别已知约 3–5；未知男/女分组总量约 4–5。
19. 摘要卡字段：各名一行+一句、首推标记、回看全文入口（链接或等价）；不含 C25–C30 全文。

### Generation & failure policy

20. 架构：**LLM + 硬规则闸门**（非纯 LLM 终局）。
21. 候选不足：有限自动重试 → 仅自动放宽软约束（风格硬贴合、L2 可进首推）并写入「已放宽」→ 仍不足则失败，提示改表单。
22. **永不放宽**：L1、避讳、辈分必含、未出生禁精确八字、字数模式。
23. 出处：首版无字典/词表核验工具；prompt 约束即可；产品文案不承诺零幻觉。

### API / UX interactions（逻辑）

24. 主要页面：登录、取名表单、生成中（阶段）、报告详情、历史列表、历史详情。
25. 生成交互：表单提交后同步等待（可同页或过渡页），展示阶段；成功进入报告详情并写入历史。
26. 导出：在报告详情与历史详情提供「下载摘要图」。
27. 不做：开放注册、付费、PDF、Top20 排行、多轮精修、多用户协作。

### Tech choices（建议默认，非不可变）

28. 任选主流全栈方案（例如 Node/TS 全栈或 Python API + 简单前端），但须满足：可跑自动化测试、可存快照、可调 LLM、可导出图片。
29. 数据存储：本地文件 DB 或 SQLite 级即可（单用户）。
30. 密钥：LLM API Key、预置账号均来自环境变量/本地配置，不入库明文展示。

## Testing Decisions

### What makes a good test

- 只断言**外部行为**与**模块端口契约**：给定输入 → 可观察输出/错误码/文档结构。
- 不断言 LLM 原文辞藻、不绑定私有函数名、不要求真实外网 LLM。
- 硬规则用表驱动用例（L1 名、避讳、辈分、字数）。
- 编排层用 Fake LLM：返回可控候选集，验证过滤与 A+ 与失败。

### Test seams（0→1 新应用内的高层检查点）

| Seam | 断言重点 |
|---|---|
| Request Normalizer | 必填/条件必填；未出生禁开精确八字；字数模式 |
| Hard Rule Gate | L1/L2、辈分、避讳、禁止凑数 |
| Soft Preference | 有/无偏好时仍能出满；贴合说明字段存在 |
| Bazi Engine（可选路径） | 关则无摘要；开+无时辰精度有限；未出生拒绝精确盘 |
| Report Assembler | 章节顺序；数量与分组；首推一致 |
| Orchestrator | 阶段顺序；重试；A+；超时/失败原因 |
| Auth | 未登录拒绝；预置账号可登录 |
| Report Store | 写入快照后读取不变；不触发 LLM |
| Summary Card | 含名单/首推/入口；不含全文块 |
| E2E 金路径（1 条） | 登录→填表→报告→下载图→历史回看（LLM fake） |

### Prior art

- 本仓库 `jinyutreasury` 有同类领域测试风格（规则引擎、八字、API 合同、Playwright），**可作测试写法参考**，但 **0→1 应用不得依赖其测试运行时或源码路径**。
- skill 目录无 Web 测试框架；新应用自建最小测试脚手架（单元 + 一条 E2E）。

### Modules under test

- Normalizer、Gate、Bazi（若实现）、Assembler、Orchestrator、Store、Auth、Summary export adapter。
- UI 以 E2E 金路径覆盖主流程即可，避免重组件快照测试。

## Out of Scope

- 在 `jinyutreasury` 上增量改造、路由嵌入、共享数据库或把新 INTENT 做成其一个 scene 补丁。
- **不在范围**：把 jinyutreasury 整站 fork 当产品壳（含其精修主路径、多场景首页产品定义原样照搬）。**在范围**：移植其介绍/原型/视觉文化到新应用。
- 开放注册、OAuth、多用户、团队协作、权限角色。
- 付费、次数墙、运营后台（超出固定账号配置以外）。
- PDF / Word / 多格式导出；整页长图作为「完整报告」。
- Top20 排行榜、多维打分表、多轮精修对话。
- 字典/康熙自动出处核验工具（INTENT C35 已降级）。
- 本人/代取双角色产品分流。
- 真太阳时、复杂格局用神定论、专业命理咨询责任。
- 三字名、复姓专项、中英双语名、小名独立产品线。
- 移动原生 App、小程序（除非实现时主动选择同一后端，但非本 PRD 必达）。
- 性能压测、多地区合规审计、无障碍完整认证（基线可用即可）。

## Further Notes

### Intent 核对（本 PRD 阶段）

| 保留能力 | 本 PRD |
|---|---|
| C01 网页端流程 | 已体现 |
| C02 在线正式报告结构 | 已体现 |
| C03 可带走（摘要图+在线/快照） | 已体现 |
| C06 可裁剪重构 / 全量首发 | 已体现（0→1 且全量） |
| C07 统一入口 | 已体现 |
| C08 命理克制 | 已体现 |
| C09 反网红分层 | 已体现 |
| C12/C31 精选摘要图 | 已体现 |
| C13 表单+LLM 闸门 | 已体现 |
| C14/C16/C17/C18/C19 | 已体现 |
| C20/C21/C24/C25–C30 | 已体现 |
| C33 固定账号+历史快照 | 已体现 |
| C35 无核验工具 | 已体现（诚实降级） |
| C36 字数 S | 已体现 |
| 放弃项 C04/C05/C10/C11/C15/C22/C23/C32/C34 | 明确 Out of Scope |

不可妥协项：无。

本 PRD 相对 INTENT 的实现向澄清（非新能力承诺）：Greenfield **运行时**独立；**文化层**明确鼓励复用 jinyutreasury 的介绍/风格原型/视觉；模块边界、测试 seam、Fake LLM、配置化 L1/L2。若实现阶段要改这些，需用户确认。

用户补充（对话）：
- 「系统命名介绍和原型页还是想复用 jinyutreasury 更有文化」——文化层复用。
- 「品牌名也沿用瑾瑜」——对外品牌固定为瑾瑜。
- 「baby-name-web 也要改」——工程/目录/包名改为 `jinyu`，废弃 `baby-name-web`。
- 文档统一迁至 `E:\agent\jinyu\`（INTENT + PRD 现位于 `docs/`）。

### Suggested next steps

1. `/to-issues` 或人工按模块拆 issue（路径 `E:\agent\jinyu\issues\`，已就绪）。
2. 先落地 Normalizer + Gate + Assembler + Fake LLM 金路径，再接真 LLM。
3. 应用脚手架建在 `E:\agent\jinyu\`（或该目录下 `app/` 子目录）；技术栈见 `docs/TECH.md`。

### Glossary（本 PRD 用语）

- **正式报告 / 在线全文**：浏览器中的完整 Report Document 渲染。
- **精选摘要卡**：可下载图片，仅名单层摘要。
- **硬规则闸门**：服务端确定性过滤/标记，优先于模型自觉。
- **L1 / L2**：反网红硬拦 / 软标分层。
- **A+ 放宽**：仅软约束可自动放宽；硬规则永不放宽。
- **快照**：生成完成时固化的 Report Document，历史回看不重算。
