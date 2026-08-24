import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 穷举输入矩阵回归测试（真实 LLM）。
 *
 * 覆盖：
 * - 异常输入：空姓氏/超长姓氏/未出生+八字/八字无生日/避讳含辈分字/辈分字多字/缺性别/无姓氏 —— 应全部被校验 400 拦截
 * - 正常输入：男/女/unknown × 代表性组合（单字名/辈分字/八字/风格）—— 应生成成功且报告结构健康
 *
 * 前置：真实 LLM dev server 已在 9000 跑（LLM_USE_FAKE=false，见 playwright.real.config.ts）。
 * 运行：npx playwright test --config=playwright.real.config.ts
 * 注意：正常矩阵 6 个真实 LLM 生成约 6 分钟，本文件单独放宽超时。
 */
const BASE = "http://127.0.0.1:9000";

// 真实环境凭据来自 .env.local（被 gitignore），运行时读取，不硬编码
function loadEnvLocal() {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 0) continue;
      const k = t.slice(0, i).trim();
      const v = t.slice(i + 1).trim();
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {}
}
loadEnvLocal();
const USERNAME = process.env.JINYU_AUTH_USERNAME || "jinyu";
const PASSWORD = process.env.JINYU_AUTH_PASSWORD;
if (!PASSWORD) throw new Error("JINYU_AUTH_PASSWORD 未设置");

async function login(request: any) {
  const res = await request.post(BASE + "/api/auth/login", {
    data: { username: USERNAME, password: PASSWORD },
  });
  expect(res.ok()).toBe(true);
}

// 异常输入：应被 normalizer 400 拦截（不耗真实 LLM，快）
test("异常输入全部被正确拦截", async ({ request }) => {
  await login(request);

  const badCases: { name: string; payload: Record<string, unknown> }[] = [
    { name: "空姓氏", payload: { surname: "", gender: "male" } },
    { name: "超长姓氏3字", payload: { surname: "欧阳三", gender: "male" } },
    { name: "未出生+八字", payload: { surname: "王", gender: "male", birthStatus: "unborn", baziEnabled: true, birthDate: "2026-01-01" } },
    { name: "八字无生日", payload: { surname: "王", gender: "male", baziEnabled: true } },
    { name: "避讳含辈分字", payload: { surname: "王", gender: "male", generationChar: "瑞", tabooChars: "瑞" } },
    { name: "辈分字多字", payload: { surname: "王", gender: "male", generationChar: "瑞雪" } },
    { name: "缺性别", payload: { surname: "王" } },
    { name: "无姓氏", payload: { gender: "male" } },
  ];

  for (const c of badCases) {
    const res = await request.post(BASE + "/api/generate", {
      headers: { "Content-Type": "application/json" },
      data: c.payload,
    });
    const text = await res.text();
    const blocked = res.status() === 400 || text.includes("event: error") || text.includes('"ok":false');
    expect(blocked, `${c.name} 应被拦截但未拦截 (HTTP ${res.status()})`).toBe(true);
  }
});

// 正常输入矩阵：真实 LLM（6 个代表性组合，约 6 分钟）
test("正常输入矩阵（真实 LLM）报告结构健康", async ({ request }) => {
  test.setTimeout(900_000); // 覆盖真实 LLM 生成时长（6 用例 × 40~160s + 摘要图渲染）
  await login(request);

  const cases: {
    name: string;
    payload: Record<string, unknown>;
    check?: (r: any, n: string) => void;
  }[] = [
    {
      name: "正常-高-male",
      payload: { surname: "高", gender: "male", birthStatus: "born", nameLength: "two", baziEnabled: false, avoidPopular: true, stylePrototypeId: "default_dignified" },
    },
    {
      name: "正常-林-unknown",
      payload: { surname: "林", gender: "unknown", birthStatus: "born", nameLength: "two", baziEnabled: false, avoidPopular: true, stylePrototypeId: "classical_elegant" },
      check: (r, n) => {
        const male = r.overview.maleNames ?? [];
        const female = r.overview.femaleNames ?? [];
        expect(male.filter((x: string) => female.includes(x)), `${n} 男/女重叠`).toEqual([]);
        const gs = r.names.map((x: { givenName: string }) => x.givenName);
        expect(new Set(gs).size, `${n} 名字重复`).toBe(gs.length);
      },
    },
    {
      name: "正常-王-female",
      payload: { surname: "王", gender: "female", birthStatus: "born", nameLength: "two", baziEnabled: false, avoidPopular: true, stylePrototypeId: "modern_clean" },
      check: (r, n) => {
        for (const x of r.names) expect(x.genderLean, `${n} 女宝混入男名`).not.toBe("male");
      },
    },
    {
      name: "正常-单字名-周-男",
      payload: { surname: "周", gender: "male", birthStatus: "born", nameLength: "one", baziEnabled: false, avoidPopular: true, stylePrototypeId: "default_dignified" },
      check: (r, n) => {
        for (const x of r.names) expect([...x.givenName].length, `${n} 非单字`).toBe(1);
      },
    },
    {
      name: "正常-辈分-瑞-第二字",
      payload: { surname: "王", gender: "male", birthStatus: "born", nameLength: "two", baziEnabled: false, avoidPopular: true, stylePrototypeId: "default_dignified", generationChar: "瑞", generationPosition: "second" },
      check: (r, n) => {
        for (const x of r.names) expect([...x.givenName][1], `${n} 缺辈分字`).toBe("瑞");
      },
    },
    {
      name: "正常-八字-生日时辰",
      payload: { surname: "陈", gender: "female", birthStatus: "born", nameLength: "two", baziEnabled: true, birthDate: "2020-05-01", birthHour: "14", avoidPopular: true, stylePrototypeId: "default_dignified" },
      check: (r, n) => {
        expect(r.bazi?.enabled, `${n} 八字未开`).toBe(true);
        for (const x of r.names) expect(x.baziFit, `${n} 缺 baziFit`).toBeTruthy();
      },
    },
  ];

  for (const c of cases) {
    const res = await request.post(BASE + "/api/generate", {
      headers: { "Content-Type": "application/json" },
      data: c.payload,
    });
    const text = await res.text();
    const idMatch = text.match(/"reportId":"([^"]+)"/);
    if (!idMatch) {
      throw new Error(`${c.name}: 无 reportId (${text.slice(0, 120)})`);
    }
    const reportId = idMatch[1]!;
    const fs = await import("node:fs");
    const report = JSON.parse(fs.readFileSync(resolve(process.cwd(), "data", "reports", `${reportId}.json`), "utf8"));

    if (c.check) c.check(report, c.name);
    expect(report.overview.primaryName, `${c.name} 缺首推`).toBeTruthy();
    // 摘要图渲染由 real-llm.spec.ts 单独覆盖（避免本矩阵每用例都渲染 PNG 拖慢/超时）
  }
});
