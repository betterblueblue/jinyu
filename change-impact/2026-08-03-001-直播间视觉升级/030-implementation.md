# 直播间视觉升级 实施文档

> 生成时间：2026-08-03 12:39  |  版本：1.0  |  生成者：impact + 未识别模型
>
> 导航：[010-requirements.md](010-requirements.md) → [020-design.md](020-design.md) → **030-implementation.md** → [060-preflight.md](060-preflight.md) → [090-execution-record.md](090-execution-record.md) | [_active-state.md](_active-state.md)

## 1. 实施顺序

1. 设计 token 层：D01 tailwind 配置 → D02 globals.css → D03 layout 字体（先建 token，页面才有得用）
2. 全局壳：D04 AppShell
3. 各页面：D05/D06 登录 → D07/D08 取名 → D09 报告 → D10 历史 → D11 理念
4. 摘要图：D12 summary-card（独立验证渲染）
5. 验证：单测 + e2e + build/typecheck

## 2. 前置检查清单

- [x] 分析依据中的待确认问题已处理（登录按钮文案已确认）
- [x] 当前假设、歧义和成功标准已确认
- [x] 精准修改边界已确认（仅 UI 层 12 文件）
- [x] status/enum/常量/错误码/权限/配置键等语义约定：本次不涉及，按钮文案为文案改动
- [ ] 依赖服务状态确认（不涉及外部依赖）
- [ ] 数据库备份状态确认（不涉及 DB）
- [ ] 锁策略/停机窗口确认（不涉及）
- [x] 回滚方案准备完毕（git checkout）
- [x] `_active-state.md` 已创建
- [x] 破坏性操作已单独确认（无 DROP/DELETE/RENAME；文案修改已确认）

## 2.1 改动完整性自检

| 验收标准（来自 010） | 对应 Step | 覆盖状态 |
|---------------------|----------|---------|
| 验收 1：登录页深色 + 按钮「登录」+ 登录可完成 | Step 3（D05/D06）+ e2e | ✅ |
| 验收 2：取名表单深色可填 + 生成动效 + 跳转 | Step 4（D07/D08）+ e2e | ✅ |
| 验收 3：报告页巨型首推名 + 三个入口可用 | Step 5（D09）+ e2e | ✅ |
| 验收 4：历史页深色可读可点 | Step 6（D10） | ✅ |
| 验收 5：理念页深色可读 | Step 6（D11） | ✅ |
| 验收 6：摘要图深色 PNG 含首推名与备选 | Step 7（D12） | ✅ |
| 验收 7：e2e 通过 + 14 单测不回归 | Step 8（验证） | ✅ |

## 2.2 设计到实施的对照

| 设计项（来自 020） | 对应 Step | 覆盖状态 |
|---|---|---|
| D01 tailwind 配置 | Step 1 | ✅ 已覆盖 |
| D02 globals.css | Step 2 | ✅ 已覆盖 |
| D03 layout 字体 | Step 1 | ✅ 已覆盖 |
| D04 AppShell | Step 3 | ✅ 已覆盖 |
| D05 login page | Step 3 | ✅ 已覆盖 |
| D06 login-form | Step 3 | ✅ 已覆盖 |
| D07 name page | Step 4 | ✅ 已覆盖 |
| D08 naming-form | Step 4 | ✅ 已覆盖 |
| D09 reports page | Step 5 | ✅ 已覆盖 |
| D10 history page | Step 6 | ✅ 已覆盖 |
| D11 about page | Step 6 | ✅ 已覆盖 |
| D12 summary-card | Step 7 | ✅ 已覆盖 |

## 3. 执行步骤

### Step 1: 设计 token 层（tailwind 配置 + 布局字体）

- **设计项**：D01、D03
- **维度**：前端 UI
- **文件**：`tailwind.config.ts`、`app/layout.tsx`
- **风格约束**：
  - styling token 集中在配置，不散落硬编码（`tailwind.config.ts:5-22` 现有扩展模式）
  - rendering_boundary layout 为 Server Component（`app/layout.tsx:9`）
- **操作**：
  - `tailwind.config.ts`：colors.extend 替换为深墨色板 `ink-950/ink-900/paper/paper-dim/gold/cinnabar`；fontFamily.serif 增 `weight: 900` 支持
  - `app/layout.tsx`：Google Fonts href 增 `;900` 字重
- **影响范围**：全站色板与字体
- **回滚方式**：git checkout 两个文件
- **语义约定**：色板名全新，无 enum/状态
- **验证方式**：typecheck + 页面加载肉眼校验
- **确认类型**：改代码

### Step 2: 全局样式（globals.css）

