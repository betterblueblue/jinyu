# UI 风格决议（瑾瑜 / jinyu）

Status: decided  
Date: 2026-07-23  
Source: PRD 文化层复用 + jinyutreasury 实装对照；用户确认写入本文件。

## 一句话

**青玉冷调 / 纸墨现代折中**：青玉冷白底（非米黄）、墨青三阶文字、青玉与朱砂双点缀、衬线标题、大留白、细线分隔、纸张颗粒纹理。像一块温润青玉、一份可交付的命名文书，清新优雅，不是 SaaS 仪表盘。

品牌对外一律 **「瑾瑜」**；工程 slug 为 `jinyu`。

## 设计原则

1. **青玉冷白底 + 极淡纸张颗粒**，不偏黄、不大色块渐变后台风  
2. **衬线标题、字距略开**；正文宽松行高；墨青三阶（标题浓墨青黑 / 正文青灰 / 辅助淡青灰）  
3. **细线框 / 左边线引用**，少大圆角、少重阴影（近无，仅极淡浮起）  
4. **双点缀克制**：青玉主强调（首推 / 选中 / 链接）、朱砂次强调（按钮 / 星号 / 印章）  
5. **窄栏居中**（约 `max-w-2xl`～`max-w-3xl`），避免过宽疲劳  
6. **摘要图**（可转发 PNG）固定青玉浅色卡，与在线页同气质，不随主题切换  
7. **取名表单提供风格选择**：风格下拉（6 种）可选，不选时默认「端庄耐看」  
8. **浅色 / 深色双主题**：CSS 变量切换（`:root` 浅色 / `[data-theme="dark"]` 深青墨），右上角切换钮，默认跟随系统偏好  

## 与旧站关系

| 可复用（复制进本仓库后独立维护） | 不可复用为产品壳 |
|---|---|
| 配色 tokens、字体、ink-divider、纸纹 | 多场景首页 IA |
| StyleProfile 意象卡交互 | 多轮精修主路径 UI |
| style-prototypes 文案与 soft-prompt 方向 | 收藏/复盘/telemetry 原样照搬 |
| 诗笺式报告阅读节奏 | 异步队列/产品壳依赖 |

迁入方式：**复制后改编**，禁止 `import` jinyutreasury 包。

参考源路径（本机）：

- `D:\MyPythonProject\awsome-skill\jinyutreasury\app\globals.css`
- `D:\MyPythonProject\awsome-skill\jinyutreasury\tailwind.config.js`
- `D:\MyPythonProject\awsome-skill\jinyutreasury\components\StyleProfileCard.tsx`
- `D:\MyPythonProject\awsome-skill\jinyutreasury\lib\formal\style-prototypes\*`
- `D:\MyPythonProject\awsome-skill\jinyutreasury\原型相关\瑾瑜-jǐn-yú\src\index.css`
- 设计说明：`...\docs\plans\2026-04-15-poetic-ui-sync-design.md`

## Design tokens（实现默认）

### 颜色（青玉冷调，CSS 变量双套）

浅色（`:root` 默认）与深色（`[data-theme="dark"]`）各一套，页面用语义色名（`gold`/`cinnabar`/`paper`/`bg`…），切主题自动变色。实现见 `app/globals.css`。

| Tailwind 语义名 | CSS 变量 | 浅色值 | 用途 |
|---|---|---|---|
| `bg` | `--bg` | `oklch(0.973 0.004 157.2)` | 青玉冷白页面底 |
| `surface` | `--surface` | `oklch(1 0 0)` | 卡片 / 分组底 |
| `surface-low` | `--surface-mid` | `oklch(0.95 0.007 174.4)` | 浅区、hover |
| `paper`（主字） | `--fg` | `oklch(0.326 0.033 171.1)` | 浓墨青黑：标题 / 首推名 |
| `on-surface-variant`（正文） | `--body` | `oklch(0.432 0.019 171.8)` | 正文青灰 |
| `outline` / `paper-dim`（次要） | `--muted` | `oklch(0.535 0.019 168)` | 辅助淡青灰 |
| `faint`（最淡） | `--faint` | `oklch(0.647 0.019 164.3)` | 最弱说明 |
| `gold`（主强调） | `--accent` | `oklch(0.491 0.055 173.8)` | 青玉：首推 / 选中 / 链接 / 图标 |
| `cinnabar`（次强调） | `--seal` | `oklch(0.581 0.161 30.1)` | 朱砂：主按钮 / 必填星号 / 印章 |
| `outline-variant`（边框） | `--border-strong` | `oklch(0.836 0.018 164.6)` | 细线边框 |
| `--border` | — | `oklch(0.918 0.009 161.3)` | 最淡分隔线 |

深色（`[data-theme="dark"]`）：背景深青墨（`oklch(0.229 0.021 174.5)`）、文字反向三阶（`--fg` 亮纸色）、青玉/朱砂用浅调（`--accent` 提亮）。

背景叠极淡纸张颗粒（SVG 噪点，`--grain`）+ 极淡径向光，非渐变海报。

