# HANDOFF — 瑾瑜（jinyu）

Date written: 2026-10-30（2026-10-31 更新：精简快速版 §10）
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
- **没有「风格」维度**（2026-10-30 取消）：表单、提示词、排序、展示都不再有端庄/清雅这类标签。
- 出处必须**回原文核验**才显示；核不过就留白，不拿「现代常用字组合」这种说法充数。
- 具体条件仍保留：姓氏、字数、辈分字与位置、避讳、生辰、避开热门。
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
| **快速取名需求稿 R2（2026-10-30）** | `docs/直播快速取名与详细取名需求稿.md` — 用户与 gpt6 讨论产出，**本轮建库按它执行**；正式验收基线仍待用户逐条确认 |
| **快速取名设计稿 R2（2026-10-30）** | `docs/直播快速取名与详细取名设计稿.md` — 同上；§13 第一步（建库）已获准开工，其余步骤未获准 |

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
| 风格 | **已取消**（2026-10-30）。`stylePrototypeId` / 风格文案 / 关键词打分全部删除，改用 `requirements` 承载具体条件 |
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

**存图**：Canvas 手绘，1080 宽、高度按内容自适应（约 1800–2300）。标题「取名参考」，结构是：主名字 + **全名拼音（含姓氏）** + 3 标签 + 首推详解（寓意 / 读音 / 书写 / 出处 / 留意，开了生辰再加「生辰」）+ 2 个备选（名字 + 全名拼音 + 一句寓意 + 一行「出处」；没有核验出处时改标「留意」）。四套皮肤各自配色，竹兰用同一张背景图 `drawImage` 铺底。

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
| ~~卡片左下角兰花压字~~ | **已解决**：2026-10-30 换成底部留白的竹兰背景（兰花只占左上角、竹叶只在右上角，40% 以下零墨点） |
| 直播页详解限制 2 行、备选寓意限制 2 行 | **这是设计**，不是缺陷：直播结果页只展示概要，详细内容看存图（Canvas 版本按内容自适应高度、不截断）。**直播页详解只有「为什么推荐」（取 `composition`），开了生辰再加「八字」一行 + 生辰（属相·季节）；出处、音韵、字形、避坑、风格都不在直播页出现，不要加回来**。这些字段只在存图里出现 |

### Verifications that **passed**

| Check | Command / method | Result |
|---|---|---|
| Unit tests | `pnpm test` | Exit 0；**92/92** passed（含八字 13、分析 29、拼音 4、精简版 8） |
| Typecheck | `pnpm typecheck` | 干净 |
| 真实生成（正式页） | 手动 + Playwright | 「沈静嘉」「陈峻岩」等，16–25s |
| 真实生成（直播页） | Playwright 点「开始取名」 | 「苏清晏」「苏知微」「苏婉仪」等 |
| 存图 | Playwright 拦截下载 | 1080×2068 / 2208 / 2240，四套皮肤各自配色 |
| 历史筛选 | `/history` `/history?src=live` `/history?src=formal` | 清理后 **114 / 0 / 114**（直播记录已全部清空） |
| 精简版压测（5 候选 30 轮） | `POST /api/fast` | 30/30 成功；P50 8s、P95 12.5s、最慢 15s；首推出处 30/30 |
| 精简版压测（6 候选 50 轮，旧配置） | 同上 | 50/50 成功；P95 22.1s、最慢 35.7s、17/50 超 10s |
| 精简版真机 | Playwright 点「开始取名」 | 576×1024：7.5s「林望舒」；1080×1920：4.4s「林清扬」；576 女宝：9.0s「陈令仪」；无页面错误 |
| 精简版出处兜底 | 6 轮 | 首推带出处 6/6，总计 20/24 |
| 窗口 9:16 | `cmd /c 启动直播台.bat` | `Client area: 576 x 1024 ratio 0.5625` |
| 缩放适配 | 576×1024 / 1280×720 / 1080×1920 | `fitW/fitH` 全 true，横屏两侧纸色不裁切 |

### 数据现状

`data/index.json` 与 `data/reports/` 各 **114** 条，全部按 `formal` 处理。按 provider 分：

| providerName | 条数 | 说明 |
|---|---|---|
| 空（没该字段） | 89 | 更早的数据 |
| `stepfun` | 16 | 旧 StepFun 时代真跑 |
| `magpie` | 9 | 本机网关真跑 |

清理过的东西都没删，全在 `data/_trash/`（16 个目录、103 个文件）：`live-*` 直播测试记录、`fake-*` 示例模式记录、
`e2e-*` 与 `manual-*` 是跑 e2e / 手工验证产生的报告。每个目录都有 `index-removed.json`，
要恢复就合并回 `index.json` 并把 json 挪回 `data/reports/`。

**跑 e2e 会自动清理**：`global-setup.ts` 记下跑前的 id，`global-teardown.ts` 把新增的王/林/苏 报告挪进
`data/_trash/e2e-<时间>/`，跑完 index 条数不变。

---

## 3. Current status and open items

### Working

- 正式取名全链路（表单 → 生成 → 报告 → 存图 → 历史）
- 直播取名台四态 + 四皮肤 + 存图
- **直播台出名字走精简版 `/api/fast`：P50 8s / P95 12.5s / 首推出处 30/30**（见 §10）
- 直播/正式报告分源 + 历史筛选
- 单元测试 **92/92**