- **设计项**：D02
- **维度**：前端 UI
- **文件**：`app/globals.css`
- **风格约束**：
  - styling 组件类集中在 globals.css（`globals.css:63-82` 现有 btn-*/field-* 模式）
  - accessibility 焦点可见 + prefers-reduced-motion
- **操作**：body 深墨底；`field-input` 深底浅字；`btn-primary` 朱砂底；`btn-gold`/`btn-ghost` 金描边深底；新增开场浮现与墨滴动效 keyframes（尊重 reduced-motion）
- **影响范围**：全站组件类
- **回滚方式**：git checkout
- **语义约定**：不涉及
- **验证方式**：typecheck + 肉眼
- **确认类型**：改代码

### Step 3: 登录页 + 全局壳（AppShell / login page / login-form）

- **设计项**：D04、D05、D06
- **维度**：前端 UI
- **文件**：`src/components/AppShell.tsx`、`app/login/page.tsx`、`app/login/login-form.tsx`
- **风格约束**：
  - styling 原子类 + 组件类组合（现有模式）
  - test data-testid 保留（`login-form.tsx:38`）
  - naming 按钮类沿用 btn-* 前缀
- **操作**：
  - AppShell：深墨壳、金 hover、激活态朱砂下划线；`min-h-screen` 底为 ink-950
  - login page：深底品牌区 + 金描边
  - login-form：深底输入 + 按钮文案「进入」→「登录」
- **影响范围**：登录流程视觉
- **回滚方式**：git checkout
- **语义约定**：按钮文案改动（已确认）
- **验证方式**：e2e 登录段 + 肉眼
- **确认类型**：改代码

### Step 4: 取名页（name page / naming-form）

- **设计项**：D07、D08
- **维度**：前端 UI
- **文件**：`app/name/page.tsx`、`app/name/naming-form.tsx`
- **风格约束**：
  - styling 深底卡片 + 金描边
  - rendering_boundary 表单保留 client 组件（`naming-form.tsx:1`）
  - test data-testid 保留
- **操作**：标题区深色；表单分组改深墨卡片 + 金色描边 + 留白；生成中阶段改墨滴式推进动效
- **影响范围**：取名流程视觉
- **回滚方式**：git checkout
- **语义约定**：STAGES 文案不动（`naming-form.tsx:7`）
- **验证方式**：e2e 表单段 + 肉眼
- **确认类型**：改代码

### Step 5: 报告页（reports/[id] page）

- **设计项**：D09
- **维度**：前端 UI
- **文件**：`app/reports/[id]/page.tsx`
- **风格约束**：
  - styling 巨型字用 clamp 响应式（现 5xl→6xl 处，`reports/[id]/page.tsx:52-56`）
  - test data-testid 保留（primary-name / report-page / report-overview / download-summary）
- **操作**：首推名改巨型 clamp 大字（~5rem→8rem）+ 900 字重 + 金晕浮现动效；章节改深底卡片 + 金色左线
- **影响范围**：报告页（直播核心）
- **回滚方式**：git checkout
- **语义约定**：不涉及
- **验证方式**：e2e 报告段 + 肉眼
- **确认类型**：改代码

### Step 6: 历史页 + 理念页（history / about）

- **设计项**：D10、D11
- **维度**：前端 UI
- **文件**：`app/history/page.tsx`、`app/about/page.tsx`
- **风格约束**：
  - styling 深底列表 + 金 hover
  - test data-testid 保留（history-page）
- **操作**：列表行深底 + 金色 hover 高亮；理念文案深底可读
- **影响范围**：历史/理念视觉
- **回滚方式**：git checkout
- **语义约定**：不涉及
- **验证方式**：e2e 历史段 + 肉眼
- **确认类型**：改代码

### Step 7: 摘要图（summary-card）

- **设计项**：D12
- **维度**：前端 UI + 服务端出图
- **文件**：`src/render/summary-card.tsx`
- **风格约束**：
  - styling 与线上页同 token；satori 仅支持字重 400（`summary-card.tsx:281-288` fonts 数组）
- **操作**：背景改深墨、文字米白/金/朱砂；字体加载改 900 字重 woff（jsDelivr noto-serif-sc 900），失败回退 700/400 二次 fetch（沿用现有 fallback 模式 `summary-card.tsx:9-18`）
- **影响范围**：下载的 PNG 摘要图
- **回滚方式**：git checkout + 实测回归
- **语义约定**：不涉及
- **验证方式**：手动下载 PNG 目检 + 字体加载日志
- **确认类型**：改代码

### Step 8: 验证

- **设计项**：流程步骤，不改业务对象
- **维度**：验证
- **文件**：无（运行命令）
- **操作**：
  1. `pnpm test`（14 单测回归）
  2. `pnpm e2e`（金路径：登录→填表→报告→下载图→历史）
  3. `pnpm typecheck` / `pnpm build`
