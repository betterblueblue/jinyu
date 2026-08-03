# 精选摘要卡图片下载

Status: done
Type: AFK
Parent: docs/PRD.md（瑾瑜 0→1）

## What to build

实现 Summary Card Renderer：从 Report Document 生成可下载的精选摘要图（非 PDF、非整报告长图）。

卡片内容：3～5 名（性别未知时男/女分组）各一行 + 一句、首推标记、回看全文入口；不塞满音韵/出处/命理全文。报告详情页提供下载入口。

## Acceptance criteria

- [ ] 报告详情可下载摘要图（图片字节流/文件）
- [ ] 图中含名单层信息：各名一行一句、首推可识别
- [ ] 图中含回看全文入口（链接或等价提示）
- [ ] 图中不含逐名全文音韵/出处/命理大段
- [ ] 性别未知时分组呈现与报告一致
- [ ] 首推与在线报告总览一致
- [ ] 有针对渲染输入→输出字段的测试或可验证样例（可用固定 Report Document 夹具）

## Blocked by

- `issues/08-full-report-chapters.md`

## User stories covered

44, 45, 46, 84, 85