### Git 状态

`main` 与 `origin/main` 一致，2026-10-31 的全部改动已在 **`cedea8f`** 提交并推送。`抖音素材/` 是用户自己的图，**未跟踪，别提交**。

下面是这次提交里包含的内容（留档，不用再照着 stage）：

```
M  app/live/live-client.tsx        改用 /api/fast + 生日输入 + 删掉补充信息抽屉
M  src/config/l1-templates.json    20 → 41（补 2020/2021 公安部 top10 与 2024/2025 各地爆款）
M  src/config/l2-chars.json        14 → 36（补 泽沐辰汐芮霖航一昕玥伊可锦宸铭珩瑞璟星妍亦程）
M  src/domain/pinyin-name.ts       surname all → head（修多音字误读）
M  tests/pinyin-name.test.ts       多音字回归用例
M  HANDOFF.md                      本节
?? src/fast/（7 个文件）+ app/api/fast/route.ts + tests/fast.test.ts   精简快速版
?? src/config/forbidden-chars.json 142 字忌字表
?? scripts/name-library/           建库脚本
?? scripts/probe-fast.ts           精简版探针（ROUNDS / SURNAME / GENDER）
?? docs/直播快速取名与详细取名*.md  需求稿与设计稿
```

**同日第二轮（提示词与出处核验，见 §11）**：`src/fast/{prompt,cite,provider,run,types}.ts` 全部改过、`tests/fast.test.ts` 12 → 14 例、`app/live/live-client.tsx` 多一个 `recentRef`。

2026-10-30 一天的提交按主题：

| 主题 | 关键 commit |
|---|---|
| 直播台从 0 到 1 | `25cbf5c` 四皮肤+缩放+存图；`77787c1` 竹兰底部留白背景；`49b9bed` 去掉朱红印章；`83462ab` 默认皮肤改竹兰 |
| 报告分源 | `a917005` |
| 直播未知性别六选 | `d37fcf3` |
| 八字真实排盘 | `dbf7d44`；评审修复 `af599df`、`c010f0d` |
| 名字分析 | `c91b59f` 全链路；`84d3afa` 优点不许凑数；`c758ee0` 面板文案；`5386fd0` 推理长度上限 |
| 直播可读性 | `eb61463` 宣纸重排；`f423753` 三皮肤同步；`b235f8f` 输入态同步 |
| 抖音安全区与等待态 | `55547c6` |
| 去风格 + 出处核验 | `95e4835`；`1587925` 备选标签改「出处/留意」 |
| e2e 可跑 | `421b837`；`3135ea8` 自动清理 |

### Needs user decision

- ~~男女各三要不要提速~~：**已由精简版解决**，见 §10。直播台现在不走男女各三那条 12 候选的路
- Next 15.1.0 的安全告警要不要升级
- 精简版要不要跑并发压测（单机单主播串行目前够用）
- 791 条旧库是否保留：A 档 30 条已单独定版，其余 761 条可以留着当语料，不要当名字池

---

## 4. Next steps (ordered)

1. ~~男女各三的等待时间~~ → **已作废**：直播台改走精简版（§10），不再现场跑 12 候选。三条旧方案（只首推带出处 / 六选只生成 8 个 / 接受等待）别照着做。
2. **直播档口播文案**（可选）
   - 现在标签是拼出来的（`双字名 · 避开网红名 · 女向`）
   - 可以给直播页单独出一个更短、更适合口播的模板
3. **建库** → 已收口（§9）：A 档 30 条定版，**不要再手写名字库**
4. **精简版上线前剩下的事**（§10）
   - 约 20% 的备选没出处，主播话术要交代一句「这个出处我核一下」
   - 前 100 个精简版名字存一份 `data/name-library/live-samples.jsonl` 给用户过目
   - 真要多人同时用再补并发压测（单机单主播串行够用）
5. **数据源**：语料缺老子、庄子、世说新语、宋诗；要扩就扩这几部，别再挖全唐诗（实测低产）

---

### 名字分析的耗时（2026-10-30 实测）

分析一次的时间几乎全花在模型推理上，与 max_tokens 和 reasoning_effort 都无关：

| 变量 | 实测 |
|---|---|
| reasoning_effort high / medium / low | 12.6 / 14.9 / 15.0 秒，**没有差别** |
| max_tokens 4096 / 6144 / 8192 | 15.8 / 12.7 / 10.9 秒，波动来自推理长度，finish_reason 全是 stop |
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
  直播页「为什么推荐」、存图首推的「组合」都用它。
- **备选那一行的标签跟内容走**：有核验出处标「出处」，没有才标「留意」（取避坑提醒），
  两样都没有就不显示。别再用「特点」当筐——用户专门提过这个错。
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

