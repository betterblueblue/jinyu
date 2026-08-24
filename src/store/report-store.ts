import { promises as fs } from "node:fs";
import path from "node:path";
import type { ReportDocument, ReportListItem } from "@/domain/types";

const DATA_DIR = process.env.JINYU_DATA_DIR || path.join(process.cwd(), "data");
const REPORTS_DIR = path.join(DATA_DIR, "reports");
const INDEX_FILE = path.join(DATA_DIR, "index.json");

async function ensureDirs(): Promise<void> {
  await fs.mkdir(REPORTS_DIR, { recursive: true });
  try {
    await fs.access(INDEX_FILE);
  } catch {
    await fs.writeFile(INDEX_FILE, "[]", "utf8");
  }
}

async function readIndex(): Promise<ReportListItem[]> {
  await ensureDirs();
  const raw = await fs.readFile(INDEX_FILE, "utf8");
  try {
    return JSON.parse(raw) as ReportListItem[];
  } catch {
    return [];
  }
}

async function writeIndex(items: ReportListItem[]): Promise<void> {
  await ensureDirs();
  await fs.writeFile(INDEX_FILE, JSON.stringify(items, null, 2), "utf8");
}

function toListItem(report: ReportDocument): ReportListItem {
  return {
    id: report.id,
    createdAt: report.createdAt,
    surname: report.request.surname,
    gender: report.request.gender,
    nameSummary: report.overview.names.slice(0, 5).join("、"),
    providerName: report.providerName,
  };
}

export async function saveReport(report: ReportDocument): Promise<void> {
  await ensureDirs();
  const file = path.join(REPORTS_DIR, `${report.id}.json`);
  await fs.writeFile(file, JSON.stringify(report, null, 2), "utf8");
  const index = await readIndex();
  const next = [toListItem(report), ...index.filter((i) => i.id !== report.id)];
  await writeIndex(next);
}

export async function getReport(id: string): Promise<ReportDocument | null> {
  await ensureDirs();
  const file = path.join(REPORTS_DIR, `${id}.json`);
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as ReportDocument;
  } catch {
    return null;
  }
}

export async function listReports(): Promise<ReportListItem[]> {
  return readIndex();
}
