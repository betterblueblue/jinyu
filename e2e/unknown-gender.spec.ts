import { test, expect } from "@playwright/test";

test("unknown gender: 报告男向/女向零重叠、无重复名", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-form").waitFor();
  await page.locator('input[name="username"]').fill("jinyu");
  await page.locator('input[name="password"]').fill("change-me");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/name/);

  await page.getByTestId("surname").fill("林");
  await page.getByTestId("gender").selectOption("unknown");
  await page.getByTestId("submit-generate").click();

  // Fake LLM 秒回，但仍保留较长超时兜底
  await expect(page.getByTestId("report-page")).toBeVisible({ timeout: 60_000 });

  // 男向/女向分组：各自非空则组间零重叠（候选不足时某侧可能为空）
  const maleText = await page.getByText(/^男向：/).textContent();
  const femaleText = await page.getByText(/^女向：/).textContent();
  const maleNames = (maleText ?? "").replace("男向：", "").split("、").filter(Boolean);
  const femaleNames = (femaleText ?? "").replace("女向：", "").split("、").filter(Boolean);
  const overlap = maleNames.filter((n) => femaleNames.includes(n));
  expect(overlap).toEqual([]);

  // 报告名字无重复
  const overviewNames = (await page.getByTestId("report-overview").getByText(/林/).allTextContents()).join(" ");
  // 逐名详解的 givenName 不重复
  const nameHeadings = await page.getByTestId("report-names").locator("h3").allTextContents();
  const given = nameHeadings.map((h) => h.replace(/首推|偏热门/g, "").trim());
  expect(new Set(given).size).toBe(given.length);
  void overviewNames;
});