第二次实测（`1587925` 之后）：高景舟 · 诗经·国风·邶风·二子乘舟「二子乘舟，泛泛其景」；
备选 高振鹭（诗经·周颂臣工之什·振鹭）、高谦牧（周易·谦）也各带核验过的出处，三处标签一致。
存图 1080×1828，首推五项：寓意 / 读音 / 书写 / 出处 / 留意。

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
| 语料索引在请求里同步建（91,220 行全 parse） | 首个请求 +25s。改成按书过滤 + 行缓存（见 §10） |
| 生成侧挂 `reasoning_effort: "xhigh"` | 最慢档且无收益；精简版实测 `low` 快一倍（见 §10） |
| 谐音坏词表用全名全等比对 | 双字名三个音节、坏词两个音节，永远不命中，是死代码 |
| 要求每个候选都给可核出处 | 单次 27–40s，尾部无法收敛。改成「有把握才给 + 事后补 + 本地兜底」 |
| 以为候选数和耗时无关 | 6→5 个候选，P95 从 22.1s 掉到 12.5s；输出量才是主因 |
| 提交 `.env.local` | 含真 key，gitignored |
| write 工具报 `ReplaceFileW EIO` | 文件被占用时会发生；改用 PowerShell `[System.IO.File]::WriteAllText` 即可 |
| 以为测试里的 `JINYU_DATA_DIR` 能隔离数据 | `report-store.ts` 的路径常量若是模块顶层求值，`beforeEach` 里设 env 就晚了，测试会写进真实 `data/`。已改成调用时求值，`tests/store.test.ts` 加了断言钉住 |
| 拿哈希或随机数拼干支当排盘 | 已换成 lunar-javascript。`hash(生日+时辰)` 那种写法连年月日柱都会一起变，直接违反 INTENT C08 |
| 直播时辰的值是「巳时 9–11」这种中文串 | `parseBirthHour` 现在认汉字时辰（取该时辰中点）。改下拉 value 前先确认排盘不需要文本，别把解析写回只认数字 |

### Useful commands

```bash
pnpm install
pnpm dev                 # 9000 端口
pnpm test                # 83 个
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
| Git | 仓库 + remote，`main` 分支；**2026-10-31 的改动未提交**，清单见 §3 |
| Package manager | pnpm |
| Dev server | 9000 端口（2026-10-31 实测在跑，PID 24288）；精简版页面 `/live`；否则手动 `pnpm dev` / `.\start-dev.ps1` |
| 本机局域网 IP | `192.168.31.211`（DHCP，会变） |
| 数据 | `data/index.json` 114 条，全部按 formal；清理文件在 `data/_trash/`（17 个目录） |
| 精简版产物 | `data/name-library/allowlist-2026-10-31.json`（A 档 30 条）、`allowlist-2026-10-31-modern.json`（现代雅名 33 条）；`test-results/fast-live-*.png`、`fast-stress-*.json` |
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
7. **要动直播台出名字的逻辑，读 `src/fast/` 七个文件**（精简版），不要读 `stepfun-provider.ts`

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
> `/live` 姓氏输入框的 hydrate 竞态已修（见 §8）。2026-10-31 精简版改动未提交，见 §3。
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
- 分析结果**不落盘**（过程不是交付物）；点按钮后带 `surname + tabooChars + requirements` 走原 `/api/generate`，硬闸门照走

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
tests/analysis.test.ts             # 29 个用例
tests/fixtures/corpus/             # 测试用微型语料 + 字表
```

### 顺手改的

- `stepfun-provider.ts` 里那份私有的 `streamChat` 抽到 `src/providers/chat.ts`，取名和分析共用一份流解析
- `buildBaziSummary` 参数收窄成 `BaziInput`（`Pick<NormalizedRequest,...>`），分析复用排盘不用伪造整份表单

### 验证（2026-10-30 实测）

| 项 | 结果 |
|---|---|
| `pnpm typecheck` | 干净 |
| `pnpm test` | **92/92**（含 analysis 29 个、精简版 8 个） |
| 语料核验离线自检 | `pnpm tsx scripts/probe-analysis.ts` 全部符合预期，故意编的句子被驳回 |
| 真实模型分析 | 高登科 → cost，3 条问题，出处「全唐诗·登科后」核验通过并折成简体 |
| 一键改名 | 面板关闭、姓氏带过去、出「高承岳」 |
| 576×1024 / 1080×1920 | 输入、分析中、结论、底部按钮都不溢出（截图已删，需要时重跑） |
| `pnpm e2e` | **3 passed**（3.1m；其中「男女各三」那条 1.9m，因为 12 个候选都要带出处） |

### e2e 现在怎么跑（2026-10-30 已修通）

`reuseExistingServer` 会复用 9000 上已启动的 dev server，而那个 server 用的是 `.env.local`，所以账号也改成从 `.env.local` 读（`e2e/local-env.ts`）。之前 config 里写死 `change-me`，与 `.env.local` 的 `betterblue` 不符，3 个 spec 全挂在登录。

配套改了三处：

- 单测超时 30s → 240s：复用 server 时跑的是真实模型，一次 16–25 秒，用例里的 60–180 秒等待先前会被默认超时提前判死
- `globalSetup` 记下 `data/index.json` 现有 id，`globalTeardown` 把新增的 王/林/苏 报告挪进 `data/_trash/e2e-<时间>/`，用户历史不被污染
- 实测 3 passed（3.1m），跑前跑后 index 都是 114 条

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

