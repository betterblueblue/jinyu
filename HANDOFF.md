# HANDOFF — 瑾瑜（jinyu）

Date written: 2026-10-30
Workspace: `E:\agent\jinyu`
Audience: new session with **no** prior chat context.

This file is context only — **not** authorization to change code, deploy, commit, or rotate secrets.

---

## 1. Task — what we are doing

### Goal

Build **瑾瑜 / jinyu**: greenfield web app for baby naming.

Two product surfaces now:

1. **正式取名页**（`/name` → `/reports/[id]` → `/history`）：表单 → 一次生成 → 正式在线报告 → 下载摘要图 → 历史快照
2. **直播取名台**（`/live`）：竖屏 1080×1920，给主播共享屏幕直播用。主播手动录姓氏 → 点大按钮 → 现场出名字 → 存图发观众

### Scope (product)

- Fixed single preset account (no open registration).
- LLM candidates + **server hard gate** (L1 anti-viral names, taboo, generation char, name length).
- Soft prefs: default style **端庄耐看** (not exposed on form).
- Optional bazi (default off, restrained wording).
- Storage: local JSON snapshots under `data/` (not SQLite).
- Independent of `jinyutreasury` runtime.

### Sources of truth

| Doc | Path |
|---|---|
| PRD | `docs/PRD.md` |
| INTENT | `docs/intent/2026-07-23-001-jinyu.md` |
| Tech stack | `docs/TECH.md` |
| UI | `docs/UI.md` |
| Issues (14 slices) | `issues/` (all `Status: done`) |
| 直播运行讨论稿（2026-10-30） | `docs/直播运行讨论稿-2026-10-30.html`（背景参考，不是规范） |

---

## 2. Done — decisions, code, verification

### Key decisions (user-confirmed)

| Decision | Detail |
|---|---|
| Brand / slug | 瑾瑜 / `jinyu` |
| Stack | Next.js App Router + TS + Tailwind + Zod + Vitest + Playwright |
| Storage | **JSON files** in `data/reports/` + `data/index.json` |
| Default LLM | **`opendesign/deepseek-v4.1-flash`**，走本机 OpenAI 兼容网关 `http://127.0.0.1:3425/v1` |
| Default LLM mode | `LLM_USE_FAKE=false`，本地真跑模型 |
| Style UI | 表单**不暴露**风格卡片，固定 `default_dignified` |
| Git | 已是 git 仓库，remote `https://github.com/betterblueblue/jinyu.git`，分支 `main` |

### LLM 演进（重要，别搞反）

原来用 StepFun `step-3.7-flash`，2026-10-29 切到本机网关的 `opendesign/deepseek-v4.1-flash`。

- `.env.local` 里 StepFun 四项已注释留档
- 代码兜底默认值也改成了新网关（`src/providers/index.ts`）
- `StepFunProvider` 类名没改，但它现在是个**通用 OpenAI 兼容客户端**
- 该网关流式返回的推理增量在 `delta.reasoning`，不是 `reasoning_content`，两种都读了
- 实测一份生成 16–25 秒

### 直播取名台（2026-10-30 新增，本次重点）

**入口**：`/live`，登录后访问，如 `http://192.168.31.211:9000/live`

**四套皮肤**（`S` 键或右下角按钮循环）：

| skin | 名称 | 质感 |
|---|---|---|
| `paper` | 宣纸墨色 | 米白纸、双线版框、朱红实底印章 |
| `celadon` | 青瓷天青 | 天青釉、三层开片、细线框印章、胶囊标签 |
| `silver` | 冷白刻版 | 冷白、刻度线、编号 `REVEAL / No.001`、竖排英文、姓氏大字水印 |
| `bamboo` | 竹兰 | **背景图** `public/skins/bamboo-paper.webp`；**默认皮肤**（2026-10-30 起） |

**竹兰背景图规格**（换图就看这段）：卡片是 1080×约 2100–2300，`drawImage(0,0,W,H)` 拉伸铺满，所以

- 出图比例按 **9:19**（如 1080×2280），不要 9:16，否则会被纵向拉长
- 底色保持竹青 `#E0E7D6` 量级亮度，四套字色是按它调的，换暗底要一起回调
- **画面下 45% 必须干净**（无花叶、无深墨、无明显暗角），下方是详解 + 双栏备选区
- 花叶只放在上半部（右上角或顶部），淡墨、低对比，不要压过字
- 无文字、无印章、无边框；文件仍命名为 `bamboo-paper.webp` 放同目录

**四个状态**：待机输入 / 生成中 / 揭晓 / 补充信息面板（抽屉）

**交互（最新版，已去掉排队）**：

