import { promises as fs } from "node:fs";
import path from "node:path";
import type { ReportDocument, ReportListItem } from "@/domain/types";

/**
 * 简化版的报告和历史，和现在的系统分开存：data/simple/reports/<id>.json + data/simple/index.json。
 * 写法照抄 src/store/report-store.ts（那份不动）。路径调用时求值，测试设 JINYU_DATA_DIR 才不会写进真实 data/。
 */
function dataDir(): string {
  return path.join(process.env.JINYU_DATA_DIR || path.join(process.cwd(), "data"), "simple");
}
const reportsDir = () => path.join(dataDir(), "reports");
const indexFile = () => path.join(dataDir(), "index.json");

/** 报告 id 是 nanoid(12)，只收这种，挡掉路径穿越 */
const ID = /^[A-Za-z0-9_-]{6,32}$/;

async function ensureDirs(): Promise<void> {
  await fs.mkdir(reportsDir(), { recursive: true });
  try {
    await fs.access(indexFile());
  } catch {
    await fs.writeFile(indexFile(), "[]", "utf8");
  }
}

async function readIndex(): Promise<ReportListItem[]> {
  await ensureDirs();
  try {
    return JSON.parse(await fs.readFile(indexFile(), "utf8")) as ReportListItem[];
  } catch {
    return [];
  }
}

export async function saveSimpleReport(report: ReportDocument): Promise<void> {
  await ensureDirs();
  await fs.writeFile(path.join(reportsDir(), `${report.id}.json`), JSON.stringify(report, null, 2), "utf8");
  const item: ReportListItem = {
    id: report.id,
    createdAt: report.createdAt,
    surname: report.request.surname,
    gender: report.request.gender,
    nameSummary: report.overview.names.slice(0, 5).join("、"),
    providerName: report.providerName,
    source: report.source ?? "formal",
  };
  const index = await readIndex();
  await fs.writeFile(indexFile(), JSON.stringify([item, ...index.filter((i) => i.id !== report.id)], null, 2), "utf8");
}

export async function getSimpleReport(id: string): Promise<ReportDocument | null> {
  if (!ID.test(id)) return null;
  await ensureDirs();
  try {
    return JSON.parse(await fs.readFile(path.join(reportsDir(), `${id}.json`), "utf8")) as ReportDocument;
  } catch {
    return null;
  }
}

export async function listSimpleReports(filter?: { source?: "live" | "formal" }): Promise<ReportListItem[]> {
  const items = await readIndex();
  return filter?.source ? items.filter((i) => (i.source ?? "formal") === filter.source) : items;
}
