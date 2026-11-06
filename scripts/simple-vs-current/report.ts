/**
 * 简化版对比 Demo 的报告和盲选页。
 * 用法：pnpm tsx scripts/simple-vs-current/report.ts
 * 读 data/eval/simple-vs-current/results.json，写同目录的 report.md 和 blind.html。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkName, checkRequest, DIMS, type Dim, type Finding } from "./check";
import { FAST_CASES, FULL_CASES, OUT, OUT_DIR, SCORE_CASES, type Arm, type Kind, type Run } from "./run";

const KIND_NAME: Record<Kind, string> = { score: "打分改字", fast: "直播起名", full: "完整起名" };
const ARM_NAME: Record<Arm, string> = { current: "现在的系统", simple: "简化版" };
/** 谁都能配的万能字：用得越多，名字越千篇一律 */
const STOCK = new Set([..."悦宁晴安然清知舒昭澜"]);
const GW = { male: "男孩", female: "女孩", unknown: "性别未知" } as const;

const runs = JSON.parse(readFileSync(OUT, "utf8")) as Run[];

function inputOf(kind: Kind, i: number): string {
  if (kind === "score") {
    const c = SCORE_CASES[i]!;
    return `${c.fullName} · ${GW[c.gender]}`;
  }
  if (kind === "fast") {
    const c = FAST_CASES[i]!;
    return `姓${c.surname} · ${GW[c.gender]}${c.birthday ? ` · 生日 ${c.birthday}` : ""}`;
  }
  const c = FULL_CASES[i]!;
  const bits = [`姓${c.surname}`, GW[c.gender], c.nameLength === "one" ? "一字名" : "两字名"];
  if (c.birthStatus === "unborn") bits.push(`未出生${c.dueDate ? `，预产期 ${c.dueDate}` : ""}`);
  if (c.baziEnabled) bits.push(`八字 ${c.birthDate}${c.birthHour ? ` ${c.birthHour} 点` : ""}`);
  if (c.generationChar) bits.push(`辈分字「${c.generationChar}」${c.generationPosition === "first" ? "在第一个字" : c.generationPosition === "second" ? "在第二个字" : "不限位置"}`);
  if (c.tabooChars) bits.push(`避讳 ${c.tabooChars}`);
  if (c.avoidPopular) bits.push("避开流行名");
  return `${c.label}：${bits.join(" · ")}`;
}

function surnameOf(kind: Kind, i: number): string {
  return kind === "score" ? SCORE_CASES[i]!.surname : kind === "fast" ? FAST_CASES[i]!.surname : FULL_CASES[i]!.surname;
}
function genderOf(kind: Kind, i: number): "male" | "female" | "unknown" {
  return kind === "score" ? SCORE_CASES[i]!.gender : kind === "fast" ? FAST_CASES[i]!.gender : FULL_CASES[i]!.gender;
}

/** 改法是不是只动了一个字（大姓单名可以加一个字） */
function fixShapeBad(original: string, next: string): string | null {
  const a = [...original];
  const b = [...next];
  if (b.length === a.length) {
    const diff = a.filter((c, k) => c !== b[k]).length;
    return diff === 1 ? null : `改了 ${diff} 个字`;
  }
  if (b.length === a.length + 1 && a.length === 1 && b.includes(a[0]!)) return null;
  return `字数从 ${a.length} 变成 ${b.length}`;
}

