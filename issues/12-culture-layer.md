# 文化层：命名理念 + 瑾瑜视觉

Status: done
Type: AFK
Parent: docs/PRD.md（瑾瑜 0→1）

## What to build

从既有 jinyutreasury **移植并改编**（复制后独立维护，禁止 import 旧包）以下文化层内容进新应用。视觉与交互细则以仓库 [`docs/UI.md`](../docs/UI.md) 为准。

- 命名理念/关于页文案（如「名字是父母写给孩子的第一封信」等），按本产品改写：一次报告、摘要图、固定单账号、无多轮精修主推
- 视觉文化：墨色/留白、字距、标题气质、ink-divider 等 design tokens 与关键展示气质
- 风格：产品默认「端庄耐看」（表单不暴露风格选择）

产品不像冷冰冰的表单工具，同时保持 Greenfield 运行时独立。

## Acceptance criteria

- [x] 存在命名理念/关于类页面或区块，品牌为「瑾瑜」，文案体现本产品交付形态（非 jinyutreasury 多轮精修主路径）
- [x] 取名表单不展示风格意象卡；服务端默认端庄耐看
- [x] 视觉语言符合 `docs/UI.md`（米纸底、墨青/铜金、衬线、细线留白），且不依赖 jinyutreasury 运行时包
- [x] 迁入内容在本仓库内维护，无对旧工程的运行时 import
- [x] 登录后主路径仍可用（文化层不阻断取名）

## Blocked by

- `issues/01-scaffold-login.md`
- `issues/02-naming-form-normalizer.md`

## User stories covered

66b, 66d, 106, 108（66c 风格卡片：产品决策为表单不展示，改默认软偏好）