- 填姓氏 → 点「开始取名」大按钮（或回车/空格）→ 直接生成
- 空姓氏时按钮 `disabled`，半透明
- 揭晓后点「下一个」或按空格 → 回输入态，**姓氏、性别、补充条件（字数/辈分/避讳/生辰）一起清零**（换观众时不会把上一位的条件带过去）
- 性别清零后回落到「未知」，此时下一轮走男女各 3 的六选路径（约 74s）；主播要更快就点 `1`/`2` 选好性别
- `1` `2` `3` 切男/女/未知，`S` 换肤，`Tab` 开补充面板，`Esc` 关
- **队列功能已删除**（用户决定：直播时手动录入，不需要排队）

**文件**：

```
app/live/page.tsx              # 登录校验 + 渲染 LiveClient
app/live/live-client.tsx       # 全部逻辑（状态机/SSE/存图）
app/live/live.css              # 四套皮肤变量 + 竖屏版式
app/api/reports/[id]/route.ts  # 新增：返回报告 JSON（/api/generate 只回 reportId）
public/skins/bamboo-paper.webp # 竹兰背景，25KB（底部留白版，2026-10-30 换）
tools/fit-window.ps1           # 把浏览器窗口校正成精确 9:16 客户区
启动直播台.bat                  # 直播启动器（ASCII 编码，自动找 Edge/Chrome）
```

**存图**：Canvas 手绘，1080 宽、高度按内容自适应（约 1800–2300）。标题「取名参考」，结构是：主名字 + **全名拼音（含姓氏）** + 3 标签 + 首推详解（寓意 / 读音 / 书写 / 出处 / 留意，开了生辰再加「生辰」）+ 2 个备选（名字 + 全名拼音 + 一句寓意 + 一行特点）。四套皮肤各自配色，竹兰用同一张背景图 `drawImage` 铺底。

**直播页排版（2026-10-30 统一）**：四套皮肤字号一致——拼音 36（400 字重、字距 0.18em）、一句话 52、详解 42 黑体、备选名 48、详解标签 26；**详解一律单栏**（双栏每行只放得下八个字，直播缩小后读不出）。开了生辰时统一降到详解 32 / 备选名 44，并收紧 sheet 下边距，避免顶到跑马灯。各皮肤只调 `--ink*` 配色，不改字号。输入态同步调过：提示语 38（字距 0.16em）、「姓氏」占位 104 / 50% 透明、性别按钮 36 加粗 500、「补充信息」「名字分析」两行 28、跑马灯 29，颜色统一压到 `ink-2`。

**拼音来源**：模型的 `pinyin` 只覆盖「名」，姓氏读音由 `src/domain/pinyin-name.ts` 用 `pinyin-pro` 的 `surname: "all"` 模式补（多音姓氏如曾/单/仇/解/查 会按姓的读法）。姓氏属于常见多音字或字表没收录时，`pyHint` 会给「姓「曾」读 zēng」这类核对提示——**拿不准就提示，不硬编读音**。

**抖音浮层安全区（2026-10-30）**：`.sheet` 上边距 92 → 150、下边距 250 → 210；顶部品牌区整块去掉，改成左下角 16px 的 `brand-mini`（原位置会被头像和榜单盖住）。结果页纵向（1080×1920 设计稿坐标）：名字 222–406、拼音 440–494、含义 538–694、标签 746–791、为什么推荐 835–956、备选 984–1178——备选止于 61% 高度，下半屏留给评论和提示浮层。**不要把必须读到的内容放到 65% 以下。**

**等待态**：不再展示模型原始推理（原来只要句子里有一个中文字就整段露出，中英混杂、还带没定下来的名字）。现在只显示真实阶段：`正在准备名字 / 正在筛选 / 正在整理结果`，由 SSE 的 `stage` 事件驱动；`thinking` 事件只用来推一点进度条。