- **影响范围**：无
- **回滚方式**：不适用
- **语义约定**：不涉及
- **验证方式**：命令退出码 + 输出摘录
- **确认类型**：验证（非写操作）

## 3.2 API 方法验证

> §3 执行步骤引用的已有代码库方法（不含本次新增）：

| 方法名 | 来源文件 | grep 验证 | 异常行为 | 验证标注 |
|--------|---------|----------|---------|---------|
| 无——本次全部为 Tailwind 类/HTML 元素/`new Date`/satori 调用，不调用业务方法 | — | — | — | 已确认 |

说明：Step 1–7 均为样式与文案修改，通过 Tailwind 原子类、globals.css 组件类、JSX 元素实现，不调用任何已有业务方法。`new Date()` 仅在 `reports/[id]/page.tsx:28` 展示时间戳，本次不改动该逻辑。satori/Resvg 为第三方库构造调用（现有），本次仅改 `element` 对象字面量。

## 4. 回滚方案

### 逐步骤回滚

- Step 1–7 每步：`git checkout <文件>` 恢复该文件到提交 20ef935 状态
- Step 7 摘要图：若新 woff 渲染异常，单独 `git checkout src/render/summary-card.tsx`

### 组合回滚顺序

```
任意步失败：
  1. git checkout 该步涉及文件（独立，无跨文件依赖冲突——均为样式/文案）
  2. 摘要图 Step 7 失败不阻塞 Step 1-6（页面与出图独立）
全部成功想回滚：倒序 git checkout（Step 7 → 6 → 5 → 4 → 3 → 2 → 1）
```

## 5. 验证步骤

### 正向用例（功能正常）
- [ ] 登录页深色 + 按钮「登录」→ 用 e2e 用户名/密码可登录
- [ ] 取名表单深色可填 → 提交生成 → 跳转报告页
- [ ] 报告页巨型首推名显示 → 下载摘要图 → 深色 PNG
- [ ] 历史列表可回看 → 理念页可读

### 错误用例（异常边界）
- [ ] 登录输错密码 → 错误提示深色样式可读（role="alert" 保留）
- [ ] 表单缺姓氏提交 → 校验拦截不崩溃
- [ ] 摘要图字体加载失败 → 回退 700/400 woff 仍出图（沿用现有 fallback）

### 其他验证
- [ ] 单测回归：`pnpm test` 14 条通过
- [ ] e2e：`pnpm e2e` 金路径通过
- [ ] `pnpm build` 通过（服务端出图不报错）

## 6. E2E / 验证脚本

脚本路径：`change-impact/2026-08-03-001-直播间视觉升级/050-validation/`

说明：沿用项目现有验证命令（`pnpm test` / `pnpm e2e` / `pnpm build`），不新增独立脚本。e2e golden-path 已覆盖登录→填表→报告→下载图→历史五段全链路。

## 7. 实施时间线

| 步骤 | 预计耗时 | 里程碑 |
|------|---------|--------|
| Step 1-2（token + 全局样式） | 短 | 全站底色就绪 |
| Step 3-6（各页面） | 中 | 视觉统一 |
| Step 7（摘要图） | 中 | 摘要图深色风 |
| Step 8（验证） | 中 | e2e + 单测通过 |

## 8. 跨会话恢复状态

状态文件：`change-impact/2026-08-03-001-直播间视觉升级/_active-state.md`。恢复时必须先读状态文件、本实施文档、060-preflight 和 090-execution-record，复核磁盘状态并重新要求当前对话中的 `确认 Step N`。

## 9. 环境备选路径

| 计划验证 | 环境缺失场景 | 备选方案 |
| --- | --- | --- |
| `pnpm e2e` | 无浏览器/Playwright 环境 | 降级为 `pnpm build` + 手动浏览器目检 + 静态检查 data-testid 保留 |
| `pnpm test` | vitest 不可用 | 降级为 typecheck + 静态确认 UI 未触及 domain/store |
| 摘要图字体渲染 | jsDelivr 网络不可用 | 沿用现有 fallback 链（satori 二次 fetch），标注渲染未实机验证 |

## 10. 判档决策表

| 维度 | 用户关键词 | 覆盖范围 | 缺口 | 判档依据 |
|------|-----------|----------|------|---------|
| 视觉升级 | 吸睛、深色大屏 | 全站 6 页面 + 导航壳 + 摘要图共 12 文件 | 无（用户确认全部页面统一） | full：12+ 文件、跨前端/出图/测试 3 类、e2e 契约需防回归 |
| 按钮文案 | 登录 | login-form 按钮 | 无 | 文案修改（e2e 既有失败），已确认 |
| 动效 | 吸睛开场动效 | globals.css + naming-form + reports page | 无 | CSS 动效，尊重 reduced-motion |
