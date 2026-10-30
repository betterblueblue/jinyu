import { defineConfig, devices } from "@playwright/test";
import { e2eCredentials } from "./e2e/local-env";

// 账号跟 .env.local 走：复用现有 dev server 时，server 用的是那份配置，
// e2e 用同一份账号才登得进去
const creds = e2eCredentials();

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  // 复用已启动的 dev server 时它跑的是 .env.local 里的真实模型，一次生成 16–25 秒，
  // 默认 30 秒单测超时会先于用例里的 60–180 秒等待到期
  timeout: 240_000,
  reporter: "list",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: "http://127.0.0.1:9000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev",
    url: "http://127.0.0.1:9000",
    reuseExistingServer: !process.env.CI,
    env: {
      ...process.env,
      LLM_USE_FAKE: "true",
      JINYU_AUTH_USERNAME: creds.username,
      JINYU_AUTH_PASSWORD: creds.password,
      JINYU_SESSION_SECRET: "e2e-session-secret-at-least-32-chars",
    },
  },
});
