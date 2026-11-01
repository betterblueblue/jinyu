import type { LiveEvent } from "@/live/live-log";

/** 记一条直播日志（src/live/live-log.ts）。不等结果、不报错：记不上不影响直播 */
export function logLive(event: LiveEvent): void {
  void fetch("/api/live/log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
    keepalive: true,
  }).catch(() => undefined);
}
