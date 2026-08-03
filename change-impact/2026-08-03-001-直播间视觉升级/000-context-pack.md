# 直播间视觉升级 Context Pack

> 生成时间：2026-08-03 12:39  |  版本：1.0  |  生成者：impact + 未识别模型
>
> 导航：**000-context-pack.md** → [010-requirements.md](010-requirements.md) → [020-design.md](020-design.md) → [030-implementation.md](030-implementation.md) → [060-preflight.md](060-preflight.md) → [090-execution-record.md](090-execution-record.md) | [_active-state.md](_active-state.md)

## 1. 变更意图

- 用户原话：我想拿这个项目区直播间给别人起名 当前的UI可能还不够吸睛 如何优化 你可以使用front-design skill
- 当前假设：把「瑾瑜」的 Web UI 从东方纸笺风升级为深色大屏的吸睛现代风，适合直播间共享屏幕给观众看
- 已识别技术栈：Next.js 15.1.0 (App Router) + React 19 + TypeScript 5.7 + Tailwind CSS 3.4 + Noto Serif SC 衬线字体 + satori/resvg（服务端出图）
- 已加载技术栈规则：`profiles/frontend-nextjs.md`
- 任务规模：大（12+ 前端文件，跨「前端展示 + 导出图 + 测试」3 类）
- 成功标准：直播间投屏时核心页面（登录/取名表单/报告/历史/理念）视觉显著更吸睛；首推名巨型大字报呈现；摘要图 PNG 同步深色风；现有功能（登录/生成/下载/历史）不回归；单测与 e2e 通过
- 长期目标模式：否
- 总目标 / 当前 Step / Backlog：不适用
- 项目地图状态：过期（变更邻域无变化）— 地图 commit：非 Git 时生成 ／ 当前 HEAD：`20ef935`。地图在 git init 前生成，标「非 Git」；现已初始化仓库。地图【2】技术栈、【3】架构分层、【8】构建测试、【14】风格观察均与本次代码现状核对一致，变更邻域（app/ + src/components + src/render + tailwind/globals）无 commit 改动。

## 3. 分层上下文

| 层级 | 内容 | 结论 |
|------|------|------|
| L1 项目地图 | 小仓 95 文件；Next.js 15 App Router；app/=路由展示、src/=框架无关层；无 DB（文件系统 JSON）；测试 vitest + playwright | 地图【已核实: 源码扫描】 |
| L2 变更邻域 | 全部 UI 层：app/layout、app/page、app/login、app/name、app/reports/[id]、app/history、app/about + src/components/AppShell + src/render/summary-card + globals.css + tailwind.config | 直接修改候选 |
| L3 精准证据 | 12 个 UI 文件全部通读；e2e golden-path；docs/UI.md 现视觉规范；summary-card satori 渲染 | 已读 |

### Pathfinder 地图消费记录

| 地图事实 / 章节 | 处理方式 | Impact 复核证据 | 结论 |
|----------------|----------|-----------------|------|
| 地图【3】架构分层 | 采用（重新验证） | app/ 与 src/ 各文件逐一核对，分层一致 | 直接使用 |
| 地图【2】技术栈 | 采用（重新验证） | package.json + tailwind.config + globals.css 核对 | 直接使用 |
| 地图【8】构建运行测试 | 采用（重新验证） | pnpm scripts 核对；实际运行 e2e 复验 | 直接使用；e2e 现状已复验（见 §7） |
| 地图【14】代码风格观察 | 采用（重新验证） | 通读全部 UI 文件确认 | 直接使用 |
| 地图【9】风险区域 | 未采用（本次不涉及） | 认证/存储/部署风险与 UI 变更无关 | 排除 |
| 地图 commit | 过期（非 Git → 已 git init） | 当前 HEAD 20ef935，变更邻域无改动 | 邻域无变化 |

## 4. 相关文件和对象

