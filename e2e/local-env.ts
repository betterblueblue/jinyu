import fs from "node:fs";
import path from "node:path";

/**
 * e2e 与 playwright.config 共用的登录账号来源。
 *
 * 本地跑 e2e 时，9000 端口上往往是自己起的 dev server（读的是 .env.local），
 * 而 webServer 复用现有服务时注入的 env 不起作用，账号密码必须跟 .env.local 一致，
 * 否则登录必然失败。这里统一从 .env.local 读，读不到才退回默认值。
 */
export function readLocalEnv(file = path.join(process.cwd(), ".env.local")): Record<string, string> {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const out: Record<string, string> = {};
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m) out[m[1]!] = m[2]!.trim().replace(/^["']|["']$/g, "");
    }
    return out;
  } catch {
    return {};
  }
}

export function e2eCredentials(): { username: string; password: string } {
  const env = readLocalEnv();
  return {
    username: env.JINYU_AUTH_USERNAME || process.env.JINYU_AUTH_USERNAME || "jinyu",
    password: env.JINYU_AUTH_PASSWORD || process.env.JINYU_AUTH_PASSWORD || "change-me",
  };
}
