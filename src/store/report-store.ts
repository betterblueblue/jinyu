import { promises as fs } from "node:fs";
import path from "node:path";
import type { ReportDocument, ReportListItem } from "@/domain/types";

// 路径必须调用时求值：测试在 beforeEach 里设 JINYU_DATA_DIR，
// 若在这里用顶层常量，模块 import 时 env 还没设好，测试会写进真实 data/
function dataDir(): string {
  return process.env.JINYU_DATA_DIR || path.join(process.cwd(), "data");
}

function reportsDir(): string {
  return path.join(dataDir(), "reports");
}

function indexFile(): string {
  return path.join(dataDir(), "index.json");
}

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
  const raw = await fs.readFile(indexFile(), "utf8");
  try {
    return JSON.parse(raw) as ReportListItem[];
  } catch {
    return [];
  }
}

async function writeIndex(items: ReportListItem[]): Promise<void> {
  await ensureDirs();
  await fs.writeFile(indexFile(), JSON.stringify(items, null, 2), "utf8");
}

function toListItem(report: ReportDocument): ReportListItem {
  return {
    id: report.id,
    createdAt: report.createdAt,
    surname: report.request.surname,
    gender: report.request.gender,
    nameSummary: report.overview.names.slice(0, 5).join("、"),
    providerName: report.providerName,
    source: report.source ?? "formal",
  };
}

export async function saveReport(report: ReportDocument): Promise<void> {
  await ensureDirs();
  const file = path.join(reportsDir(), `${report.id}.json`);
  await fs.writeFile(file, JSON.stringify(report, null, 2), "utf8");
  const index = await readIndex();
  const next = [toListItem(report), ...index.filter((i) => i.id !== report.id)];
  await writeIndex(next);
}

export async function getReport(id: string): Promise<ReportDocument | null> {
  await ensureDirs();
  const file = path.join(reportsDir(), `${id}.json`);
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as ReportDocument;
  } catch {
    return null;
  }
}

export async function listReports(filter?: {
  source?: "live" | "formal";
}): Promise<ReportListItem[]> {
  const items = await readIndex();
  if (!filter?.source) return items;
  return items.filter((i) => (i.source ?? "formal") === filter.source);
}