| 文件/对象 | 类型 | 相关性 | 为什么相关 | 证据 |
|-----------|------|--------|------------|------|
| `app/globals.css` | ui | 3 直接修改候选 | 全站设计 token、按钮/输入类、背景、动效 | 【已核实: 通读】 |
| `tailwind.config.ts` | config | 3 直接修改候选 | 主题色板、字体族、字重 | 【已核实: 通读】 |
| `app/layout.tsx` | ui | 3 直接修改候选 | 全局字体引入（含 900 字重）、body 背景类 | 【已核实: 通读】 |
| `src/components/AppShell.tsx` | ui | 3 直接修改候选 | 导航壳、全站底色/布局容器 | 【已核实: 通读】 |
| `app/login/page.tsx` | ui | 3 直接修改候选 | 登录页品牌区布局 | 【已核实: 通读】 |
| `app/login/login-form.tsx` | ui | 3 直接修改候选 | 登录表单样式、按钮文案「进入」→「登录」 | 【已核实: 通读】 |
| `app/name/page.tsx` | ui | 3 直接修改候选 | 取名页标题区 | 【已核实: 通读】 |
| `app/name/naming-form.tsx` | ui | 3 直接修改候选 | 取名表单、生成中阶段样式 | 【已核实: 通读】 |
| `app/reports/[id]/page.tsx` | ui | 3 直接修改候选 | 报告页，首推名巨型大字报核心 | 【已核实: 通读】 |
| `app/history/page.tsx` | ui | 3 直接修改候选 | 历史列表 | 【已核实: 通读】 |
| `app/about/page.tsx` | ui | 3 直接修改候选 | 理念页 | 【已核实: 通读】 |
| `src/render/summary-card.tsx` | ui | 3 直接修改候选 | 摘要图 PNG 深色风同步，需换 900 字重 woff | 【已核实: 通读】 |
| `e2e/golden-path.spec.ts` | test | 2 影响判断候选 | data-testid 是硬契约，必须原样保留 | 【已核实: 通读】 |
| `tests/*.test.ts` | test | 1 背景参考 | domain/store 单测，UI 变更不触及 | 【已核实: vitest.config include】 |
| `docs/UI.md` | config | 1 背景参考 | 现纸笺视觉规范，本次推翻 | 【已核实: 通读】 |

## 5. 关键上下文

### 入口
- 页面：`app/page.tsx`（按登录态 redirect）、`app/login/page.tsx`、`app/name/page.tsx`、`app/reports/[id]/page.tsx`、`app/history/page.tsx`、`app/about/page.tsx`
- API：`app/api/auth/login`、`app/api/auth/logout`、`app/api/generate`、`app/api/reports/[id]/summary`

### 数据结构
- 报告 `ReportDocument`（`src/domain/types.ts`）：`overview.primaryName` / `names[]` / `notRecommended[]` / `bazi?` / `decisionAdvice` 等，本次只展示不改结构
- 无 DB，纯文件系统 JSON

### 依赖路径
- 页面 → `src/store/report-store`（getReport/listReports）、`src/auth/session`（isAuthenticated）；`src/render/summary-card`（summary route 出图）
- 本次不触碰 domain / store / auth / providers 任何逻辑

### 配置和权限
- 权限/认证：`isAuthenticated()` 逐页守卫，**完全不动**
- 环境变量：`JINYU_AUTH_*` / `LLM_*` / `JINYU_DATA_DIR`，**全部不动**
- 凭证：不涉及写入任何凭证

### 测试
- e2e：`e2e/golden-path.spec.ts` 1 条金路径，依赖 data-testid（login-form/surname/gender/submit-generate/report-page/primary-name/report-overview/download-summary/history-page）与 `getByText("王")`
- 单测：`tests/` 4 个（normalizer/gate/orchestrator/store），UI 变更不触及，用于回归确认
- 当前可达到的验证等级：V3（e2e 可运行 + 单测可运行 + build/typecheck）

### 风格规范
- `_style-rules.md` 状态：无
- `_project-map.md`【14】：已读取（8 条观察，本次设计遵循严格类型化 / 单一职责 / client 组件与路由同目录 / 测试命名）
- 风格分歧检测：本次为主动推翻 docs/UI.md 纸笺风，属用户明确授权的设计变更，非分歧
- 渐进积累：本轮无新增

### 关键链路追踪

| 链路类型 | 入口 | 追踪路径 | 发现的二级影响 |
|---------|------|---------|--------------|
| 错误处理链 | 登录失败 / 生成失败 | `login-form.tsx` error state、`naming-form.tsx` error state | 错误提示样式随设计 token 重设，`role="alert"` 保留 |
| 中间件管线 | 无 middleware | 各页面 server 组件内 `isAuthenticated()` | 不动 |
| 数据流路径 | 报告读→展示 | `reports/[id]` page → getReport → ReportDocument 渲染 | 字段结构不动，仅样式 |
| 配置依赖 | 字体加载 | `app/layout.tsx` Google Fonts、`summary-card.tsx` jsDelivr woff | 需为 900 字重补 woff URL；改 woff 有渲染风险，验证需实测摘要图 |
| 测试依赖 | e2e data-testid | golden-path 全部 testid | 硬契约，原样保留；`button name="登录"` 与现状「进入」矛盾 → 改按钮文案为「登录」修复 |

