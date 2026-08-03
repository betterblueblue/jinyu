# 性别策略与名字字数模式进报告

Status: done
Type: AFK
Parent: docs/PRD.md（瑾瑜 0→1）

## What to build

把性别与字数策略落实到组装后的 Report Document 与在线展示：

- 性别已知：约 3～5 个精选名，不分组
- 性别未知：男向 + 女向分组，总量约 4～5，报告说明出生后可按性别收窄
- 同一次报告内名字字数与表单模式一致（两字或一字），摘要与列表不混排

## Acceptance criteria

- [ ] 性别男/女时推荐约 3～5，无男/女分组结构
- [ ] 性别未知时男/女分组展示，总量约 4～5，含「出生后按性别收窄」说明
- [ ] 两字名模式下全部推荐为两字名；一字名模式同理
- [ ] 总览名单与逐名列表字数一致
- [ ] 用 Fake 候选可断言数量、分组与字数行为

## Blocked by

- `issues/04-hard-rule-gate.md`

## User stories covered

7, 8, 9, 29, 30, 31, 36
