# UI 风格决议（瑾瑜 / jinyu）

Status: decided  
Date: 2026-07-23  
Source: PRD 文化层复用 + jinyutreasury 实装对照；用户确认写入本文件。

## 一句话

**东方纸笺 / 诗意实用主义**：米纸底、墨青与铜金点缀、衬线标题、大留白、细线分隔。像一份可交付的命名说明，不像 SaaS 仪表盘。

品牌对外一律 **「瑾瑜」**；工程 slug 为 `jinyu`。

## 设计原则

1. **米纸底 + 极淡纹理**，不要大色块渐变后台风  
2. **衬线标题、字距略开**；正文宽松行高  
3. **细线框 / 左边线引用**，少大圆角、少重阴影  
4. **标签低饱和**：少彩色 badge，多用 `·` 分隔或淡线框  
5. **窄栏居中**（约 `max-w-2xl`～`max-w-3xl`），避免过宽疲劳  
6. **摘要图**与在线页同一气质：名单层摘要，不是炫彩海报  
7. **取名表单不暴露风格选择**：产品默认「端庄耐看」软偏好（后台固定），避免表单过重  

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

### 颜色

| Token | 值 | 用途 |
|---|---|---|
| `surface` / background | `#fbf9f5` | 页面底（亦可 `#f7f5f0`） |
| `surface-container-low` | `#f5f3ef` | 浅区、hover |
| `primary` | `#00362a` | 墨青主色、标题、主按钮字色 |
| `secondary` | `#775a19` | 铜金辅色、选中左边线、点缀 |
| `tertiary` | `#65000a` | 深红强调（慎用） |
| `cinnabar` | `#c84646` | 错误/少量警示 |
| `on-surface` | `#1b1c1a` | 正文 |
| `on-surface-variant` | `#404945` | 次要正文 |
| `outline` | `#717975` | 说明文字 |
| `outline-variant` | `#c0c8c4` | 细线边框 |

背景可叠极淡径向光（非渐变海报）：

```css
background-color: #fbf9f5;
background-image:
  radial-gradient(circle at 15% 50%, rgba(0, 54, 42, 0.03) 0%, transparent 50%),
  radial-gradient(circle at 85% 30%, rgba(119, 90, 25, 0.02) 0%, transparent 40%);
```

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
- **不做**风格意象卡片 / 补充寓意输入（默认端庄耐看，由服务端固定）  
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
- 配色/字体与在线页 tokens 一致  
- 不塞音韵全文、出处长文、命理块  

### 历史

- 列表：时间 · 姓 · 性别 · 名摘要，单列细线分隔  
- 详情：快照全文，视觉同报告页；可再下摘要图  

### 关于 / 命名理念

- 可移植旧站「名字是父母写给孩子的第一封信」等文案并**按本产品改编**  
- 写清：一次报告、摘要图、固定账号、无多轮精修主推  

## 风格（产品默认，无表单字段）

- 用户侧：**不展示**风格原型选择与补充寓意  
- 服务端固定 `default_dignified`（端庄耐看 soft-prompt），仍走软偏好逻辑、不硬失败  
- `src/config/style-prototypes.ts` 可保留作实现细节；非 UI 必选项  

## 技术落点

- 栈：Next.js + Tailwind（与 [`TECH.md`](./TECH.md) 一致；旧站同为 Tailwind，移植成本低）  
- tokens：`app/globals.css` + `tailwind.config`（或 CSS 变量）  
- 组件：ink-divider、报告章节壳放本仓库  
- **issue 01** 脚手架即可埋入 tokens 与全局字体  
- **issue 12** 文化理念页 + 视觉迁入；**不再要求**表单风格卡

## 明确不做（视觉）

- 霓虹/玻璃拟态/重渐变营销风  
- 大面积彩色 KPI 卡片、厚进度条、强阴影模态堆叠  
- 把旧站精修/多场景壳原样当新首页  
- 摘要图做成整报告长图或 PDF 替代品  

## 验收直觉

给同事看 3 秒应能感到：「这是瑾瑜取名，像纸笺说明书，不是通用后台。」  
若某屏更像 Stripe Dashboard 或游戏 UI，说明偏离本文件，应改回 tokens 与细线/留白语言。
