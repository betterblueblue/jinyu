# 可选八字路径（默认关、精度有限、未出生禁精确盘）

Status: done
Type: AFK
Parent: docs/PRD.md（瑾瑜 0→1）

## What to build

实现 Bazi Optional Engine 与报告条件章节：

- 八字/五行默认关闭；主路径不被命理绑架
- 开启后须有公历生日；无时辰仍可出六字盘并标注精度有限
- 未出生/预产期不得当精确出生时刻排盘；报告标明备名语境
- 开启时报告含命理摘要，措辞克制，禁止「必然用神/铁口」类定论
- 未开启时报告不出现精确四柱表演

## Acceptance criteria

- [ ] 默认关闭时报告无精确四柱/用神表演内容
- [ ] 开启 + 有生日可产出克制命理摘要 DTO 并出现在报告约定位置
- [ ] 开启但无时辰：六字（年月日）+ 精度有限标注
- [ ] 未出生或仅预产期：拒绝精确排盘；备名说明出现在报告
- [ ] 文案无铁口/必然用神类表述（可用固定禁用词或快照断言）
- [ ] 关/开/无时辰/未出生路径有单测，不依赖真实 LLM

## Blocked by

- `issues/02-naming-form-normalizer.md`
- `issues/08-full-report-chapters.md`（章节挂载点）

## User stories covered

12, 13, 14, 15, 38, 39, 41, 79