## 9. 快速取名建库（2026-10-30 完成，2026-10-31 收口：**只有 30 条能上户口**）

> 用户与 gpt6 讨论产出 `需求稿 R2` + `设计稿 R2` 后，2026-10-30 拍板：先建库，其余步骤（快速接口、前端、容量模拟）**未获准**。
> 本节只记「已经决定的口径 + 做到哪一步」，规范以那两份文档为准。

### 结果（2026-10-30 收尾）

`data/name-library/library.json`，库版本 **2026-10-30.791**，0.67MB，全部本地、不进 git。

| 项 | 结果 |
|---|---|
| 条目 | **791** |
| 男向可用（含中性） | 552 / 300 ✅ |
| 女向可用（含中性） | 458 / 300 ✅ |
| 中性（两边可用） | 219 / 150 ✅ |
| 送审 → 通过 | 2654 → 791（29.8%），拒绝 1539、待定 324 |
| 出处分布 | 宋词 287、唐诗三百首 96、千家诗 75、文选 73、诗经 62、纳兰词 58、礼记 30、尚书 29、左传 23、孟子 13、楚辞 13、中庸 11、周易 11、论语 8、大学 2 |
| 独立自检 | `pnpm tsx scripts/name-library/qa.ts` 通过：引文全在原文、取字位置对得上、无重名、拼音完整、无网红名 |

**待定 324 条没有入库**，全在 `review/rejected.jsonl`（带 code 和 note），要放宽只需把 verdict 改成 approve 重跑 publish。

审核通过的拒绝原因分布：context 817、unnatural 756、relation 258、meaning 164、lean 81、homophone 59。

**通过率只有 29.8%，别指望"多起草就能多出"**：四轮共 1264 篇原句，最后停在 791。要再扩容，得继续加篇目（全唐诗 5.7 万篇还没启用，QUOTA 里写的是 0）。

### 为什么开这个坑

- 直播取名现在每次都现场调模型：正式页 16–25s，男女各三实测 **1.9 分钟**。
- 名字分析做过耗时实验：`reasoning_effort` 高/中/低 = 12.6/14.9/15.0s（**无差别**），换 `max_tokens` 也无差别，只有「提示词限死推理长度」能降到 9–12s。**现场推理的下限就是 10 秒级**，再调参数没用。
- 所以按设计稿：快速取名 = 离线预审名字库 + 本地筛选 + 报告快照，**取值和换组都不调 LLM**，P95 目标 2 秒。
- 详细取名（辈分字、避讳、生辰、单字）继续走现有 `/api/generate` 模型链路，快速库不带这些条件。

### 用户已确认的口径（2026-10-30）

| 项 | 决定 |
|---|---|
| 目标入库 | **750 条**：男向 300 / 女向 300 / 中性 150 |
| 草稿量 | **1500 条**（500 句原句 × 3，纯男/纯女/中性各一） |
| 审核 | 每批 **25 条**，子代理并行判，结论只有 `approve` / `reject(code)` / `flag` |
| 存储 | **全部留本地**。`data/` 仍整体 ignored，**不加 git 例外**，`library.json` 不进 git，部署要单独拷库 |
| 数量依据 | 需求稿 §11.2.1 负载反推：一场 130 次推荐 = 468 个名字位置（按方向各 234）；王姓 18% 一场约需 48 个同向名字 → 男女各 300 够一场零重复，七天窗口按「优先不重复」软轮转 |

### 五步流水线

| 步 | 做什么 | 脚本 | 产物 |
|---|---|---|---|
| 0 | 从语料挑 500 条干净原句（4–10 汉字、每篇最多 1 句、按书目配额） | `scripts/name-library/pick-lines.ts` | `drafts/lines.jsonl` |
| 1 | 模型起草：**给句子、让模型从里面取名**，10 句一请求 | `scripts/name-library/draft.ts` | `drafts/drafts.jsonl` |
| 2 | 自动校验：原文子串、字数、GB1、虚词/坏字、L1、去重、拼音、姓名谐音 | `scripts/name-library/validate.ts` | `drafts/validated.jsonl` |
| 3 | 子代理审核，每批 25 条 | 由会话内 workflow 派发 | `review/verdicts/batch-NNN.json` |
| 4 | 汇总发布 + 容量报告 | `scripts/name-library/publish.ts` | `library.json` / `capacity-report.md` |

### 目录（全部本地，不进 git）

```
data/name-library/
├── drafts/{lines,drafts,validated,raw-candidates}.jsonl
├── review/{batches,verdicts}/*.json
├── review/rejected.jsonl
├── library.json            ← 运行时只读，唯一被服务读的文件
├── disabled.json           ← 紧急停用（需求稿 §6.6）
├── _archive/library-<版本>.json
└── capacity-report.md
```

运行时路径一律按 `JINYU_DATA_DIR` 调用时求值：`${JINYU_DATA_DIR || ./data}/name-library/library.json`。测试用临时目录，不碰真实库（照 `report-store.ts` 的写法）。
**运行时不读 `drafts/`、不读 `review/`、不读 `data/corpus`** —— 这是 P95 两秒的前提。

### 已否掉的路线：不要再用「枚举连续两字」

写过一个 `scripts/name-library/extract.ts` 从语料枚举连续两字组合，实测漏斗：