**设计来源**：三套方向 + 竹兰由 OpenDesign（MCP）生成初稿，再改写成项目里的 React + CSS 变量体系。原始设计稿在 `C:\Users\blue\AppData\Roaming\Open Design\namespaces\release-stable-win\data\projects\jinyu-live-studio\`。**唯一在维护的实现是 `app/live/`**；早期那份桌面静态 demo 已删除，不要再找。

### 直播报告分源（2026-10-30 新增）

`ReportDocument` / `ReportListItem` 加了 `source?: "live" | "formal"`。

- `/api/generate` 读 body 的 `source`，只认 `"live"`，其他一律 `formal`
- `runGeneration` 第 4 个参数 `options?: { source }`
- `report-store.toListItem` 落 `source`，缺省填 `formal`
- `listReports(filter?)` 支持 `{ source }` 过滤
- `/history` 加三个 tab：全部 / 正式取名 / 直播取名，直播条目带金色「直播」小标
- **老数据没有该字段，自动按 `formal` 处理，不需要迁移**

### 直播未知性别：男女各 3 个（2026-10-30 新增）

直播时性别选「未知」，不再混中性名，改成明确分成男向 / 女向两组各 3 个：

- `/api/generate` 收到 `source=live` 且 `gender=unknown` → `runGeneration` 算出 `liveUnknownSix`
- provider 这一轮要 **12 个**候选（男 6 / 女 6），prompt 里 `genderLean` **只能填 male / female，禁止 neutral**
- `orchestrator.hasEnoughCandidates()` 按两组各 ≥3 判够不够；不够就重试一次，再不够直接报错「不会用中性名凑数」
- `assembler` 跳过原来的 neutral 补齐，两组各取 3 个；**正式页逻辑不变**
- 文案：「男向与女向各 3 个备选，得知实际性别后可收窄」
- `FakeProvider` 同步实现（测试模式也是 3+3）
- 直播页一屏两块（`data-testid`：`live-unknown-groups` / `live-male-group` / `live-female-group`），存图文件名 `瑾瑜-{姓}-男女各三.png`

碰过的文件：`src/domain/{orchestrator,assembler,types}.ts`、`src/providers/{types,fake-provider,stepfun-provider}.ts`、`tests/{orchestrator,provider-payload}.test.ts`、`e2e/unknown-gender.spec.ts`

⚠️ `StepFunProvider` 里 prompt 现在是三层嵌套分支（直播六选 / 未知性别三类 / 已知性别），改 prompt 时别只看外层一个分支。

### 八字排盘改成真实历法（2026-10-30 新增，替换哈希实现）

原来的 `bazi.ts` 是 `hash(生日+时辰)` 拼干支，不是排盘：违反 INTENT C08「排盘依赖规则/数据闸门侧约束」，而且时辰会连带改年月日柱，连 C14「无时辰只排年月日」都没满足。

现在改用 **`lunar-javascript@1.7.7`**（纯 JS、无原生模块）：

- 年柱按立春、月柱按节气切换，日柱查历法，时柱用日上起时法
- `setSect(1)`：23 点后（夜子时）日柱归次日，与 `baby-name-skill/references/shichen-table.md` 的「早晚子时」约定一致
- 无时辰 → 只排年月日，`precision: "six_limited"`
- `birthHour` 兼容「巳时 9–11」「10:00」「10」三种写法；时辰文本按该时辰中点估算，精度写进 notes
- notes 给出干支本气五行统计（不含藏干加权）
- `BaziSummary` 新增 `engine: "lunar-javascript"`；**旧报告没有该字段**，报告页据此显示「旧版示意排盘 · 不可作为排盘依据」，不会把新标签贴到旧数据上
- **四柱先算好再进 prompt**：`baziPillars` / `baziPrecision` /（跨界时）`baziUncertain` 一起发给模型，instruction 明确要求基于给定柱子解释、不得自行推算干支
- 出生时刻不确定时做跨界检查：**时段起点、中点、终点都要比**（只比中点和终点会漏掉落在前半段的节气——2024-04-04 清明 15:02 在申时 15–17 的前半段，月柱 丁卯→戊辰）；无时辰比 00:00 与 23:59；子时比早子 00:30 与夜子 23:30。柱子不一致时 notes 写「年柱/月柱/日柱可能为 A 或 B」，备选同时放进 `pillarOptions` 供兜底文案和提示词用（`baziPillarOptions`）
- 模型漏填 `baziFit` 时，有 `pillarOptions` 就写「出生时刻不确定：年柱可能为 A 或 B……」，**不给单一结论**
- 精确 23:30 走「夜子时，日柱已归次日」，不再写「按早子时 00:30 估算」

校验点写在 `tests/bazi.test.ts`（历法校验数据出自 `baby-name-skill/references/wanni-calendar.md`）：

| 用例 | 期望 |
|---|---|
| 2000-01-01 日柱 | 戊午 |
| 2024-01-01 日柱 | 甲子 |
| 2026-04-13 日柱 | 丁巳 |
| 2025-02-03 21:00 vs 23:00（立春 22:10） | 甲辰/丁丑 → 乙巳/戊寅 |
| 2026-10-30 23:30 vs 22:30 | 日柱 戊寅 / 丁丑 |
| 2025-02-03 未填时辰 | notes 列出年柱/月柱/日柱两种可能 |
| 2025-02-03 亥时 21–23 | 提示跨立春，但**不**误报日柱跨界 |
| 2024-04-04 申时 15–17 | 月柱 丁卯/戊辰（节气在前半段也要报） |
| 2024-04-04 辰时 7–9 | 不报跨界（整段都在清明前） |
| 2026-10-30 子时 | 提示日柱可能两个 + 早子时说明 |

**仍然没解决**：时柱只有时辰级，没有出生地/真太阳时；喜忌、用神还是模型措辞，不因排盘变准。要更准得先在页面补「精确到分钟 + 出生地」。

### 竖屏适配

`/live` 是 1080×1920 固定设计稿，用 `transform: scale(--s)` 适配窗口。`--s` 由 JS 按 `min(窗口宽/1080, 窗口高/1920, 1)` 算，设在 `.live-root` 上。

窗口不是竖屏比例时，两侧底色跟着皮肤走（不是纯黑），见 `.live-root[data-skin="..."]`。

### 直播的窗口捕获（操作层）

用户的直播伴侣一开始用「显示器1」捕获，整个桌面塞进竖屏画布，内容只剩中间一小条。正确做法：

1. 双击 `启动直播台.bat` → 用 `--app` 模式开纯净窗口（无标签栏/地址栏/滚动条）
2. bat 调 `tools/fit-window.ps1`，按「屏幕工作区高度 − 标题栏 − 边框」反推宽度，用 `SetWindowPos` 把**客户区**压成精确 9:16（实测 576×1024，ratio 0.5625）
3. 直播伴侣删掉「显示器1」→ 添加素材 → 窗口 → 选这个窗口 → 铺满画布

源窗口 576×1024 放大到直播画布 1080×1920 约 1.875 倍，1080p 屏下字会略软；2K/4K 屏脚本会自动给更大的客户区。

bat 里 URL 写死局域网 IP `http://192.168.31.211:9000/live`（直播在另一台电脑上跑）。IP 变了要改 bat 那一行。