### 字体

- 家族：**Noto Serif SC**（回退 Source Han Serif SC / Songti SC / serif）  
- 标题：衬线 + 略宽字距（如 `tracking-widest`）  
- 正文：衬线或同系，行高宽松  

### 分隔与装饰

- **ink-divider**：横向 1px，中间 `outline-variant` 半透明、两端透明的渐变线  
- 引用/说明块：`border-l-2` + 左侧淡线 + `pl-4`，不用大色块  
- 圆角：优先 `rounded-sm` 或小圆角；避免 `rounded-2xl/3xl` 互联网感  
- 阴影：默认无重阴影；选中态可用极轻 `shadow-sm`  

### 动效（可选、克制）

- 入场可用轻微 `inkFadeIn`（淡入 + 微位移），时长约 1s 级，勿花哨循环  
- 生成中阶段提示保持安静，进度可用细线轨道而非厚进度条  

## 页面级指引（本产品路径）

本产品页面：登录 · 取名表单 · 生成中 · 报告详情 · 历史列表 · 历史详情 · 关于/理念（可选）。

### 登录

- 居中窄栏；品牌「瑾瑜」大字衬线  
- 输入：透明/米白底、细线边框、小圆角  
- 主按钮：深墨青底或深字细边框米白底（二选一，全站统一）  

### 取名表单

- 顶部：小字说明 + 衬线大标题 + ink-divider  
- Label：小字、`outline` 色、略宽字距  
- 条件字段（八字、预产期等）用左边线引用区展开，不用刺眼色块  
- 风格：单选下拉（6 种原型，带副标题说明），不选默认端庄耐看；不做意象卡片 / 补充寓意输入  
- 错误：白话文案 + 淡朱/细红线，不弹恐吓模态  

### 生成中

- 全屏或窄栏安静居中  
- 阶段：`候选生成 → 硬规则过滤 → 报告排版` 用文字列表表示当前步  
- 进度：细线即可  

### 在线报告（正式全文）

章节顺序固定（内容见 PRD）：

1. 总览（首推 + 名单 + 一句话建议）  
2. 逐名详解  
3. 不推荐/淘汰  
4. 命理摘要（仅开启八字时）  
5. 决策建议  

版式建议：

- 总览名字：`font-serif` 大字，首推可识别（标记或左边线，不用荧光 badge）  
- 逐名：诗笺式纵向阅读，名字突出，音韵/出处/避坑用淡色脚注级层次  
- 章节之间 ink-divider  
- 未开八字：不出现四柱表演区  

### 精选摘要图

- 仅名单层：3～5 名（或男女组）各一行 + 一句  
- 首推标记、回看全文入口  
- **固定青玉浅色卡**（冷白底 + 墨青字 + 青玉首推 + 朱砂点缀），与在线页 tokens 一致，**不随主题切换**（图片生成时定格）  
- 不塞音韵全文、出处长文、命理块  

### 历史

- 列表：时间 · 姓 · 性别 · 名摘要，单列细线分隔  
- 详情：快照全文，视觉同报告页；可再下摘要图  

### 关于 / 命名理念

- 可移植旧站「名字是父母写给孩子的第一封信」等文案并**按本产品改编**  
- 写清：一次报告、摘要图、固定账号、无多轮精修主推  

## 风格（表单可选）

- 用户侧：**表单提供风格下拉**（6 种：古典雅致/温润清朗/书卷自持/现代简洁/中性克制/端庄耐看），选项带副标题说明  
- 不选时默认 `default_dignified`（端庄耐看 soft-prompt），仍走软偏好逻辑、不硬失败  
- 报告逐名「风格」展示模型原文描述（保留具体气质，不再套用统一模板句）  
- `src/config/style-prototypes.ts` 为风格原型的唯一数据源（id/name/subtitle/softPrompt/keywords）  

## 技术落点

- 栈：Next.js + Tailwind（与 [`TECH.md`](./TECH.md) 一致；旧站同为 Tailwind，移植成本低）  
- tokens：`app/globals.css` + `tailwind.config`（或 CSS 变量）  
- 组件：ink-divider、报告章节壳放本仓库  
- **issue 01** 脚手架即可埋入 tokens 与全局字体  
- **issue 12** 文化理念页 + 视觉迁入（风格卡已落地为表单下拉，如需意象卡片化可后续增强）

## 明确不做（视觉）

- 霓虹/玻璃拟态/重渐变营销风  
- 大面积彩色 KPI 卡片、厚进度条、强阴影模态堆叠  
- 把旧站精修/多场景壳原样当新首页  
- 摘要图做成整报告长图或 PDF 替代品  

## 验收直觉

给同事看 3 秒应能感到：「这是瑾瑜取名，像一块温润青玉、一份可交付的命名文书，清新优雅，不是通用后台。」  
若某屏更像 Stripe Dashboard、直播大屏或游戏 UI，说明偏离本文件，应改回 tokens 与细线/留白语言。
