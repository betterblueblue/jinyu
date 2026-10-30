import { test, expect } from "@playwright/test";
import { e2eCredentials } from "./local-env";

const { username, password } = e2eCredentials();

test("unknown gender: 报告男向/女向零重叠、无重复名", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-form").waitFor();
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="password"]').fill(password);
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

test("live unknown: 男女各三个、无中性名，六名卡片可下载", async ({ page }) => {
  await page.setViewportSize({ width: 576, height: 1024 });
  await page.goto("/login");
  await page.getByTestId("login-form").waitFor();
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/name/);

  await page.goto("/live");
  await page.getByRole("textbox", { name: "姓氏" }).fill("苏");
  await page.locator(".genders button").filter({ hasText: "未知" }).click();
  await page.locator("button.go").click();

  await expect(page.getByTestId("live-unknown-groups")).toBeVisible({ timeout: 60_000 });
  const maleGroup = page.getByTestId("live-male-group");
  const femaleGroup = page.getByTestId("live-female-group");
  await expect(maleGroup.locator(".group-item")).toHaveCount(3);
  await expect(femaleGroup.locator(".group-item")).toHaveCount(3);
  await expect(page.locator(".live-stage")).not.toContainText("中性");

  const maleNames = await maleGroup.locator(".group-name").allTextContents();
  const femaleNames = await femaleGroup.locator(".group-name").allTextContents();
  expect(new Set([...maleNames, ...femaleNames]).size).toBe(6);
  expect(maleNames.every((name) => name.startsWith("苏"))).toBe(true);
  expect(femaleNames.every((name) => name.startsWith("苏"))).toBe(true);

  const groupsBox = await page.getByTestId("live-unknown-groups").boundingBox();
  const footerBox = await page.locator(".live-stage .bottom").boundingBox();
  expect(groupsBox).not.toBeNull();
  expect(footerBox).not.toBeNull();
  expect(groupsBox!.y + groupsBox!.height).toBeLessThan(footerBox!.y);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "存图" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("瑾瑜-苏-男女各三.png");
});