### 已知小问题

| 问题 | 影响 |
|---|---|
| 卡片左下角兰花压在备选左栏「避坑」标签上 | 花很淡，字能看清，只是叠着。**处理中**：要重出一张底部留白的 9:19 背景，替换 `public/skins/bamboo-paper.webp` |
| 直播页详解限制 2 行、备选寓意限制 2 行 | **这是设计**，不是缺陷：直播结果页只展示概要，详细内容看存图（Canvas 版本按内容自适应高度、不截断）。**直播页详解是「为什么推荐 / 出处」，开了生辰再加「八字」一行 + 生辰（属相·季节）；音韵、字形、避坑、风格按用户要求去掉了，不要加回来**。这些字段只在存图里出现 |

### Verifications that **passed**

| Check | Command / method | Result |
|---|---|---|
| Unit tests | `pnpm test` | Exit 0；**49/49** passed（2026-10-30 复跑，含八字排盘 13 个用例） |
| Typecheck | `pnpm typecheck` | 干净 |
| 真实生成（正式页） | 手动 + Playwright | 「沈静嘉」「陈峻岩」等，16–25s |
| 真实生成（直播页） | Playwright 点「开始取名」 | 「苏清晏」「苏知微」「苏婉仪」等 |
| 存图 | Playwright 拦截下载 | 1080×2068 / 2208 / 2240，四套皮肤各自配色 |
| 历史筛选 | `/history` `/history?src=live` `/history?src=formal` | 清理后 **110 / 0 / 110**（清理前 144 / 16 / 128） |
| 窗口 9:16 | `cmd /c 启动直播台.bat` | `Client area: 576 x 1024 ratio 0.5625` |
| 缩放适配 | 576×1024 / 1280×720 / 1080×1920 | `fitW/fitH` 全 true，横屏两侧纸色不裁切 |

### 数据现状

`data/index.json` 与 `data/reports/` 各 **110** 条，**全部按 formal 处理**（2026-10-30 清理后实测）。

2026-10-30 清过两次，都没删，挪到了 `data/_trash/`：

```
data/_trash/live-2026-10-30T06-53-46/   # 16 条 source=live 的直播测试记录
data/_trash/fake-2026-10-30T06-59-52/   # 19 条 providerName=fake 的示例模式记录
```

每个目录里都有 `index-removed.json`（被移除的索引）+ `index-before.json`（清理前完整索引，兜底）+ 对应数量的 `<id>.json`。要恢复就把 `index-removed.json` 合并回 `index.json`，再把 json 挪回 `data/reports/`。

所以现在 `/history` 是 **全部 110 / 正式取名 110 / 直播取名 0**。剩下条目按 provider 分：

| providerName | 条数 | 说明 |
|---|---|---|
| 空（没该字段） | 89 | 更早的数据 |
| `stepfun` | 16 | 旧 StepFun 时代真跑 |
| `magpie` | 5 | 本机网关真跑 |

---

## 3. Current status and open items

### Working

