import { redirect } from "next/navigation";
import { isAuthenticated } from "@/auth/session";
import { LiveClient } from "./live-client";

// 标题要带「直播取名台」：tools/fit-window.ps1 按这几个字找窗口调成 9:16
export const metadata = { title: "瑾瑜 · 简化版 · 直播取名台" };

export default async function LivePage() {
  if (!(await isAuthenticated())) {
    redirect("/login?next=/simple/live");
  }
  return <LiveClient />;
}
