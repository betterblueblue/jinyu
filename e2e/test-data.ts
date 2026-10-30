import fs from "node:fs";
import path from "node:path";

/**
 * e2e 会真的生成报告并写进 data/（复用 dev server 时走的是真实模型，没有 fake 开关可用）。
 * 为了让用户的历史保持干净，跑前记下已有报告 id，跑完把新出现、且姓在用例固定集合里的删掉。
 *
 * 只动 王 / 林 / 苏 这三个用例里写死的姓，避免误删同时在跑的真实报告。
 */
export const TEST_SURNAMES = new Set(["王", "林", "苏"]);

export function dataDir(): string {
  return process.env.JINYU_DATA_DIR || path.join(process.cwd(), "data");
}

export function indexFile(): string {
  return path.join(dataDir(), "index.json");
}

export function reportsDir(): string {
  return path.join(dataDir(), "reports");
}

export function readIndex(): { id: string; surname?: string; createdAt?: string }[] {
  try {
    return JSON.parse(fs.readFileSync(indexFile(), "utf8")) as {
      id: string;
      surname?: string;
    }[];
  } catch {
    return [];
  }
}

function baselinePath(): string {
  return path.join(process.cwd(), "test-results", ".e2e-baseline.json");
}

export function writeBaseline(ids: string[]): void {
  fs.mkdirSync(path.dirname(baselinePath()), { recursive: true });
  fs.writeFileSync(baselinePath(), JSON.stringify(ids), "utf8");
}

export function readBaseline(): string[] {
  try {
    return JSON.parse(fs.readFileSync(baselinePath(), "utf8")) as string[];
  } catch {
    return [];
  }
}

/** 返回本次新增、被清掉的条数与落点 */
export function cleanupNewReports(): { removed: number; trash: string | null } {
  const known = new Set(readBaseline());
  const items = readIndex();
  const doomed = items.filter(
    (i) => !known.has(i.id) && i.surname !== undefined && TEST_SURNAMES.has(i.surname),
  );
  if (doomed.length === 0) return { removed: 0, trash: null };

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const trash = path.join(dataDir(), "_trash", "e2e-" + stamp);
  fs.mkdirSync(trash, { recursive: true });

  for (const it of doomed) {
    const from = path.join(reportsDir(), it.id + ".json");
    if (fs.existsSync(from)) fs.renameSync(from, path.join(trash, it.id + ".json"));
  }
  fs.writeFileSync(path.join(trash, "index-removed.json"), JSON.stringify(doomed, null, 2), "utf8");

  const doomedIds = new Set(doomed.map((d) => d.id));
  fs.writeFileSync(
    indexFile(),
    JSON.stringify(
      items.filter((i) => !doomedIds.has(i.id)),
      null,
      2,
    ),
    "utf8",
  );
  return { removed: doomed.length, trash };
}