- 正式取名全链路（表单 → 生成 → 报告 → 存图 → 历史）
- 直播取名台四态 + 四皮肤 + 存图
- 直播/正式报告分源 + 历史筛选
- 单元测试全绿

### Git 状态

2026-10-30 已把这批工作拆成 4 个 commit 落库，工作区干净：

| commit | 内容 |
|---|---|
| `a917005` | 报告 `source` 分源 + `GET /api/reports/[id]` + `/history` 三 tab |
| `d37fcf3` | 生成入口透传 source + 直播未知性别男女各 3 个 |
| `25cbf5c` | 直播取名台 `/live`（四皮肤 + 缩放 + 存图 + 启动器 + fit-window） |
| `5e63762` | HANDOFF 补六选 + 修正过期数字 |
| `e930b74` | HANDOFF 去掉满屏/榜单待办，记录数据清理与测试污染 |
| 第 6 个 | `fix(store)` 路径改调用时求值，测试不再写进真实 `data/` |
| 第 7 个 | HANDOFF 数字更新到清理后的 110 条 |
| 第 8 个 | `feat(bazi)` 换成 lunar-javascript 真实四柱排盘 + 7 个校验用例 |
| 第 9 个 | HANDOFF 补排盘一节 |
| 第 10 个 | 修评审三处：旧报告标签、跨界提示、四柱进 prompt |
| 第 11 个 | HANDOFF 记录上一轮评审修复 |
| 第 12 个 | 修评审两处：节气在前半段漏报、不确定时兜底给单一结论（含本文档） |

再往前 `5f681c1` 是 change-impact 目录改名。

### Needs user decision

- 卡片上兰花压字要不要彻底解决（需 9:19 卡片专用背景）
- Next 15.1.0 的安全告警要不要升级

---

## 4. Next steps (ordered)

1. **直播档 prompt**（可选）
   - 现在标签是拼出来的（`双字名 · 避开网红名 · 女向`）
   - 可以给直播页单独出一个更短、更适合口播的文案模板

2. **可选质量**
   - 直播页详解截断提示（现在直接省略号，主播可能念不全）

---

### 名字分析的耗时（2026-10-30 实测）

分析一次的时间几乎全花在模型推理上，与 max_tokens 和 reasoning_effort 都无关：

| 变量 | 实测 |
|---|---|
| reasoning_effort high / medium / low | 12.6 / 14.9 / 15.0 秒，**没有差别** |
| max_tokens 4096 / 6144 / 8192 | 15.8 / 12.7 / 10.9 秒，波动来自推理长度，inish_reason 全是 stop |
| 换 haiku-5.5 | 20.6 秒，更慢，且输出退回「读起来顺」这类套话 |
| **提示词加「推理不超过 200 字」** | **9.0–12.1 秒（平均 ~10.5），原来 15–20 秒** |

所以提速只靠提示词约束推理长度，别去动模型和 token 预算。端到端实测：高登科 10.6s、林知远 9.0s、文清晏 12.1s。

### 取消「风格」维度 + 出处必须可核验（2026-10-30）

用户判定「风格」相关内容空泛不可信（例：出处写成「取「端庄雅正」的成词义，现代常用字组合」），
决定整条链路去掉风格，出处改为**核验过才显示**。

已落地的改动：

- **删除风格**：`StylePrototypeId`、`stylePrototypeId`、`styleNotes`、`config/style-prototypes.ts`、
  正式页的风格下拉、prompt 里的 `style` 字段、候选的 `styleFit`、soft-ranker 的关键词加分与
  「与「端庄耐看」方向有呼应」这类文案。直播台本来就没传风格字段，删掉 `normalizer` 的默认值后
  两个入口一起消失。
- **出处**：模型改为返回 `citation: { source, piece, quote, gloss }`，`orchestrator` 在排序前用
  `src/domain/analysis/corpus.ts` 的 `verifyCitation` 逐字回原文核对；核不过就当没有出处。
  `NameDetail.origin` 只存 `${书名} · ${篇名}｜「${引文}」`，没有就在报告页/存图里整行不出现。
- **组合依据**：候选新增 `composition`（两个字各自什么意思、合起来为什么成立）。
  直播页「为什么推荐」、存图首推的「组合」都用它；存图备选「特点」优先用核验过的出处，其次避坑。
- **具体要求**：`styleNotes` 全线改名 `requirements`（表单 / NormalizedRequest / prompt / 分析回流）。
  只承载能照做的条件（避开某字、读音要亮、别太常见），不写「端庄」「清雅」这类风格形容词，
  也不再参与排序打分。
- **排序**：风格关键词加分取消，改成「出处核验通过 +15、组合依据写具体 +6」，
  其余仍是模型顺序、L2 重名扣分、性别倾向扣分。

