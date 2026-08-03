# 技术栈决议（瑾瑜 / jinyu）

Status: decided  
Date: 2026-07-23  
Source: 用户确认「Next.js + TS 全栈（推荐）」；细节由实现默认补齐，变更需显式改本文件。

## 约束（来自 PRD）

- 可跑自动化测试（单测 + 一条 E2E，Fake LLM）
- 可持久化 Report Document 快照
- 可调 LLM（可替换 Fake / Real）
- 可导出摘要图片
- Greenfield：不依赖 jinyutreasury 运行时
- 单用户、预置账号、密钥走环境变量

## 选定栈

| 层 | 选择 | 说明 |
|---|---|---|
| 运行时 | Node.js 20+（本机已有 24） | 包管理优先 **pnpm**（本机已有） |
| 框架 | **Next.js（App Router）+ TypeScript** | 页面与 Route Handlers 一体，垂直切片好切 |
| UI | React + **Tailwind**（与 jinyutreasury 一致，便于迁 tokens） | 气质与页面细则见 [`UI.md`](./UI.md) |
| 校验 | Zod | 表单与 API 边界共用 schema |
| 会话 | 服务端 session + httpOnly cookie（可用 `iron-session` 或等价轻量方案） | 预置单账号；无 OAuth/注册 |
| 存储 | **本地 JSON 文件**（`data/reports/*.json` + `data/index.json`） | 单用户足够；等价 SQLite 级快照持久化，免原生编译；可再迁 SQLite |
| LLM 端口 | 自研 `CandidateProvider` 接口；`FakeProvider` 用于测试/CI；生产默认 **StepFun**（见下） | 闸门与 Provider 解耦 |
| 硬规则 / 编排 | 纯 TS 领域模块（可单测，不绑 React） | Gate / Orchestrator / Assembler 放 `src/domain` 或 `src/server` |
| 摘要图 | **Satori + resvg-js**（或 `@vercel/og` 思路）优先；不行再退 Playwright 截卡片 DOM | 输出 PNG 字节流 |
| 单测 | Vitest | 表驱动闸门、Normalizer、编排 Fake 路径 |
| E2E | Playwright | 一条金路径：登录→填表→报告→下图→历史 |
| 配置 | `.env.local` + 示例 `.env.example` | 预置账号、LLM key、L1/L2 可文件配置 |

## LLM 接入（已拍板）

| 项 | 值 |
|---|---|
| 厂商 | **StepFun（阶跃）** |
| 协议 | **OpenAI 兼容 Chat Completions**（首选实现） |
| Base URL | `https://api.stepfun.com/step_plan/v1` |
| Chat Completions | `https://api.stepfun.com/step_plan/v1/chat/completions` |
| Messages（Claude 风格，备选） | `https://api.stepfun.com/step_plan/v1/messages` |
| 默认模型 | **`step-3.7-flash`** |
| API Key | 仅存 `.env.local` 的 `LLM_API_KEY`，**禁止**写入代码/文档/issue |

环境变量约定：

```bash
LLM_PROVIDER=stepfun
LLM_BASE_URL=https://api.stepfun.com/step_plan/v1
LLM_API_KEY=...          # 仅 .env.local
LLM_MODEL=step-3.7-flash
LLM_USE_FAKE=false       # 本地默认 false=真 LLM；仅 CI/单测/E2E 设 true
```

实现约定：

1. `RealProvider` 按 **OpenAI Chat Completions** 调 `POST {LLM_BASE_URL}/chat/completions`（base 已含 `/step_plan/v1`）。
2. **产品/本地默认走真 LLM**；`LLM_USE_FAKE=true`、单测环境、或无 `LLM_API_KEY` 时才用 `FakeProvider`。
3. Playwright e2e 在 webServer env 中强制 `LLM_USE_FAKE=true`，不耗额度。
4. Claude Messages 端点作为备选，MVP 不必实现，除非 OpenAI 兼容路径不通。
5. 换模型只改 `LLM_MODEL`；换网关只改 `LLM_BASE_URL` + key。

## 建议目录（实现时可微调，但边界要对齐 PRD）

```
jinyu/
  app/                 # Next App Router：登录、表单、生成、报告、历史
  src/
    domain/            # Normalizer, Gate, Ranker, Bazi, Assembler, Orchestrator
    providers/         # Fake + Real LLM
    store/             # Report Store (SQLite)
    auth/              # session
    render/            # Summary Card
    config/            # L1/L2 lists
  tests/               # unit
  e2e/                 # Playwright 金路径
  docs/
    PRD.md
    TECH.md            # 本文件
    UI.md
    intent/            # INTENT 归档
  issues/
  README.md
```

## 明确不做

- 不在 jinyutreasury 上挂路由/共库
- 不做开放注册、付费墙、PDF、多轮精修队列
- 首版不做字典出处核验服务

## 与 issues 的关系

- `01-scaffold-login`：按本栈初始化 Next 应用 + 预置登录
- 领域逻辑优先可单测的 TS 模块，UI 只调编排入口
- 默认测试路径始终 Fake LLM

## 变更规则

若改框架（例如换 Vue/Nuxt 或 Python），先改本文件并告知用户；不要静默换栈。
