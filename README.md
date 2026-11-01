# 瑾瑜（jinyu）

网页端通用命名：给宝宝起名、成人改名皆可。登录 → 填表 → 一次生成正式在线报告 → 下载精选摘要图 → 历史快照回看。

- 产品文档：[`docs/PRD.md`](./docs/PRD.md)
- 意图记录：[`docs/intent/2026-07-23-001-jinyu.md`](./docs/intent/2026-07-23-001-jinyu.md)
- 技术栈：[`docs/TECH.md`](./docs/TECH.md)
- UI 风格：[`docs/UI.md`](./docs/UI.md)
- 实现切片：[`issues/`](./issues/)

## 技术栈（摘要）

**Next.js（App Router）+ TypeScript** 全栈 · 本地 JSON 报告快照 · Zod · Vitest · Playwright E2E · Fake/Real LLM 端口 · 摘要图（Satori 优先）。

**真 LLM**：本机 OpenAI 兼容网关 · 模型 `opendesign/deepseek-v4.1-flash` · Chat Completions（`LLM_BASE_URL` + `LLM_API_KEY`，见 `docs/TECH.md` 与 `.env.example`）。

细节与目录约定见 `docs/TECH.md`。

## 本地配置

```bash
cp .env.example .env.local
# 编辑 .env.local：填入 LLM_API_KEY、预置账号等
```

`.env.local` 已被 gitignore，不要把真实 Key 提交进仓库。

## 开发

```bash
.\start-dev.ps1   # 一键启动（检查依赖/端口 → pnpm dev，访问 http://localhost:9000）
pnpm test         # 单元测试（Fake LLM）
pnpm e2e          # Playwright Fake 金路径（自动起 dev server，强制 Fake）
npx playwright test --config=playwright.real.config.ts   # 真实 LLM 链路 + 穷举回归（需先起 dev server）
```

## 语料（名字分析的出处核验要用）

直播台的名字分析会把模型给的引文拿回原文逐字核对，底本放在 `data/corpus/`（不进 git）：

```bash
pnpm corpus:build   # Unihan 字表 + 23 部语料，约 31MB，首次要下载几分钟
```

只装字表不装语料也能跑，只是所有引文都会降级成「暂无可核出处」，不会编。

默认账号见 `.env.example`（`jinyu` / `change-me`，可用 `.env.local` 覆盖）。  
**本地默认走真 LLM**（本机网关）；仅单测 / Playwright 强制 Fake。无 key 时才会回退 Fake（历史列表会标注「示例」）。

## 状态

0→1 应用与 14 条 issue 对应能力已落地；领域单测 + Fake E2E 金路径 + 真实 LLM 链路（含穷举回归）见上。

2026-10-31 起主要用在直播：直播台 `/live` 起名（11-01 起首推由模型起，名字库定口味、模型出错时补位）、给观众报的名字打分和改字，主播提词页 `/live/prompter`。系统怎么搭、怎么跑见 `HANDOFF.md`，做到哪见 `docs/总体方案.md`。