const median = (xs: number[]) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((p, q) => p - q);
  return s.length ? s[Math.floor(s.length / 2)]! : NaN;
};
const sec = (ms: number) => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)} 秒` : "—");

interface NameCheck {
  full: string;
  findings: Finding[];
  /** 要求没做到（完整起名）、改法形状不对（打分改字）、和同组重名 */
  broken: string[];
}

function checkRun(r: Run): NameCheck[] {
  const surname = surnameOf(r.kind, r.index);
  const gender = genderOf(r.kind, r.index);
  const seen = new Set<string>();
  return r.names
    .filter((n) => n.givenName)
    .map((n) => {
      const broken: string[] = [];
      if (seen.has(n.givenName)) broken.push("同一组里重复");
      seen.add(n.givenName);
      if (r.kind === "full") {
        const c = FULL_CASES[r.index]!;
        broken.push(
          ...checkRequest(n.givenName, {
            surname,
            nameLength: c.nameLength === "one" ? 1 : 2,
            ...(c.generationChar ? { generationChar: c.generationChar, generationPosition: c.generationPosition ?? "any" } : {}),
            tabooChars: (c.tabooChars ?? "").split(/[,，、\s]+/).filter(Boolean),
          }),
        );
      }
      if (r.kind === "fast" && [...n.givenName].length !== 2) broken.push(`要两个字，给了 ${[...n.givenName].length} 个`);
      if (r.kind === "score") {
        const original = SCORE_CASES[r.index]!.fullName.slice(surname.length);
        const bad = fixShapeBad(original, n.givenName);
        if (bad) broken.push(`改法不是只动一个字：${bad}`);
        if (n.givenName === original) broken.push("改法和原名一样");
      }
      return { full: `${surname}${n.givenName}`, findings: checkName(surname, n.givenName, gender, n.citation), broken };
    });
}

interface Stat {
  runs: number;
  errors: number;
  totalMs: number;
  firstMs: number;
  reasoning: number;
  names: number;
  /** 至少一个硬伤或要求没做到的名字 */
  badNames: number;
  hard: Record<Dim, number>;
  soft: Record<Dim, number>;
  plus: number;
  citeOk: number;
  citeBad: number;
  broken: number;
  stockShare: number;
  distinct: number;
  /** 打分改字：给了改法的组数；起名：一个名字都没给的组数 */
  withFix: number;
  empty: number;
  blocked: number;
}

function stat(kind: Kind, arm: Arm): Stat {
  const rs = runs.filter((r) => r.kind === kind && r.arm === arm);
  const zero = () => Object.fromEntries(DIMS.map((d) => [d, 0])) as Record<Dim, number>;
  const s: Stat = {
    runs: rs.length, errors: rs.filter((r) => r.error).length,
    totalMs: median(rs.map((r) => r.totalMs)), firstMs: median(rs.map((r) => r.firstMs ?? NaN)), reasoning: median(rs.map((r) => r.reasoningChars ?? NaN)),
    names: 0, badNames: 0, hard: zero(), soft: zero(), plus: 0, citeOk: 0, citeBad: 0, broken: 0, stockShare: 0, distinct: 0,
    withFix: rs.filter((r) => r.names.length > 0).length, empty: rs.filter((r) => r.names.length === 0).length,
    blocked: rs.reduce((n, r) => n + (r.blocked ?? 0), 0),
  };
  const chars: string[] = [];
  for (const r of rs) {
    const surname = surnameOf(kind, r.index);
    const original = kind === "score" ? SCORE_CASES[r.index]!.fullName.slice(surname.length) : "";
    for (const n of checkRun(r)) {
      s.names++;
      const hard = n.findings.filter((f) => f.level === "hard");
      if (hard.length || n.broken.length) s.badNames++;
      for (const f of n.findings) {
        if (f.level === "hard") s.hard[f.dim]++;
        else if (f.level === "soft") s.soft[f.dim]++;
        else s.plus++;
        if (f.text.startsWith("出处核过")) s.citeOk++;
        if (f.text.startsWith("出处核不过")) s.citeBad++;
      }
      s.broken += n.broken.length;
      // 换上的字：打分改字只看新加的字，起名看整个名
      for (const c of n.full.slice(surname.length)) if (!original.includes(c)) chars.push(c);
    }
  }
  s.stockShare = chars.length ? chars.filter((c) => STOCK.has(c)).length / chars.length : 0;
  s.distinct = new Set(chars).size;
  return s;
}

function markdown(): string {
  const out: string[] = [
    "# 简化版提示词对比（三个核心功能）",
    "",
    "同一批输入，「现在的系统」直接调产品里的函数；「简化版」是一段短提示词、调一次模型、不做验收和重试。",
    "都走本地网关 opendesign/deepseek-v4.1-flash，两版挨着跑、每组换先后。网关关不掉思考：简化版用 low；现在的系统打分改字和直播起名是 low，完整起名是 xhigh。",
    "质量只数查表、查语料能确定的问题，按八个维度分开，不出总分；字义好不好、气质对不对看盲选页 blind.html。",
    "「国学」那一栏的「两个字在古籍同一句里挨着」是参考，会有碰巧挨着的（比如「十一月丁卯朔」），不算质量结论。",
    "",
  ];
  for (const kind of ["score", "fast", "full"] as Kind[]) {
    const a = stat(kind, "current");
    const b = stat(kind, "simple");
    if (!a.runs && !b.runs) continue;
    const row = (label: string, f: (s: Stat) => string) => out.push(`| ${label} | ${f(a)} | ${f(b)} |`);
    out.push(`## ${KIND_NAME[kind]}`, "", `| | ${ARM_NAME.current} | ${ARM_NAME.simple} |`, "|---|---|---|");
    row("跑了几组 / 出错", (s) => `${s.runs} / ${s.errors}`);
    row("全部写完（中位）", (s) => sec(s.totalMs));
    row(kind === "score" ? "分数出来（中位）" : "先看到东西（中位）", (s) => sec(s.firstMs));
    row("推理字数（中位）", (s) => (Number.isFinite(s.reasoning) ? String(s.reasoning) : "—"));
    if (kind === "score") row("给了改法的组", (s) => `${s.withFix} / ${s.runs}`);
    else row("一个名字都没给的组", (s) => `${s.empty}`);
    row(kind === "score" ? "改法个数" : "名字个数", (s) => String(s.names));
    row("有硬伤或没做到要求的", (s) => `${s.badNames}（${s.names ? Math.round((s.badNames / s.names) * 100) : 0}%）`);
    for (const d of DIMS) {
      if (d === "国学") continue;
      if (!a.hard[d] && !b.hard[d] && !a.soft[d] && !b.soft[d]) continue;
      row(`　${d}：硬伤 / 提一句`, (s) => `${s.hard[d]} / ${s.soft[d]}`);
    }
    row("　国学：出处核过 / 核不过（编的）", (s) => `${s.citeOk} / ${s.citeBad}`);
    row(kind === "full" ? "　要求没做到（字数、辈分字、避讳字、重复）" : kind === "score" ? "　改法不是只动一个字、和原名一样、重复" : "　字数不对、重复", (s) => String(s.broken));
    row("万能字（悦宁晴安然清知舒昭澜）占换上的字", (s) => `${Math.round(s.stockShare * 100)}%`);
    row("用到的不同的字", (s) => String(s.distinct));
    row("现在的系统拦掉的候选（简化版没有这一层）", (s) => (s === b ? "—" : String(s.blocked)));
    out.push("");
  }

  out.push("## 每一组", "");
  for (const kind of ["score", "fast", "full"] as Kind[]) {
    const idx = [...new Set(runs.filter((r) => r.kind === kind).map((r) => r.index))].sort((p, q) => p - q);
    for (const i of idx) {
      out.push(`### ${KIND_NAME[kind]} ${i + 1}：${inputOf(kind, i)}`, "");
      for (const arm of ["current", "simple"] as Arm[]) {
        const r = runs.find((x) => x.kind === kind && x.index === i && x.arm === arm);
        if (!r) continue;
        const head = `**${ARM_NAME[arm]}**　${sec(r.totalMs)}${r.score !== undefined ? `　模型给 ${r.score} 分` : ""}${r.error ? `　出错：${r.error}` : ""}${r.note ? `　（${r.note}）` : ""}`;
        out.push(head);
        if (r.card.comment) out.push(`- 点评：${r.card.comment}`);
        for (const n of checkRun(r)) {
          const issues = [...n.broken, ...n.findings.filter((f) => f.level !== "plus").map((f) => `${f.dim}${f.level === "hard" ? "✗" : "·"} ${f.text}`)];
          const plus = n.findings.filter((f) => f.level === "plus").map((f) => f.text);
          out.push(`- ${n.full}${issues.length ? `：${issues.join("；")}` : "：没查到问题"}${plus.length ? `（${plus.join("；")}）` : ""}`);
        }
        if (!r.names.length && !r.error) out.push("- （没给名字或改法）");
        out.push("");
      }
    }
  }
  return out.join("\n");
}