| 阶段 | 数量 |
|---|---|
| 可用短句 | 956,772 |
| 连续两字窗口 | 4,285,923 |
| 两字都 GB2312 一级 | 3,860,832 |
| 去虚词 / 坏字 / 男女字混用 / 同字后 | 2,606,073 |
| 按名字去重 | **613,991** |

`在河`、`右流`、`之华`、`以望` 这种占绝大多数。再加「出现在 ≥5 篇」词频门槛仍有 **149,210** 条，没法审。
**结论：连续两字里真正的词是少数，能当名字的更少，枚举路线不可用。** 改成「给定原句 → 模型取词」，引文由题目给定，核验变成子串比对，不可能编造。

### 待修 bug：姓氏模式把名字里的多音字也改了

`src/domain/pinyin-name.ts:57` 用 `pinyin(full, { surname: "all" })`。pinyin-pro 的 `all` 会让 `getAllPinyin` 对**每一个字**都套姓氏读音表（`core/pinyin/all.mjs:11`），不只是首字：

| 姓名 | 现状 `all` | 应为 |
|---|---|---|
| 陈乐言 | chén **yuè** yán | chén **lè** yán |
| 周乐然 | zhōu **yuè** rán | zhōu **lè** rán |
| 解宁 | xiè **nìng** | xiè **níng** |

`"head"` 只把姓氏读音限制在姓氏位置，复姓（欧阳/司马）与多音姓（曾单仇查区朴尉繁）仍正确。**改一个字符串**，现有 `tests/pinyin-name.test.ts` 3 个用例没覆盖名字位置所以一直是绿的。
库每条要存「已确认读音」，所以建库前必须改掉，否则会把错音存进库。

### 风险（写在这里免得下个 session 重新发现）

- 模型起草会带自己的用字偏好（梓/涵/轩 那套）；`l2-chars.json` 只有 14 个字，热门字判断力不够，靠审核挡。
- 通过率可能低于 50%（模型容易从短句里取出「言之」「心之」）。若第 2 步后存活少于 1200，补一批原句重跑，**不动审核标准**。
- 出处分布会偏：诗经 305 篇、楚辞 65 篇，好取的词被反复挖容易撞名，靠配额 + 每篇 1 句压住。

### 收口（2026-10-31）：791 条里能上户口的只有 30 条

用户的标准是「这名字 2026 年真有人给孩子起」，不是「有出处、意思正」。按这个标准逐条过完：

| 结论 | 数据 |
|---|---|
| 791 条里 A 档（真能上户口） | **30 条**（男 11 / 女 14 / 双 5），已定版 `allowlist-2026-10-31.json` |
| 不合格主因 | 65% 是德性/字号字（进德、方刚、守志、大成、嘉绩）、景物并置（水天、江声、万松） |
| 正查（从古诗摘词）三轮 | 263 条草稿 → A 档仍停在 30，没有突破 |
| 反查（现代名找出处）80 条 | **A 档 0 新增**。89% 能找到句子，但「两个字同句出现过」≠「这名字出自那里」 |
| 全唐诗扩容（57,352 篇） | 按篇均匀抽 50 篇出 0 条；按名诗人抽 40 篇出 11 条 B 档、0 条 A |
| 现代榜单（2024/2025 各地公安） | 与这 30 条**零重合**。爆款全是造词（汐玥、璟泽、昱珩、钧泽），古籍里查不到 |

**结论：「既有出处、现代又真在用」这个交集在中国基本是空的**，30 条是这类名字的现实总量。榜单的正确用途是撞名黑名单（已把 2021/2020 top10 与 2024/2025 各地爆款写进 `l1-templates.json`，20 → 41 条）。

**不要再做的事**：继续手写名字库（拿一个人的口味替换另一个模型的口味，不可复现）；用榜单做「使用率闸门」（会把 30 条全判 0）；用宽松 substring 匹配当出处（会给「知夏」编出「曾不知夏之为丘兮」）。

### 语料事实（2026-10-31 实测，省得重查）

- `data/corpus/pieces.jsonl` 91,220 篇，字段 `s/t/x`，**有 `a`（作者）**——全唐诗 800/800 抽样都带，之前以为没有是错的
- 全唐诗 57,352 篇：31.2% 不足 40 字（残句）、1.2% 带校勘注文、篇名「句」重复 643 次
- **繁简混排**：诗经/论语/孟子/周易/大学/中庸是简体；全唐诗/宋词/古文观止是繁体；楚辞两套都有。搜不到先怀疑字形，别急着判「原文没有」
- **「沈」不折「沉」**：全唐诗「沈舟側畔」「沈吟」这类写法按现行折合会判失败
- **系辞被并进最后一卦**：`知微知彰` 挂在「未济（卦六十四）」篇名下，引文能过、篇名是错的

---

## 10. 精简快速版（2026-10-31 新增，直播专用）

> 与完整定制版**完全分开**：独立目录、独立接口、独立默认值。改它不会影响 `/api/generate`。

### 是什么

直播按一下出 4 个名字（首推 + 3 备选），每名一句为什么 + 出处。输入只有三个字段：**姓氏（必填）、性别（必填）、生日（可选）**。

