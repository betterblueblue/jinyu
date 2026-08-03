import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeRequest } from "@/domain/normalizer";
import { runGeneration } from "@/domain/orchestrator";
import { FakeProvider } from "@/providers/fake-provider";
import { getReport, listReports, saveReport } from "@/store/report-store";

describe("report store", () => {
  let dir: string;
  const prev = process.env.JINYU_DATA_DIR;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "jinyu-test-"));
    process.env.JINYU_DATA_DIR = dir;
  });

  afterEach(async () => {
    process.env.JINYU_DATA_DIR = prev;
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("saves snapshot and reads without mutation", async () => {
    const n = normalizeRequest({ surname: "赵", gender: "male" });
    expect(n.ok).toBe(true);
    if (!n.ok) return;
    const gen = await runGeneration(n.value, new FakeProvider());
    expect(gen.ok).toBe(true);
    if (!gen.ok) return;
    await saveReport(gen.report);
    const loaded = await getReport(gen.report.id);
    expect(loaded?.overview.primaryName).toBe(gen.report.overview.primaryName);
    const list = await listReports();
    expect(list.some((i) => i.id === gen.report.id)).toBe(true);
  });
});
