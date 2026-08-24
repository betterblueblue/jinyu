import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, expect } from "@playwright/test";

/**
 * 真实 LLM + 真实浏览器（Playwright）的真人操作链路测试。
 *
 * 与常规 e2e（Fake）不同：
 * - 需要外部真实 LLM dev server 已启动（LLM_USE_FAKE=false，见 playwright.real.config.ts）
 * - 用 unknown 性别，覆盖「未知性别分组」在真实模型输出下的零重叠（本次修复路径）
 *
 * 运行：npx playwright test --config=playwright.real.config.ts
 */

// 真实环境账号凭据在 .env.local（被 gitignore），测试运行时读取，不硬编码
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
  } catch {
    /* ignore */
  }
}
loadEnvLocal();
const USERNAME = process.env.JINYU_AUTH_USERNAME || "jinyu";
const PASSWORD = process.env.JINYU_AUTH_PASSWORD;
if (!PASSWORD) {
  throw new Error("JINYU_AUTH_PASSWORD 未设置：请在 .env.local 配置真实账号密码后运行真实 LLM 测试");
}

test("真人操作：登录 → unknown 取名 → 真实 LLM 生成 → 报告零重叠 → 摘要图 → 历史", async ({
  page,
}) => {
  test.setTimeout(300_000);

  // 1. 登录（真实凭据来自 .env.local）
  await page.goto("/login");
  await page.getByTestId("login-form").waitFor();
  await page.locator('input[name="username"]').fill(USERNAME);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/name/, { timeout: 15_000 });

  // 2. 填表单：unknown 性别，覆盖本次修复路径；选「现代简洁」风格，验证排除式 prompt 生效
  await page.getByTestId("surname").fill("陈");
  await page.getByTestId("gender").selectOption("unknown");
  await page.getByTestId("style-prototype").selectOption("modern_clean");
  await page.getByTestId("submit-generate").click();

  // 3. 等待真实 LLM 生成（30~90s，最坏放宽到 240s）
  await expect(page.getByTestId("report-page")).toBeVisible({ timeout: 240_000 });
  await expect(page.getByTestId("primary-name")).toBeVisible();

  // 4. 首推名是真实模型产物（非 Fake 的 清远/怀瑾/书白 固定集）
  const primary = (await page.getByTestId("primary-name").textContent())?.trim() ?? "";
  expect(primary).not.toBe("");
  const surname = "陈";
  expect(primary.startsWith(surname)).toBe(true);

  // 5. 男向/女向分组零重叠（本次修复核心断言）
  const maleText = await page.getByText(/^男向：/).textContent();
  const femaleText = await page.getByText(/^女向：/).textContent();
  const male = (maleText ?? "").replace("男向：", "").split("、").filter(Boolean);
  const female = (femaleText ?? "").replace("女向：", "").split("、").filter(Boolean);
  expect(male.filter((n) => female.includes(n))).toEqual([]);

  // 6. 逐名详解无重复（真实模型也可能重复输出同名，去重路径需验证）
  const nameHeadings = await page.getByTestId("report-names").locator("h3").allTextContents();
  const given = nameHeadings.map((h) => h.replace(/首推|偏热门/g, "").trim());
  expect(new Set(given).size).toBe(given.length);

  // 6b. 风格选择生效：选了「现代简洁」，逐名风格行应体现现代简洁（排除式 prompt 生效）
  const styleRows = await page
    .getByTestId("report-names")
    .locator("dl dt", { hasText: "风格" })
    .locator("..")
    .locator("dd")
    .allTextContents();
  expect(styleRows.length).toBeGreaterThan(0);
  const allStyle = styleRows.join(" ");
  expect(allStyle).toMatch(/简洁|现代|简单|日常/); // 「现代简洁」风格在模型输出中的体现
  expect(allStyle).not.toContain("野"); // 排除式 prompt 应避免「野」这类随性不羁字

  // 7. 下载摘要图（真实报告渲染 PNG）
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("download-summary").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/jinyu-summary/);

  // 8. 历史页包含姓氏
  await page.goto("/history");
  await expect(page.getByTestId("history-page")).toBeVisible();
  await expect(page.getByTestId("history-page").getByText("陈", { exact: false }).first()).toBeVisible();
});