**没有**：字数选择（恒双字）、辈分字、避讳字、具体要求、避开热门开关（恒开）、性别「未知」分支。

### 链路

```
表单{姓,性别,生日?} → src/fast/normalize.ts 只校验不补默认值
  → 有生日才本地排盘（lunar-javascript），四柱塞进提示词
  → src/fast/provider.ts 一次调用，5 个候选，每名 4 个字段（名/why/书名/篇名）
  → src/fast/gate.ts 闸门：字数/撞名 41/忌字 142/热门字标记/连姓谐音
  → src/fast/cite.ts 拿篇名回语料截原文（不是模型抄的）
  → 排序：有出处优先 → 非热门字 → 模型原序
  → 首推没出处时补一次单名查询，仍没有再用本地「两字相邻」兜底
  → app/api/fast/route.ts 一次性返回 JSON（不是 SSE）
```

**不落盘**：不写 `data/reports/`、不写 `index.json`。直播是即时产物，存图即交付。

### 文件

```
src/fast/types.ts      三字段输入 / FastCandidate / FastResult
src/fast/normalize.ts  只校验（姓 1-2 汉字、性别 male|female、生日真日期）
src/fast/prompt.ts     提示词常量 + 单名补出处提示词
src/fast/provider.ts   FastProvider：reasoning_effort=low，5 候选，max_tokens 4096
src/fast/cite.ts       篇名→原文，四级匹配 + 相邻词兜底
src/fast/gate.ts       精简版闸门 + 连姓谐音
src/fast/run.ts        编排
app/api/fast/route.ts  独立接口
tests/fast.test.ts     8 例（normalize 3 / gate 3 / cite 2）
src/config/forbidden-chars.json  142 字忌字表（gate 与 prompt 共用）
```

前端：`app/live/live-client.tsx` 的 `generate()` 改调 `/api/fast`；新增 `generateFull()` 走完整版，**只给「名字分析 → 一键改名」用**（那份约束含避讳与定向要求，精简版装不下）。

### 实测（2026-10-31，本机网关 opendesign/deepseek-v4.1-flash）

| 场景 | P50 | P90 | P95 | Max | 首推出处 |
|---|---|---|---|---|---|
| 5 候选（当前）30 轮 | 8.0s | 11.8s | **12.5s** | 15s | **30/30** |
| 6 候选 50 轮（已废） | 9.0s | 16.8s | 22.1s | 35.7s | 49/50 |

30 轮：成功 30/30，出处总数 96/120（80%）。真机 576×1024 三跑 7.5 / 9.0 / 4.4 秒。

完整版对照（同一台机器）：正式页 39.1s、直播女 40.7s、直播未知性别 **147.4s 出首屏、256.6s 完成**（两次调用叠加，不是单次）。

### 五个坑（别再踩）

| 坑 | 实测后果 | 正确做法 |
|---|---|---|
| 一上来把 91,220 行语料全 JSON.parse 成索引 | 首个请求 35.8s（其中 ~25s 是建索引），第二个 10.3s | 文件只读一次按行切分常驻，只对用到的书名过滤后再 parse，按书缓存 |
| 不设 `reasoning_effort`（用网关默认档） | 12.7s、推理吃满 2048 token、`finish=length`、只出 4 个名还被截断 | **显式 `low`**：5.2s / 835 token / 6 个名完整。这是唯一有效的旋钮 |
| 连姓谐音用「全名全等」比坏词表 | 全是死代码：坏词 2 音节（wude/shenjing），双字名连姓是 3 音节，永远匹配不上 | 比「姓 + 名首字」的前缀。沈静姝→shenjing 才能拦住 |
| 要求 6 个名字**全部**配出处 | 27–40s，偶发「模型没有返回可用的名字」 | 提示词写「只在有把握时给、最多 3 个、想不出立刻留空」；首推缺了再补一次单名（2–3s）；仍没有用本地相邻兜底 |
| 候选数要 6 个 | P95 22.1s、7/50 超 15s、最慢 35.7s | 只要 5 个（页面本来就只显示 4 个）。P95 → 12.5s、最慢 15s |

### 已知限制

- 备选仍有约 20% 没出处（造词名在语料里找不到相邻原词，只能留白）
- 首推出处依赖「篇名对得上」，实测 30/30，但换批语料或换模型要重测
- 没做并发压测（单机单主播串行够用）
- 精简版出的名字没有人工复核过，前 100 个建议先存一份看

---

## 11. 精简版提示词与出处核验（2026-10-31 第二轮）

> 起因：用户要求「提示词是精简版的灵魂，必须调出独特价值，不然谁都能拿 AI 起名」。
> 只动 `/api/fast` 这条链路，没碰 `/api/generate`。

### 改了什么

