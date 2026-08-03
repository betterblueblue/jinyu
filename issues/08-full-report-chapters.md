# 完整报告章节（逐名详解 / 不推荐 / 决策建议）

Status: done
Type: AFK
Parent: docs/PRD.md（瑾瑜 0→1）

## What to build

按固定章节顺序组装并渲染完整正式报告（Report Document 为在线页与快照的单一事实来源）：

1. Overview（首推、名单、一句话建议）
2. Per-name details（音韵与字形、寓意与出处、实用避坑、风格贴合、L2 标记等）
3. Not-recommended / eliminated（不推荐/淘汰说明）
4. Bazi summary（仅开启八字时，本切片可预留空位/条件渲染）
5. Decision advice（首推与备选定位，可与总览呼应）

语气正式、少空话套话。首推在总览与后文一致可识别。出处首版无字典核验，产品不承诺零幻觉（提示约束即可）。

## Acceptance criteria

- [ ] 在线报告章节顺序固定，先见名字后见分析
- [ ] 每个推荐名含音韵字形、寓意出处、避坑说明
- [ ] 报告含不推荐/淘汰说明（可含 L1 等闸门原因）
- [ ] 报告含决策建议（首推与备选定位）
- [ ] 首推在总览与决策建议中一致可识别
- [ ] 未开启八字时不出现精确四柱表演章节内容
- [ ] 组装器测试可断言章节结构与首推一致性（不绑定 LLM 辞藻原文）

## Blocked by

- `issues/07-gender-and-name-length.md`
- `issues/04-hard-rule-gate.md`（淘汰原因进报告）

## User stories covered

33, 34, 35, 36, 37, 40, 67, 68, 111
