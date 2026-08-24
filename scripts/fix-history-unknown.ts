/**
 * 一次性修复历史报告中「未知性别」报告的男向/女向分组与重复名问题。
 *
 * 背景：修复前 assembler 的 unknown 分组用 genderLean !== "female"/"male" 分拣，
 * 导致 neutral 候选同时进男向/女向（重叠），且重复候选未去重（组内重复）。
 * 历史报告已存盘，本脚本按修复后的逻辑重建分组字段。
 *
 * 注意：报告已存盘的 names 数组即为当时 selected 结果，genderLean 字段保留在
 * 每个 name 上，本脚本据此重建 maleNames/femaleNames/overview.names/decisionAdvice，
 * 并移除重复名。不改动 requests 与逐名详情内容。
 */
import { promises as fs } from "node:fs";
import path from "node:path";

interface StoredName {
  givenName: string;
  fullName: string;
  isPrimary: boolean;
  genderLean?: "male" | "female" | "neutral";
  l2Hot?: boolean;
}

interface StoredReport {
  request: { surname: string; gender: string; birthStatus?: string };
  names: StoredName[];
  overview: {
    primaryName: string;
    names: string[];
    oneLiner?: string;
    maleNames?: string[];
    femaleNames?: string[];
  };
  decisionAdvice?: string;
  relaxations?: string[];
}

const DATA_DIR = path.join(process.cwd(), "data");
const REPORTS_DIR = path.join(DATA_DIR, "reports");

async function main() {
  const files = (await fs.readdir(REPORTS_DIR)).filter((f) => f.endsWith(".json"));
  let fixed = 0;
  for (const file of files) {
    const fp = path.join(REPORTS_DIR, file);
    const report = JSON.parse(await fs.readFile(fp, "utf8")) as StoredReport;

    // 只处理未知性别报告
    if (report.request?.gender !== "unknown") continue;

    const names = Array.isArray(report.names) ? report.names : [];
    const surname = report.request.surname ?? "";

    // 1. 按 givenName 去重（保留首个出现的）
    const seen = new Set();
    const unique = names.filter((n) => {
      if (seen.has(n.givenName)) return false;
      seen.add(n.givenName);
      return true;
    });

    // 2. 按修复后逻辑重建分组：male/female 全量 + neutral 补齐，neutral 不跨组重复。
    // 候选不足时允许某侧为空（显示 —），但绝不把同一名字放进两侧（重叠是 bug，空是数据不足）
    const maleLean = unique.filter((n) => n.genderLean === "male");
    const femaleLean = unique.filter((n) => n.genderLean === "female");
    const neutralPool = unique.filter((n) => n.genderLean !== "male" && n.genderLean !== "female");
    const needMale = 2;
    const needFemale = 2;
    const mPick = [...maleLean];
    const fPick = [...femaleLean];
    // 男向先补齐 neutral，女向再补（排除已入男向的）
    if (mPick.length < needMale) {
      for (const c of neutralPool) {
        if (mPick.length >= needMale) break;
        mPick.push(c);
      }
    }
    if (fPick.length < needFemale) {
      for (const c of neutralPool) {
        if (fPick.length >= needFemale) break;
        if (mPick.includes(c)) continue; // neutral 已入男向则不再进女向
        fPick.push(c);
      }
    }
    const maleNames = mPick.map((n) => `${surname}${n.givenName}`);
    const femaleNames = fPick.map((n) => `${surname}${n.givenName}`);
    const overviewNames = [...new Set([...maleNames, ...femaleNames])];

    // 3. 首推：优先非 L2（保留原 primary 若在 unique 中），否则取第一个
    const primaryName =
      unique.find((n) => n.isPrimary)?.fullName ??
      unique.find((n) => !n.l2Hot)?.fullName ??
      unique[0]?.fullName ??
      overviewNames[0] ??
      "";
    const primaryGiven = primaryName.replace(surname, "");

    // 4. 重建 report.names（去重 + isPrimary 正确）
    const rebuiltNames = unique.map((n) => ({
      ...n,
      fullName: `${surname}${n.givenName}`,
      isPrimary: n.givenName === primaryGiven,
    }));

    // 5. 重建 decisionAdvice（引用了名字列表；未知性别文案按实际分组措辞）
    const bothSides = maleNames.length > 0 && femaleNames.length > 0;
    const rest = rebuiltNames.filter((n) => !n.isPrimary).map((n) => n.fullName);
    const decisionAdvice = [
      `首推「${primaryName}」：在音形义与规则闸门后综合靠前，适合作为主决策参考。`,
      rest.length > 1 ? `其余 ${rest.join("、")} 可作为备选：可按辈分习惯、书写便利与家人试念再定。` : "",
      bothSides
        ? "性别未知时男向与女向均有备选；得知实际性别后建议从对应分组收窄。"
        : "性别未知，当前备选较少；得知实际性别后建议针对性再取一两个名字。",
      ...(report.decisionAdvice ?? "")
        .split("\n")
        .filter((l) => !l.includes("首推") && !l.includes("可作为备选") && !l.includes("性别未知时男向与女向")),
    ].filter(Boolean).join("\n");

    // 6. 重建 oneLiner（与正式代码一致：备选较少时如实措辞）
    const oneLinerParts = [
      `首推 ${primaryName}`,
      bothSides
        ? "含男向与女向备选，得知实际性别后可收窄"
        : "备选较少，得知实际性别后可按向补充",
      report.request.birthStatus === "unborn" ? "备名语境" : null,
      Array.isArray(report.relaxations) && report.relaxations.length
        ? `已放宽：${report.relaxations.join("、")}`
        : null,
    ].filter(Boolean);
    const oneLiner = oneLinerParts.join(" · ");

    // 7. 回写
    report.names = rebuiltNames;
    report.overview = {
      ...report.overview,
      primaryName,
      names: overviewNames,
      maleNames,
      femaleNames,
      oneLiner,
    };
    report.decisionAdvice = decisionAdvice;

    await fs.writeFile(fp, JSON.stringify(report, null, 2), "utf8");
    fixed++;
    console.log(
      `✓ ${file.replace(".json", "")} (${surname}) male=[${maleNames}] female=[${femaleNames}] names=[${overviewNames}]`,
    );
  }
  console.log(`\n修复 ${fixed} 份未知性别报告。`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