| 文件 | 改动 |
|---|---|
| `src/fast/prompt.ts` | 重写：语域标尺（A 档 12 条）、why 禁字典拆解、出处要求「那半句要能当众念」、连姓念一遍、姓氏读音进 user 消息、推理限死 |
| `src/fast/cite.ts` | 新增 `citeFromLine`（核模型给的原句）、引文闸门 `QUOTE_BLOCK`、兜底不取文选/古文观止、系辞篇名纠正 |
| `src/fast/provider.ts` | `RawFast.line`；`citeOne` 也索取原句 |
| `src/fast/run.ts` | 有 `line` 先逐字核，核不过才回原文截；`recent` 本地去重 |
| `src/fast/types.ts` | `FastFormInput.recent`（这一场已经给过的名字） |
| `app/live/live-client.tsx` | 记最近 12 个名字随请求带上 |
| `tests/fast.test.ts` | 12 → 14 例：原句核验 4 例、展示闸门 2 例 |

### 出处现在怎么定

```
模型给 {source, piece, line}
  → citeFromLine：line 逐字出现在那一篇里（繁折简、去标点）、名字两字按顺序在 line 里
      → 通过：quote 就用模型这一句
      → 不通过：退回 locateCitation 去原文截（这一步最容易截到怪句子）
  → 都不行：留白，直播页那一行不出现
```

### 实测（沈姓女宝，本机网关，单机串行）

| 版本 | 单轮耗时 | 出处命中 | 引文质量 |
|---|---|---|---|
| 改前（无 line） | 2.6–10.5s，中位 **5.6** | 20/24（83%） | 会出现「音晏衍兮要婬」「诗书宁救眼前贫」这类坏句 |
| 改后（line 逐字核） | 4.1–14.1s，中位 **9.7–12.4** | 22–24/24（92%） | 坏句基本消失；「清和」变成「四月清和雨乍晴」「清和条昶」 |

**代价是 3–5 秒**：让模型抄原句是纯检索动作，`reasoning_effort=low` 压不住。

### 一条最容易踩的坑：推理必须限死

同一条提示词，只写「推理不超过 100 字」时，模型约每 6 轮有 1 轮逐条自查，推理 4800 字、单轮 26 秒。
改成「推理里只写候选名字，不要写理由、不要写分析」后，6 轮全在 3.2–6.7 秒。

### 去重：提示词侧三条路都太慢，只能本地做

需求是「同一场不要反复给令仪/知微」。实测：

| 做法 | 单轮耗时 |
|---|---|
| user 消息报「这一场给过这些名字」 | 14–16s，偶发只返回 1 个可用名字 |
| 改报「这些字用过，避开」 | 2.3–31.4s，抖动更大 |
| 每轮换一部书当落脚点（诗经/楚辞/…） | 8.0–22.1s，名字确实散了但慢 |
| temperature 0.5 → 0.8 | 6.2–8.7s，**名字没变**（4 轮全是令仪） |

现在只做本地过滤（`run.ts` 的 `recent`）：模型给重了就在结果里剔掉，剔到不够 3 个就不敢剔、原样放行。零耗时，只能挡一部分。

### 还没解决

- 名字收敛：令仪/知微/清越每轮都在，「有十足把握的出处」本身就窄。
- 篇名仍可能错：语料把周易系辞并进「未济（卦六十四）」，已在 `relabelPiece` 里按模型说法纠正；其他书的篇名没核过。
- 兜底截句仍可能给不合适的句子（`QUOTE_BLOCK` 只挡淫丧贫病那类字，不判断用得对不对）。

### 怎么回退

只想要速度：把 `run.ts` 里两处 `citeFromLine` 去掉、`prompt.ts` 的 `line` 字段与四条相关规则删掉，就回到 5.6s 中位；`cite.ts` 的闸门和篇名纠正与 line 无关，可以留着。

---

## 12. 第三轮：3–5 秒预算、闸门补漏、加载页与存图一致（2026-10-31）

> 起因：用户定了路线——**直播就是模型跑精简提示词、3–5 秒**，不再讨论离线库。
> 于是这一轮的目标只有两个：把耗时压进预算，并且让"我们不是普通起名工具"这件事看得见。

### 改了什么

| 文件 | 改动 |
|---|---|
| `src/fast/prompt.ts` | 删「连姓念一遍」「候选之间不重复用字」「41 个烂大街名 + 26 个热门字两串清单」「五个名字的声调别全是一种」；出处段 10 行并成 5 行，消掉原第 110 行与第 113 行的自相矛盾。1536 → 1128 字 |
| `src/fast/gate.ts` | 新增「姓与名首字同音」（王望、林临、欧阳阳）+ `SURNAME_CHAR_TRAP`（沈默→沉默、沈思→沉思…拼音不同音，只能按字拦） |
| `src/fast/cite.ts` | 分句改成「句号、逗号、顿号、冒号都算」，删掉跨行的开窗兜底；`displayableQuote` 补拦语料缺字方块 □ 与扩展区生僻字；删 `findAdjacentCitation` / `scanSourceForWord` / `ADJACENT_ORDER` |
| `src/fast/run.ts` | 去重窗口 12 → 20（≈5 轮），截断改成留尾部；新增 `dedupeChars`；不再走本地相邻兜底；`onStage` 抛真实阶段；`debug` 带 drafted/kept/withLine/推理字数/首字毫秒/被拦名单 |
| `src/providers/chat.ts`、`src/fast/provider.ts` | `streamChat` 返回 `reasoningChars` / `firstTokenMs`；provider 记 `lastDraft` |
| `app/api/fast/route.ts` | `?stream=1` 走 NDJSON：逐条推阶段，最后推 result；不带参数仍是原来的 JSON |
| `app/live/live-client.tsx` | `ShowData` 收敛成唯一规格（屏幕和 canvas 都只吃它）；加载页逐帧回放真实阶段；引文证据块 + 核验戳 + 场次账 + 带调拼音；canvas 重排成光标式布局、备选三列 |
| `src/domain/pinyin-name.ts` | 新增 `nameSyllables()`：逐字拼音 + 声调 |
| `scripts/probe-fast.ts` | 每轮多打两行：`gate:`（给了几个/过几个/带句几条/拦了谁为什么）和 `cost:`（首字毫秒/推理字数） |
| `tests/fast.test.ts` | 19 例：新增同音 4 例、沈默类 2 例、窗口留尾部 2 例、方块/生僻字 1 例 |

