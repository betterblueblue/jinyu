import { defineConfig, devices } from "@playwright/test";

/**
 * 真实 LLM 浏览器端到端配置。
 *
 * 与 playwright.config.ts 的关键区别：
 * - 不启动 webServer：测试连接外部已启动的真实 LLM dev server（LLM_USE_FAKE=false）
 * - 只跑 e2e-real/ 目录下的真实 LLM 用例
 *
 * 运行前需先启动 dev server（真实 LLM 模式）：
 *   .\start-dev.ps1   （.env.local 已配 LLM_USE_FAKE=false + 真 key）
 *
 * 运行：
 *   npx playwright test --config=playwright.real.config.ts
 */
export default defineConfig({
  testDir: "./e2e-real",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 300_000, // 真实 LLM 生成 30~90s，整条链路放宽
  use: {
    baseURL: "http://127.0.0.1:9000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
