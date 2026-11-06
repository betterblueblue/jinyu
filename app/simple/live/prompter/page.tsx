import { redirect } from "next/navigation";
import { isAuthenticated } from "@/auth/session";
import { PrompterClient } from "./prompter-client";

/**
 * 简化版主播提词页（照抄 /live/prompter）：只给主播看，直播伴侣不采集这个窗口。
 * 标题里不能有「直播取名台」：tools/fit-window.ps1 按这几个字找直播窗口去调尺寸。
 */
export const metadata = { title: "瑾瑜 · 简化版 · 主播提词" };
export const dynamic = "force-dynamic";

export default async function PrompterPage() {
  if (!(await isAuthenticated())) {
    redirect("/login?next=/simple/live/prompter");
  }
  return <PrompterClient />;
}