### 实测（沈姓女宝，本机网关，单机串行）

| 轮次 | 八轮耗时 | 推理字数 |
|---|---|---|
| 第一轮（无打点） | 2.0 / 2.2 / 2.3 / 2.4 / 3.8 / 4.1 / 6.2 / 14.3 秒 | 未记录 |
| 第二轮（无打点） | 2.1 / 2.2 / 2.4 / 3.8 / 4.1 / 6.7 / 7.4 / 14.3 秒 | 未记录 |
| 第三轮（有打点） | 2.1 / 2.1 / 2.2 / 2.2 / 2.3 / 2.4 / 2.8 / 3.4 秒 | **7 轮 0 字，1 轮 11 字** |

结论：**3–5 秒达标，中位 2.3 秒，推理基本归零**。删「声调别全是一种」那一刀是最后一步——它单独就驱动过 537 字推理。

前两轮的 14 秒没有打点，**不能断言是推理还是网关排队**；第三轮同提示词一次都没出现，倾向网关侧，但要复现得再跑几轮看 `cost:` 行。

### 代价（都写在明处）

- **出处变少**：关掉本地相邻兜底后，每轮 4 个名字里带出处的是 0–2 条（模型给几句算几句）。换来的是 0 条不能念的引文——那一批兜底句近一半不能上直播（隔逗号、跨词、缺字方块）。
- **同音判定会误伤同音不同调**（苏素、何禾），8 轮实测没触发。
- 加载页逐帧回放给揭晓加了约 0.8 秒（3 帧 × 260ms）。**这些阶段本身只花几毫秒、全在模型返回之后**，所以是回放事实，不是实时进度。

### 屏幕与存图一致

`ShowData` 是唯一规格，DOM 与 canvas 都只吃它。两边现在都有：姓名 / 带调拼音 / why / 标签 / 引文 + 篇名 + 核验戳（连出·分取是算出来的）/ 本场第 N 个 / 备选 ×3（名 + 拼音 + why）。

以前的漂法：DOM 吃 `rows`、canvas 吃 `cardRows`，于是备选在屏幕上只有名字、在图里却带 why 和出处。**要加字段就两边一起加**，否则一致性立刻破。

屏幕上的 `REVEAL / No.xxx` 只在「刻版」皮肤显示（CSS `display:none`），所以存图里那行删掉了；场次信息统一由「本场第 N 个」承担。

### 已知限制

- 没跑 e2e；只跑了 `pnpm typecheck` 与 `pnpm test`（103 例）。
- gate 的拦截现在只在探针里可见，直播页只显示被拦的名字，不显示累计次数。
- 备选不带核验戳（只有首推带）。

### 怎么回退

想把出处拉回来：`git show <本轮之前>:src/fast/cite.ts` 取回 `findAdjacentCitation`，在 `run.ts` 的备选/首推两处接上，再决定要不要保留分句与方块闸门（那两个和兜底无关，建议留）。

---

## Self-check

- 2026-10-31：新增 §10（精简快速版）、§9 收口（791 条只有 30 条能用）、坑表补 5 行、验证表补 4 行
- 2026-10-31 第二轮：新增 §11（提示词重写 + line 逐字核 + 引文闸门）；耗时与命中率都是本轮实测（每版 4–6 轮），不是估计
- 2026-10-31 第三轮：新增 §12（3–5 秒预算、闸门补漏、加载页真实阶段、屏幕与存图共用一份规格）；耗时是三次八轮实测，标注了哪几轮没有打点
- 单测 98/98（fast 14 例）、typecheck 干净、`/live` 576×1024 真机点出名字并带出处
- 精简版的耗时数字全部来自本轮实测（50 轮 + 30 轮 + 真机三跑），不是估计
- 已区分「已提交 / 未提交」：本轮改动全部未提交，清单见 §3
- 已区分「已验证 / 未验证」：并发压测未做、备选出处在 20% 情况下留白，都写进 §10 已知限制
- 路径和命令具体，无密钥值
- git 状态与实测一致：2026-10-30 的改动已提交推送；2026-10-31 的改动**全部未提交**，清单写在 §3，没把未提交写成已提交
- 直播台的取舍（去排队、皮肤来源、窗口捕获、缩放坑）都写清楚了
- 直播未知性别六选这一块（liveUnknownSix）单独成节，别和正式页逻辑搞混
- 新 session 只看这个文件就能接手
