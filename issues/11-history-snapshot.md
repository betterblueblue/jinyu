# 历史列表 + 快照回看 + 再下摘要图

Status: done
Type: AFK
Parent: docs/PRD.md（瑾瑜 0→1）

## What to build

实现 Report Store 的列表与详情回看：

- 历史列表：时间、姓、性别、名摘要
- 点进历史：展示生成时的全文快照，不重新跑模型/闸门
- 历史详情可再次下载摘要图
- 关闭浏览器后同一预置账号仍可看到历史

## Acceptance criteria

- [ ] 生成成功后历史列表出现对应条目（时间、姓、性别、名摘要）
- [ ] 打开历史详情为生成时固化内容，读取路径不触发 LLM/闸门
- [ ] 历史详情可再次下载摘要图
- [ ] 登出再登录同一账号后历史仍在
- [ ] Store 层测试：写入后读取不变；读取不调用 Candidate Provider

## Blocked by

- `issues/03-generate-happy-path.md`
- `issues/10-summary-card-image.md`

## User stories covered

48, 49, 50, 70, 112