/** 盲选页：每组左右两张卡，哪边是哪版按组随机定（同一组每次打开都一样），看不到分数和耗时 */
function blindHtml(): string {
  const cases: { id: string; title: string; input: string; left: Run["card"]; right: Run["card"]; leftArm: Arm }[] = [];
  for (const kind of ["score", "fast", "full"] as Kind[]) {
    const idx = [...new Set(runs.filter((r) => r.kind === kind).map((r) => r.index))].sort((p, q) => p - q);
    for (const i of idx) {
      const cur = runs.find((r) => r.kind === kind && r.index === i && r.arm === "current");
      const sim = runs.find((r) => r.kind === kind && r.index === i && r.arm === "simple");
      if (!cur || !sim || (!cur.card.items.length && !sim.card.items.length && !cur.card.comment && !sim.card.comment)) continue;
      const id = `${kind}-${i}`;
      // 按 id 算一个固定的随机：同一组每次打开左右不变
      let h = 0;
      for (const ch of id + "jinyu") h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      const curLeft = h % 2 === 0;
      cases.push({
        id, title: `${KIND_NAME[kind]} ${i + 1}`, input: inputOf(kind, i),
        left: (curLeft ? cur : sim).card, right: (curLeft ? sim : cur).card, leftArm: curLeft ? "current" : "simple",
      });
    }
  }
  const data = JSON.stringify(cases).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>起名盲选</title>
<style>
:root { --bg:#f6f4ef; --card:#fff; --ink:#1d1b18; --ink2:#5b5650; --line:#ddd7cc; --pick:#a5382a; --pick-soft:#f4e3df; }
@media (prefers-color-scheme: dark) { :root { --bg:#151412; --card:#1f1d1a; --ink:#ece7df; --ink2:#a8a197; --line:#36322c; --pick:#e0806f; --pick-soft:#3a2420; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.7 "Noto Sans SC", system-ui, sans-serif; }
main { max-width: 1100px; margin: 0 auto; padding: 24px 16px 80px; }
h1 { font-size: 22px; margin: 0 0 6px; }
.lead { color: var(--ink2); margin: 0 0 24px; }
section.case { margin: 0 0 36px; }
.case h2 { font-size: 18px; margin: 0; }
.case .input { color: var(--ink2); margin: 2px 0 12px; }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 720px) { .pair { grid-template-columns: 1fr; } }
.card { background: var(--card); border: 2px solid var(--line); border-radius: 8px; padding: 14px 16px; cursor: pointer; }
.card.on { border-color: var(--pick); background: var(--pick-soft); }
.card .tag { font-size: 13px; color: var(--ink2); }
.card .name { font-size: 22px; font-weight: 700; letter-spacing: .06em; margin-top: 8px; }
.card .line { color: var(--ink2); }
.card .comment { margin: 6px 0; }
.card ul { margin: 4px 0; padding-left: 20px; }
.row { display: flex; gap: 8px; margin-top: 8px; }
button { font: inherit; padding: 6px 14px; border: 1px solid var(--line); border-radius: 6px; background: var(--card); color: var(--ink); cursor: pointer; }
button.on { border-color: var(--pick); color: var(--pick); }
#result { position: sticky; bottom: 0; background: var(--bg); border-top: 1px solid var(--line); padding: 12px 16px; }
.arm { font-weight: 700; color: var(--pick); }
</style>
</head>
<body>
<main>
<h1>起名盲选</h1>
<p class="lead">每组两版，左右顺序是随机的。点你觉得更好的那张卡；差不多就点「差不多」。看不到分数和耗时。全部选完再点最下面的「公布」。</p>
<div id="list"></div>
</main>
<div id="result"><button id="reveal">公布哪边是哪版</button> <span id="tally"></span></div>
<script>
const CASES = ${data};
const KEY = "jinyu-blind-v1";
let picks = {};
try { picks = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { picks = {}; }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(picks)); } catch (e) {} };
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
function card(c, side) {
  let h = '<div class="tag">' + (side === "L" ? "左" : "右") + "</div>";
  if (c.comment) h += '<p class="comment">' + esc(c.comment) + "</p>";
  if (c.strengths && c.strengths.length) h += "<div>好在哪</div><ul>" + c.strengths.map((s) => "<li>" + esc(s) + "</li>").join("") + "</ul>";
  if (c.issues && c.issues.length) h += "<div>问题在哪</div><ul>" + c.issues.map((s) => "<li>" + esc(s) + "</li>").join("") + "</ul>";
  if (!c.items.length) h += '<p class="line">（没给名字或改法）</p>';
  for (const it of c.items) h += '<div class="name">' + esc(it.name) + "</div>" + it.lines.map((l) => '<div class="line">' + esc(l) + "</div>").join("");
  return h;
}
function render() {
  const list = document.getElementById("list");
  list.innerHTML = CASES.map((c) =>
    '<section class="case"><h2>' + esc(c.title) + '</h2><div class="input">' + esc(c.input) + '</div><div class="pair">' +
    '<div class="card ' + (picks[c.id] === "L" ? "on" : "") + '" data-id="' + c.id + '" data-side="L">' + card(c.left, "L") + "</div>" +
    '<div class="card ' + (picks[c.id] === "R" ? "on" : "") + '" data-id="' + c.id + '" data-side="R">' + card(c.right, "R") + "</div>" +
    '</div><div class="row"><button class="' + (picks[c.id] === "S" ? "on" : "") + '" data-id="' + c.id + '" data-side="S">差不多</button></div></section>'
  ).join("");
  const done = CASES.filter((c) => picks[c.id]).length;
  document.getElementById("tally").textContent = "已选 " + done + " / " + CASES.length;
}
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-side]");
  if (!el) return;
  picks[el.dataset.id] = el.dataset.side;
  save();
  render();
});
document.getElementById("reveal").addEventListener("click", () => {
  const name = { current: "现在的系统", simple: "简化版" };
  const count = {};
  for (const c of CASES) {
    const kind = c.title.replace(/ \\d+$/, "");
    count[kind] = count[kind] || { current: 0, simple: 0, same: 0, none: 0 };
    const p = picks[c.id];
    if (!p) count[kind].none++;
    else if (p === "S") count[kind].same++;
    else count[kind][(p === "L") === (c.leftArm === "current") ? "current" : "simple"]++;
  }
  document.querySelectorAll(".case").forEach((sec, k) => {
    const c = CASES[k];
    const tag = sec.querySelectorAll(".tag");
    tag[0].innerHTML = '左 · <span class="arm">' + name[c.leftArm] + "</span>";
    tag[1].innerHTML = '右 · <span class="arm">' + name[c.leftArm === "current" ? "simple" : "current"] + "</span>";
  });
  document.getElementById("tally").textContent = Object.entries(count)
    .map(([k, v]) => k + "：现在的系统 " + v.current + "，简化版 " + v.simple + "，差不多 " + v.same + (v.none ? "，没选 " + v.none : ""))
    .join("　");
});
render();
</script>
</body>
</html>`;
}

writeFileSync(resolve(OUT_DIR, "report.md"), markdown());
writeFileSync(resolve(OUT_DIR, "blind.html"), blindHtml());
console.log(`写到 ${resolve(OUT_DIR, "report.md")} 和 blind.html`);
