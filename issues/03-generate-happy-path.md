# 一次生成金路径（Fake LLM → 组装 → 在线报告 + 快照）

Status: done
Type: AFK
Parent: docs/PRD.md（瑾瑜 0→1）

## What to build

打通主路径 tracer bullet：表单提交后同步等待，展示阶段（候选生成 → 硬规则过滤 → 报告排版），用可替换的 Fake LLM Provider 产出可控候选，经编排组装为固定结构的 Report Document，在线展示至少含总览（首推 + 名单 + 一句话建议），并将完整文档作为历史快照入库。

生成中防重复狂点。本切片可暂用「透传闸门」（不过滤或最小过滤），硬规则深度在后续 issue 加强；但接口边界要保留 LLM 端口、闸门、组装器、编排器、Report Store，便于后续挂载。

## Acceptance criteria

- [ ] 提交后展示阶段提示：候选 → 过滤 → 排版（顺序正确）
- [ ] Fake LLM 可注入可控候选，不依赖真实外网模型
- [ ] 成功后进入在线报告页，至少展示总览：首推、名单、一句话建议
- [ ] Report Document 写入存储；生成完成时固化快照
- [ ] 生成进行中重复提交被抑制或合并，不造成混乱请求
- [ ] 超时或失败有可重试入口（最小可用即可）
- [ ] 模块边界清晰：Candidate Provider 端口、Orchestrator、Assembler、Store 可单测替换

## Blocked by

- `issues/02-naming-form-normalizer.md`

## User stories covered

1, 22, 23, 28, 32, 47, 53, 61, 70
