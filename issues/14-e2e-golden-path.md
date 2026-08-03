# E2E 金路径（Fake LLM）

Status: done
Type: AFK
Parent: docs/PRD.md（瑾瑜 0→1）

## What to build

建立最小 E2E 脚手架，用 Fake LLM 跑通一条金路径自动化：

登录 → 填写合法表单 → 等待生成完成 → 断言在线报告关键结构 → 下载摘要图 → 打开历史快照回看。

不测 LLM 辞藻原文，不绑私有函数名。UI 以这一条主流程覆盖即可，避免重组件快照测试。

## Acceptance criteria

- [ ] 存在可本地运行的 E2E 命令（如 Playwright 或等价）
- [ ] 金路径：登录 → 填表 → 报告可见 → 可下载摘要图 → 历史可打开快照
- [ ] 全程使用 Fake LLM，不依赖真实外网模型
- [ ] 失败时输出可读错误，便于回归
- [ ] README 或项目文档中写明如何运行该 E2E

## Blocked by

- `issues/01-scaffold-login.md`
- `issues/02-naming-form-normalizer.md`
- `issues/03-generate-happy-path.md`
- `issues/10-summary-card-image.md`
- `issues/11-history-snapshot.md`

## User stories covered

Testing Decisions — E2E 金路径；综合覆盖 1, 2, 22, 44, 48–50 等主流程
