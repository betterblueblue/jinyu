# 瑾瑜（jinyu）

网页端通用命名：给宝宝起名、成人改名皆可。登录 → 填表 → 一次生成正式在线报告 → 下载精选摘要图 → 历史快照回看。

- 产品文档：[`docs/PRD.md`](./docs/PRD.md)
- 意图记录：[`docs/intent/2026-07-23-001-jinyu.md`](./docs/intent/2026-07-23-001-jinyu.md)
- 技术栈：[`docs/TECH.md`](./docs/TECH.md)
- UI 风格：[`docs/UI.md`](./docs/UI.md)
- 实现切片：[`issues/`](./issues/)

## 技术栈（摘要）

**Next.js（App Router）+ TypeScript** 全栈 · SQLite 快照 · Zod · Vitest · Playwright E2E · Fake/Real LLM 端口 · 摘要图（Satori 优先）。

**真 LLM**：StepFun · 模型 `step-3.7-flash` · OpenAI 兼容 Chat Completions（`LLM_BASE_URL` + `LLM_API_KEY`，见 `docs/TECH.md` 与 `.env.example`）。

细节与目录约定见 `docs/TECH.md`。

## 本地配置

```bash
cp .env.example .env.local
# 编辑 .env.local：填入 LLM_API_KEY、预置账号等
```

`.env.local` 已被 gitignore，不要把真实 Key 提交进仓库。

## 开发

```bash
pnpm install
pnpm dev          # http://localhost:9000
pnpm test         # 单元测试（Fake LLM）
pnpm e2e          # Playwright 金路径（自动起 dev server，强制 Fake）
```

默认账号见 `.env.example`（`jinyu` / `change-me`）。  
**本地默认走真 LLM**（StepFun）；仅单测 / Playwright 强制 Fake。无 key 时才会回退 Fake。

## 状态

0→1 应用与 14 条 issue 对应能力已落地；领域单测 + E2E 金路径见上。