实测（高姓男，直播台，576×1024）：25.8s 生成，四个候选的出处全部核验通过
（诗经·小雅四月「匪鹑匪鸢，翰飞戾天」、商颂长发「浚哲维商，长发其祥」、
大雅文王「王国克生，维周之桢」、尚书尧典「克明俊德」），
直播页「为什么推荐」为组合依据，页面无任何风格字样。

**代价**：要求出处会让生成变慢（16–25s → 约 26s），且模型想不出可靠出处时该栏就是空的——
这是有意的取舍，不许为了填满栏目编出处。

## 5. Pitfalls — do not repeat

| Pitfall | Why |
|---|---|
| 只读 `choices[0].message.content` | 模型常把内容放在 `reasoning` / `reasoning_content`；网关还可能用 `delta.reasoning` |
| 在子选择器写 `--s: 1` | 会盖掉 JS 设的缩放，页面不缩放直接裁切 |
| 把 `oneLiner` 当「一句寓意」 | 它是摘要标题（如「首推 沈静嘉 · 精选少量备选便于比较」），太长会撑破布局。直播页用 `primary.meaning` |
| Canvas 用 `fillText` 画长句 | 不换行，超出画布直接被裁。必须按 `measureText` 缩字号或 `wrapText` |
| bat 文件写中文注释 | cmd 按 GBK 读，UTF-8 写入会乱码。**启动器全用 ASCII** |
| 用「显示器捕获」做竖屏直播 | 横屏桌面塞进竖屏画布，内容只剩中间一条。必须窗口捕获 + 竖屏窗口 |
| 直播伴侣里手动拖窗口尺寸 | 外框和客户区差一个标题栏，比例永远差一点。用 `SetWindowPos` 按客户区算 |
| 竹兰皮肤白蒙版压太重 | 22% 白会把纸纹冲平；新背景（#E0E7D6 / 亮度 231）本身够亮，直接去掉蒙版 |
| 字色一刀切用近黑 | 底越亮字越不该黑。竹兰四版字色随背景亮度逐版回调 |
| 假设页面在 1080×1920 下好看就够了 | 直播窗口是 576×1024 或更小，必须在小窗口验证 |
| 提交 `.env.local` | 含真 key，gitignored |
| write 工具报 `ReplaceFileW EIO` | 文件被占用时会发生；改用 PowerShell `[System.IO.File]::WriteAllText` 即可 |
| 以为测试里的 `JINYU_DATA_DIR` 能隔离数据 | `report-store.ts` 的路径常量若是模块顶层求值，`beforeEach` 里设 env 就晚了，测试会写进真实 `data/`。已改成调用时求值，`tests/store.test.ts` 加了断言钉住 |
| 拿哈希或随机数拼干支当排盘 | 已换成 lunar-javascript。`hash(生日+时辰)` 那种写法连年月日柱都会一起变，直接违反 INTENT C08 |
| 直播时辰的值是「巳时 9–11」这种中文串 | `parseBirthHour` 现在认汉字时辰（取该时辰中点）。改下拉 value 前先确认排盘不需要文本，别把解析写回只认数字 |

### Useful commands

```bash
pnpm install
pnpm dev                 # 9000 端口
pnpm test                # 49 个
pnpm typecheck
pnpm e2e
node scripts/probe-provider.ts   # 真实模型 + 闸门
node scripts/e2e-real-llm.mjs    # 需 dev server
```

---

## 6. Workspace state

| Item | Value |
|---|---|
| Path | `E:\agent\jinyu` |
| Git | 仓库 + remote，`main` 分支，工作区干净，最近 12 个 commit 见上 |
| Package manager | pnpm |
| Dev server | 9000 端口（本次会话实测已在跑，PID 23396）；否则手动 `pnpm dev` / `.\start-dev.ps1` |
| 本机局域网 IP | `192.168.31.211`（DHCP，会变） |
| 数据 | `data/index.json` 110 条，全部按 formal；35 条清理记录在 `data/_trash/` 可恢复 |
| 用户密钥 | `.env.local`（不要打印、不要提交） |
| 不要删 | `docs/*`、`issues/*`、用户 `.env.local`、`data/`、`public/skins/` |

### `.env.local` 变量名

