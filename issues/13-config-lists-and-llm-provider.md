# 配置化 L1/L2 词表 + 可替换真实 LLM Provider

Status: done
Type: AFK
Parent: docs/PRD.md（瑾瑜 0→1）

## What to build

- 将 L1 组合/模板、L2 单字等名单外置为可配置数据，便于维护热门趋势而不改核心闸门代码
- LLM Candidate Provider 支持 Fake / Real 切换；真实调用密钥来自环境变量
- **RealProvider 默认接 StepFun**：OpenAI 兼容 `POST {LLM_BASE_URL}/chat/completions`，模型 `step-3.7-flash`（见仓库 `docs/TECH.md` / `.env.example`）
- 测试与 CI 强制 Fake，不依赖外网模型
- 硬规则与 LLM 保持解耦：换 Provider 不改变闸门契约

## Acceptance criteria

- [ ] L1/L2 名单可从配置/数据文件维护，改名单无需改闸门算法代码
- [ ] 存在 FakeProvider 与 StepFun（OpenAI 兼容 Chat Completions）RealProvider
- [ ] env：`LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`、`LLM_USE_FAKE` 生效；密钥不入库、不进前端
- [ ] 默认测试/E2E 走 Fake；本地可关 Fake 打真接口
- [ ] 换 Provider 后 Hard Rule Gate 与 Orchestrator 契约不变（契约测试或等价验证）

## Blocked by

- `issues/04-hard-rule-gate.md`
- `issues/05-l2-soft-preference.md`

## User stories covered

58, 59, 97, 98