## 6. 引用检查结果

| 分类 | 文件/对象 | 影响 | 处理方式 |
|------|-----------|------|----------|
| 必须同步修改 | 12 个 UI 文件 | 不改则不达视觉目标 | 纳入实施 Step |
| 必须同步修改 | `e2e/golden-path.spec.ts:8` 按钮匹配 | e2e 当前失败（文案「进入」≠期望「登录」） | 改按钮文案为「登录」，e2e 随之通过 |
| 必须同步修改 | `src/render/summary-card.tsx` 字体 woff | 深色风需 900 字重，当前仅 400 | 换/补 woff URL 并实测渲染 |
| 只需验证 | `tests/*.test.ts` | UI 不触及，跑一遍确认无回归 | 验证项 |
| 只需验证 | data-testid 契约 | 改样式保留 testid 即通过 | 验证项 |
| 不涉及 | `app/api/*`、`src/domain/*`、`src/store/*`、`src/auth/*`、`src/providers/*` | API 契约/逻辑/权限/存储不变 | 排除 |

## 7. 已确认事实

- 用户确认：同一套 UI 整体升级，不加新页面 【用户确认】
- 用户确认：全部页面统一升级（登录/取名/报告/历史/理念）【用户确认】
- 用户确认：换更现代的吸睛风格，放弃纸笺风 【用户确认】
- 用户确认：深色大屏基调 【用户确认】
- 用户确认：色系为墨×金×朱砂红 【用户确认】
- 用户确认：首推名巨型大字报呈现 【用户确认】
- 用户确认：保留衬线大字（Noto Serif SC，避免 satori 换字体风险）【用户确认】
- 用户确认：吸睛开场动效 【用户确认】
- 用户确认：摘要图 PNG 同步换深色风 【用户确认】
- 用户确认：登录按钮文案「进入」改为「登录」 【用户确认】
- 现有视觉体系为东方纸笺风：米纸底 #f7f5f0、墨青 #00362a、铜金 #775a19、衬线宽字距、细线、窄栏 max-w-3xl 【代码推断: tailwind.config.ts:7-21 + globals.css:5-31 + docs/UI.md】
- 全站 6 页面 + AppShell 均用 Tailwind 类 + globals.css 组件类（field-input/btn-primary/btn-ghost/btn-gold/ink-divider）【代码推断: globals.css:63-82】
- e2e 当前失败：`getByRole("button", { name: "登录" })` 找不到（当前按钮文案「进入」）——HANDOFF 记载「e2e 通过」已过时 【代码推断: app/login/login-form.tsx:68 + e2e/golden-path.spec.ts:8】
- e2e data-testid 契约：login-form / surname / gender / submit-generate / report-page / primary-name / report-overview / download-summary / history-page 【代码推断: e2e/golden-path.spec.ts】
- summary-card 仅加载 1 个 woff（Noto Serif SC 400），satori 渲染 720×960 PNG 【代码推断: src/render/summary-card.tsx:6-19】
- `app/layout.tsx` 加载 Noto Serif SC 300–700 字重；900 字重需新增 【代码推断: app/layout.tsx:16】
- 无 DB 层；API 契约 `/api/generate`、`/api/reports/[id]/summary` 返回结构不动 【代码推断: app/api 各 route.ts】

## 8. 待确认问题

### 代码推断项（已自行查证，无需用户确认）

- `naming-form` 生成阶段 STAGES 文案（斟酌名字/核对约束/整理成文）可保留，仅改样式——【代码推断: naming-form.tsx:7】
- 深底无障碍对比度需按 WCAG AA 校验（米白 #F2EDE3 on 深墨 #0E1714 ≈ 13:1 通过）【代码推断: 对比度计算】

### 待用户确认项（业务决策）

- [x] 登录按钮文案改为「登录」——已获用户确认 Step 1 附带

## 9. 暂不纳入范围

| 文件/对象 | 排除原因 |
|-----------|----------|
| `app/api/*`、`src/domain/*`、`src/store/*`、`src/auth/*`、`src/providers/*` | 后端逻辑/API 契约/存储/认证不变，纯前端展示层变更 |
| `docs/UI.md` | 现视觉规范文档，本次不更新（视觉已定，文档更新可选后续） |
| `scripts/*`、`data/llm-bench-*` | LLM 基准脚本与数据，与 UI 无关 |
| `tests/*.test.ts` | domain/store 单测，UI 不触及 |