`JINYU_AUTH_USERNAME`, `JINYU_AUTH_PASSWORD`, `JINYU_SESSION_SECRET`, `LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_USE_FAKE`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`

登录账号见 `JINYU_AUTH_USERNAME` / `JINYU_AUTH_PASSWORD`（本地是 `jinyu` / `betterblue`）。

---

## 7. How a new session should start

### Read first (in order)

1. This file
2. `README.md`
3. `docs/TECH.md`（LLM 接入那一节已更新到本机网关）
4. `app/live/live-client.tsx` + `app/live/live.css`（如果要动直播台）
5. `src/domain/types.ts` + `src/store/report-store.ts`（如果要动 source 分源）
6. `src/domain/orchestrator.ts` + `src/domain/assembler.ts`（如果要动直播未知性别六选）

### Read-only checks

```bash
cd E:\agent\jinyu
pnpm test
pnpm typecheck
git status --porcelain
```

### First constructive action

- 动直播台前先 `pnpm dev` 打开 `/live`，按 `S` 把四套皮肤都看一遍
- 改完任何 UI，**用 576×1024 和 1080×1920 两个尺寸各截一次图**（小窗口才是直播真实尺寸）

---

## 8. 名字分析（2026-10-30 新增）

> 状态：**功能已落地，代码、语料、测试都在**。名字分析这条主链路真实模型跑通过；
> 但 `/live` 姓氏输入框在一次自动化复查里状态没更新，**未复验**，见「待验证」一节。
> 用户 2026-10-30 决定先不验，回头自己看。

### 做什么

直播台输入**完整姓名**（性别必填，生日可选），诊断这个名字有哪些问题，然后一键把问题转成约束去取名。

- 入口：`/live` 输入态底部「名字分析」按钮，或按 `A`
- 状态：输入 → 分析中（思考字幕 + 进度）→ 结论
- 结论三档，由代码判、不由模型说：

  | verdict | 准入条件 | 按钮 |
  |---|---|---|
  | `hard` 有硬伤 | 谐音成不雅词 / 字打不出 / 坏意思 / 性别明显错位 | 换个名字看看 |
  | `cost` 有代价 | 无硬伤，但有读起来闷、年代旧、重名多、意思说满这类小亏 | 看看换成什么样的 |
  | `fit` 没问题 | **必须 issues 为空**，才允许说「还能更贴合」 | 看看更贴合的写法 |

- 「更贴合」不是万能话术：`fitAngle` 必须提到姓氏，不提就用兜底句，防止什么名字都能说「还能更贴合」
- **不显示分数**、**不算五格**、结论放第一句、不许出现「能用/还行/总体来说」
- 分析结果**不落盘**（过程不是交付物）；点按钮后带 `surname + tabooChars + styleNotes` 走原 `/api/generate`，硬闸门照走

### 分工：哪些算、哪些问模型

| 项 | 谁 | 说明 |
|---|---|---|
| 笔画 | 本地 | Unihan `kTotalStrokes`，模型数笔画必错 |
| 常用度 | 本地 | GB2312 一级/二级/表外，由编码区反查，不依赖外部数据 |
| 性别倾向 | 本地 | 人名经验字表（`gender-lean.ts`），只收倾向明确的字 |
| 谐音 / 字义 / 年代感 / 措辞 | 模型 | 只有语感能判 |
| 引文 | 模型给 + **代码逐字核验** | 核不过就删，不显示 |

### 语料核验

`data/corpus/pieces.jsonl`（**不进 git**，91,220 篇 / 30.7MB），23 部：诗经、楚辞、论语、大学、中庸、孟子、周易、尚书、礼记、左传、文选、古文观止、全唐诗、宋词、元曲、纳兰词、千字文、声律启蒙、三字经、幼学琼林、千家诗、唐诗三百首、增广贤文。

- 重建：`pnpm corpus:build`（先 `build-chars.mjs` 出字表，再 `fetch.mjs` 下载归一化），几分钟
- 来源：`chinese-poetry`（JSON）+ `garychowcmu/daizhigev20`（殆知阁纯文本，用于经部与文选）
- 核验只回答「这句原文在不在这本书里」，**不判断用得对不对**——那查不出来
- 篇名说错但原文有的，自动校正并标 `corrected`
- 繁体语料（全唐诗 32%，千字文/三字经/增广贤文约 30%）比对时折简体；**展示也折**，但 `乾幹藉徵著覆瞭` 保留原字，免得「乾坤」变「干坤」
- 字表没装时全部退化：笔画/常用度查不到就不说，引文一律「暂无可核出处」，**不会编**
- JSON 语料有嵌套两层 `content` 的（古文观止、声律启蒙），`fetch.mjs` 里是递归摊平；只收字符串否则会得到 `[object Object]`

### 文件

```
scripts/corpus/sources.mjs         # 语料源清单（含 daizhige 的切块正则）
scripts/corpus/fetch.mjs           # 下载 + 递归摊平 + 切块 → pieces.jsonl
scripts/corpus/build-chars.mjs     # Unihan → chars.json（笔画/繁简/GB分级）
src/domain/analysis/types.ts       # AnalysisResult 等
src/domain/analysis/chars.ts       # 字表读取、折合、展示用简化
src/domain/analysis/corpus.ts      # 语料加载与引文核验
src/domain/analysis/split-name.ts  # 姓名拆分 + 复姓歧义备选
src/domain/analysis/gender-lean.ts # 性别倾向字表
src/domain/analysis/rules.ts       # 本地确定性检查 → Issue
src/domain/analysis/prompt.ts      # 提示词 + 输出归一化
src/domain/analysis/analyze.ts     # 编排：本地检查 + 模型 + 核验 + 拼装
src/providers/chat.ts              # 共用的流式 Chat Completions 客户端
src/providers/analysis-provider.ts # 分析端口（真 / Fake）
app/api/analyze/route.ts           # SSE：thinking / stage / done / error
app/live/analyze-panel.tsx         # 三态面板
app/live/analyze.css               # 面板样式（跟随四套皮肤变量）
scripts/probe-analysis.ts          # 离线自检（不联网）
tests/analysis.test.ts             # 23 个用例
tests/fixtures/corpus/             # 测试用微型语料 + 字表
```

### 顺手改的

- `stepfun-provider.ts` 里那份私有的 `streamChat` 抽到 `src/providers/chat.ts`，取名和分析共用一份流解析
- `buildBaziSummary` 参数收窄成 `BaziInput`（`Pick<NormalizedRequest,...>`），分析复用排盘不用伪造整份表单

### 验证（2026-10-30 实测）

| 项 | 结果 |
|---|---|
| `pnpm typecheck` | 干净 |
| `pnpm test` | **77/77**（含 analysis 26 个） |
| 语料核验离线自检 | `pnpm tsx scripts/probe-analysis.ts` 全部符合预期，故意编的句子被驳回 |
| 真实模型分析 | 高登科 → cost，3 条问题，出处「全唐诗·登科后」核验通过并折成简体 |
| 一键改名 | 面板关闭、姓氏带过去、出「高承岳」 |
| 576×1024 / 1080×1920 | 输入、分析中、结论、底部按钮都不溢出（截图已删，需要时重跑） |
| `pnpm e2e` | **3 passed**（1.6m，复用 9000 上已启动的 server，跑完自动清理用例生成的报告） |

### e2e 现在怎么跑（2026-10-30 已修通）

`reuseExistingServer` 会复用 9000 上已启动的 dev server，而那个 server 用的是 `.env.local`，所以账号也改成从 `.env.local` 读（`e2e/local-env.ts`）。之前 config 里写死 `change-me`，与 `.env.local` 的 `betterblue` 不符，3 个 spec 全挂在登录。

配套改了三处：

- 单测超时 30s → 240s：复用 server 时跑的是真实模型，一次 16–25 秒，用例里的 60–180 秒等待先前会被默认超时提前判死
- `globalSetup` 记下 `data/index.json` 现有 id，`globalTeardown` 把新增的 王/林/苏 报告挪进 `data/_trash/e2e-<时间>/`，用户历史不被污染
- 实测 3 passed (1.6m)，跑前跑后 index 都是 114 条

### 已修：`/live` 姓氏输入框打字后按钮仍 disabled（2026-10-30）

不是陈旧模块，是 **hydration 竞态**：hydrate 之前输入的字符只落在 DOM，onChange 还没绑上，`draft` 一直是空，按钮因此禁死；之后再打字还会和早先的字符拼在一起（「苏」+「李」=「李苏」）。

修法：`live-client.tsx` 挂载后把输入框现值同步回 `draft`。Playwright 复验：修复前 disabled 保持 3.7 秒，修复后一挂载就恢复。

### 已知限制

- **结论页在 576 小窗里要滚动**，最后一行会卡在按钮上沿；滚动区已留 44px 内边距，但视觉上仍像被截断
- 生日框是原生 `input[date]`，占位符跟随浏览器语言（显示 `yyyy/mm/dd`）
- 性别选「不填」时跳过性别判断
- 引文只核到「原文在不在这本书里」，用错典故查不出来（如「桃之夭夭」被理解成逃跑）
- 语料缺失时功能降级但不报错，容易被误当成「模型没给出处」
- `data/corpus/` 不进 git，换台机器要重跑 `pnpm corpus:build`

---

## Self-check

- 区分了「已完成 / 未提交 / 未验证」
- 路径和命令具体，无密钥值
- git 状态与实测一致（4 个 commit 已提交、工作区干净），没把未验证的事写成已验证
- 直播台的取舍（去排队、皮肤来源、窗口捕获、缩放坑）都写清楚了
- 直播未知性别六选这一块（liveUnknownSix）单独成节，别和正式页逻辑搞混
- 新 session 只看这个文件就能接手