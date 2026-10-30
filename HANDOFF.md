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
| `bamboo` | 竹兰 | **背景图** `public/skins/bamboo-paper.webp` |

**四个状态**：待机输入 / 生成中 / 揭晓 / 补充信息面板（抽屉）

**交互（最新版，已去掉排队）**：

- 填姓氏 → 点「开始取名」大按钮（或回车/空格）→ 直接生成
- 空姓氏时按钮 `disabled`，半透明
- 揭晓后点「下一个」或按空格 → 回输入态并清空姓氏
- `1` `2` `3` 切男/女/未知，`S` 换肤，`Tab` 开补充面板，`Esc` 关
- **队列功能已删除**（用户决定：直播时手动录入，不需要排队）

**文件**：

```
app/live/page.tsx              # 登录校验 + 渲染 LiveClient
app/live/live-client.tsx       # 全部逻辑（状态机/SSE/存图）
app/live/live.css              # 四套皮肤变量 + 竖屏版式
app/api/reports/[id]/route.ts  # 新增：返回报告 JSON（/api/generate 只回 reportId）
public/skins/bamboo-paper.webp # 竹兰背景，28KB
tools/fit-window.ps1           # 把浏览器窗口校正成精确 9:16 客户区
启动直播台.bat                  # 直播启动器（ASCII 编码，自动找 Edge/Chrome）
```

**存图**：Canvas 手绘，1080 宽、高度按内容自适应（约 2000–2300）。内容是主名字 + 拼音 + 寓意 + 3 标签 + 6 项详解 + 2 个备选（各带 4 项详解）。四套皮肤各自配色，竹兰用同一张背景图 `drawImage` 铺底。

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
| 卡片左下角兰花压在备选左栏「避坑」标签上 | 花很淡，字能看清，只是叠着。彻底解决需单独生成 9:19 的卡片背景 |
| 直播页详解限制 2 行、备选寓意限制 2 行 | 真实数据可能被省略号截断，完整内容在存图里 |

### Verifications that **passed**

| Check | Command / method | Result |
|---|---|---|
| Unit tests | `pnpm test` | Exit 0；**34/34** passed（2026-10-30 复跑，比 handoff 旧版多出的 3 个是直播六选的用例） |
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

### Useful commands

```bash
pnpm install
pnpm dev                 # 9000 端口
pnpm test                # 34 个
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
| Git | 仓库 + remote，`main` 分支，工作区干净，最近 7 个 commit 见上 |
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

## Self-check

- 区分了「已完成 / 未提交 / 未验证」
- 路径和命令具体，无密钥值
- git 状态与实测一致（4 个 commit 已提交、工作区干净），没把未验证的事写成已验证
- 直播台的取舍（去排队、皮肤来源、窗口捕获、缩放坑）都写清楚了
- 直播未知性别六选这一块（liveUnknownSix）单独成节，别和正式页逻辑搞混
- 新 session 只看这个文件就能接手