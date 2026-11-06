# 简化版（2026-11-06）

用户定：另做一套简化版的三个核心功能，页面和现在的系统一样，**现有的文件一个都不改**。
起因是盲选（`scripts/simple-vs-current/`，结果在 `data/eval/simple-vs-current/`）：一段短提示词、思考档位 low、调一次模型写的名字，用户 17 比 3 选它（打分改字 2:7:1、直播起名 0:6:2、完整起名 1:4:1）。

## 地址

| | 现在的系统（不动） | 简化版 |
|---|---|---|
| 直播台 | `/live`、`启动直播台.bat` | `/simple/live`、`启动简化版直播台.bat` |
| 提词页（打分改字在「打分」页签） | `/live/prompter`、`启动提词页.bat` | `/simple/live/prompter`、`启动简化版提词页.bat` |
| 完整起名 / 报告 / 历史 | `/name`、`/reports/[id]`、`/history` | `/simple/name`、`/simple/reports/[id]`、`/simple/history` |
| 接口 | `/api/fast`、`/api/analyze/evaluate`、`/api/generate` … | `/api/simple/fast`、`/api/simple/evaluate`、`/api/simple/generate`、`/api/simple/live/{prompter,log}`、`/api/simple/reports/[id]{,/summary}` |
| 数据 | `data/reports`、`data/index.json`、`data/live-log` | `data/simple/reports`、`data/simple/index.json`、`data/simple/live-log` |

两套可以同时开：提词页同步、打分缓存、避开字表都各存各的。首页没有简化版的入口，直接输地址。

## 代码

- `llm.ts`：调模型（短提示词 + low + 8192），自己读流。现有的 `providers/chat.ts` 不认流里的 `{"error":...}`，网关中途断线（`ECONNRESET`）时会当成空正文；这里报出来，正文还没开始写就重发一次。
- `checks.ts`：程序检查，只去掉硬伤（生僻、次常用多音、不宜字、坏谐音、和姓连读、和姓同音、反面人物、明显用错性别、烂大街名），出处回原文逐字核。热门字、年代字、笔画轻重不挡。
- `full.ts`：完整起名。字数、辈分字、避讳字、硬伤不对的去掉，不重试；报告用现在的 `assembleReport`，报告页一样。
- `evaluate.ts`：打分改字。模型按观众屏幕副标题的八个维度（音律 15、字义 20、气质 15、识读 10、流行 10、谐音 10、国学 10、字形 10）各给分，程序相加、分档。改法只查硬伤、只动一个字（单名可加一个字）、比原名高。规则确认的问题（谐音「肚子疼」）模型漏写时补上。
- `fast.ts`：直播起名。写好一个名字就交一个；两个字、这一场没给过、没硬伤、口味表（`fast/taste.ts`）、出处逐字核。名字库只在模型出错或能用的不到三个时补位。生日只给季节。口播稿直接用每个名字那句讲解，不再单独调模型写拆字稿。
- 页面：`app/simple/`。状态和调接口重写；纯展示的直接引用现在的文件（只读）：直播台样式、礼物图标、揭晓画面、存图、打分表、提词页打分稿、报告版式。字典还是 `/api/dictionary`（起名字典，没收的用新华字典补）。

## 实测

本地网关（opendesign/deepseek-v4.1-flash），中位：

| | 现在的系统 | 简化版 |
|---|---|---|
| 打分改字 | 25.9 秒 | 20.0 秒 |
| 直播起名 | 3.9 秒 | 25.1 秒 |
| 完整起名 | 142 秒（最慢 482 秒还失败） | 47.5 秒 |

官方 API（deepseek-flash）直播起名 7 轮交替：现在的系统 1.9–2.3 秒；简化版 3.5 / 11.8 / 23.4 / 55.6 秒，55.6 秒那轮模型超时、三个全是名字库补的。**直播起名的速度还没定怎么取舍**，见交付说明。
