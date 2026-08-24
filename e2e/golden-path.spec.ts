import { test, expect } from "@playwright/test";

test("golden path: login → form → report → summary → history", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-form").waitFor();
  await page.locator('input[name="username"]').fill("jinyu");
  await page.locator('input[name="password"]').fill("change-me");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/name/);

  await page.getByTestId("surname").fill("王");
  await page.getByTestId("gender").selectOption("male");

  // 命名风格选择：下拉可渲染 6 种风格，选「书卷自持」应能提交
  await expect(page.getByTestId("style-prototype")).toBeVisible();
  await expect(page.getByTestId("style-prototype").locator("option")).toHaveCount(6);
  await page.getByTestId("style-prototype").selectOption("scholarly_restrained");

  await page.getByTestId("submit-generate").click();

  // xhigh 推理 + 流式生成慢，真 LLM 可达 1~3 分钟
  await expect(page.getByTestId("report-page")).toBeVisible({ timeout: 180_000 });
  await expect(page.getByTestId("primary-name")).toBeVisible();
  await expect(page.getByTestId("report-overview")).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("download-summary").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/jinyu-summary/);

  await page.goto("/history");
  await expect(page.getByTestId("history-page")).toBeVisible();
  await expect(page.getByTestId("history-page").getByText("王", { exact: false }).first()).toBeVisible();
});
