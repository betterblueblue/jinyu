import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE = "jinyu_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function secret(): string {
  return process.env.JINYU_SESSION_SECRET || "dev-session-secret-change-in-prod";
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function getPresetCredentials(): { username: string; password: string } {
  return {
    username: process.env.JINYU_AUTH_USERNAME || "jinyu",
    password: process.env.JINYU_AUTH_PASSWORD || "change-me",
  };
}

export function verifyCredentials(username: string, password: string): boolean {
  const preset = getPresetCredentials();
  return username === preset.username && password === preset.password;
}

export async function createSession(): Promise<void> {
  const exp = Date.now() + MAX_AGE * 1000;
  const payload = Buffer.from(JSON.stringify({ u: "preset", exp }), "utf8").toString("base64url");
  const token = `${payload}.${sign(payload)}`;
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

export async function isAuthenticated(): Promise<boolean> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const expected = sign(payload);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  } catch {
    return false;
  }
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      exp?: number;
    };
    if (!data.exp || Date.now() > data.exp) return false;
    return true;
  } catch {
    return false;
  }
}

export async function requireAuth(): Promise<boolean> {
  return isAuthenticated();
}
