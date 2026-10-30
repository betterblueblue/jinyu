import { redirect } from "next/navigation";
import { isAuthenticated } from "@/auth/session";
import { LiveClient } from "./live-client";

export const metadata = { title: "瑾瑜 · 直播取名台" };

export default async function LivePage() {
  if (!(await isAuthenticated())) {
    redirect("/login");
  }
  return <LiveClient />;
}
