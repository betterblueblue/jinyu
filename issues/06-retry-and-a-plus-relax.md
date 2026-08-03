# 候选不足：有限重试 + A+ 软放宽 + 失败回表单

Status: done
Type: AFK
Parent: docs/PRD.md（瑾瑜 0→1）

## What to build

完善 Generation Orchestrator 在候选不足时的策略：

1. 有限自动重试（再调 LLM 端口要候选）
2. 仍不足则仅自动放宽软约束（如风格硬贴合、L2 可进首推），并在报告写入「已放宽 XX」
3. 仍不足则失败，用白话说明原因（辈分/避讳/热门等），引导回改表单

永不放宽：L1、避讳、辈分必含、未出生禁精确八字、字数模式。超时与失败均可重试。

## Acceptance criteria

- [ ] Fake LLM 先返回不足集时会触发有限重试
- [ ] 重试后仍不足会放宽软约束，报告中可见「已放宽」说明
- [ ] 硬规则（L1/避讳/辈分/字数）在放宽路径中仍生效
- [ ] 最终仍不足时生成失败，错误可读且指向可改表单字段
- [ ] 用户可从失败态重试或回表单修改后再次提交
- [ ] 编排层用 Fake Provider 单测覆盖：重试、A+、失败原因映射

## Blocked by

- `issues/05-l2-soft-preference.md`

## User stories covered

24, 25, 26, 63, 69
