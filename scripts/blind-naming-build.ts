// 把盲测探针（blind-naming-probe.ts）的结果拼成盲选页 data/eval/blind-2026-11-01/naming-blind.html（总体方案 A13）。
// 临时目录里没有探针结果时，读上一次存下的 data/eval/blind-2026-11-01/probe.json
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkFastCandidate } from "../src/fast/gate";
import { tasteProblems } from "../src/fast/taste";
import { fullNamePinyin } from "../src/domain/pinyin-name";

type Shown = { fullName: string; givenName: string; pinyin: string; hint?: string; why: string; library: boolean };
type BaseName = { givenName: string; fullName: string; line: string; gate: string[] };
type RoundA = {
  surname: string;
  gender: "male" | "female";
  ok: boolean;
  ms?: number;
  shown: Shown[];
  talks: Record<string, { chars: string; whole: string; tip?: string }>;
  base: { ms: number; names: BaseName[]; error?: string; raw?: string };
};

const SRC = path.join(os.tmpdir(), "jinyu-naming-probe.json");
const DIR = path.join(process.cwd(), "data", "eval", "blind-2026-11-01");
if (!existsSync(SRC)) copyFileSync(path.join(DIR, "probe.json"), SRC);
const rounds = (JSON.parse(readFileSync(SRC, "utf8")) as { a: RoundA[] }).a;
// 网关给随手问也回了 JSON（{"names":[{"name":"王静姝","meaning":"…"}]}），探针按行认不出：这里从原文里取
for (const r of rounds) {
  if (r.base.names.length || !r.base.raw) continue;
  for (const m of r.base.raw.matchAll(/"name"\s*:\s*"([^"]+)"\s*,\s*"meaning"\s*:\s*"([^"]*)"/g)) {
    const full = m[1]!.trim();
    const given = full.startsWith(r.surname) ? full.slice(r.surname.length) : full;
    if (!/^[一-鿿]{1,2}$/.test(given) || r.base.names.some((n) => n.givenName === given)) continue;
    const v = checkFastCandidate(given, r.surname, r.gender);
    r.base.names.push({ givenName: given, fullName: `${r.surname}${given}`, line: m[2]!, gate: v.keep ? tasteProblems(given) : v.reasons });
  }
}

let seed = 20261101;
const rng = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const sec = (ms: number) => `${(ms / 1000).toFixed(1)} 秒`;
const cleanLine = (s: string) => s.replace(/^[（(][^）)]*[）)]\s*/, "").replace(/^[\s:：—–\-|]+/, "").replace(/\s*\|\s*$/, "").trim();

let same = 0;
const pairs: unknown[] = [];
for (const r of rounds) {
  const ours = r.shown[0];
  const base = r.base.names[0];
  if (!r.ok || !ours || !base) continue;
  if (ours.givenName === base.givenName) {
    same++;
    continue;
  }
  const talk = r.talks[ours.givenName];
  pairs.push({
    surname: r.surname,
    gender: r.gender,
    oursLeft: rng() < 0.5,
    ours: {
      fullName: ours.fullName,
      pinyin: ours.pinyin,
      why: ours.why,
      ...(talk ? { chars: talk.chars, whole: talk.whole } : {}),
      ...(ours.library ? { note: "名字库里的名字（你评过的），提词页用库里的整段稿子" } : !talk ? { note: "提词页补写的稿子这一轮没写出来" } : {}),
    },
    base: {
      fullName: base.fullName,
      pinyin: fullNamePinyin(r.surname, base.givenName).text,
      why: cleanLine(base.line),
      ...(base.gate.length ? { flags: base.gate } : {}),
    },
  });
}

const okRounds = rounds.filter((r) => r.ok && r.shown.length);
const oursAll = okRounds.flatMap((r) => r.shown);
const oursDistinct = new Set(oursAll.map((c) => c.givenName)).size;
const libCount = oursAll.filter((c) => c.library).length;
const primaries = okRounds.map((r) => r.shown[0]!);
const primTalk = okRounds.filter((r) => r.shown[0]!.library || r.talks[r.shown[0]!.givenName]).length;
const baseRounds = rounds.filter((r) => r.base.names.length);
const baseAll = baseRounds.flatMap((r) => r.base.names.map((n) => ({ ...n, surname: r.surname })));
const givenCount = new Map<string, number>();
for (const n of baseAll) givenCount.set(n.givenName, (givenCount.get(n.givenName) ?? 0) + 1);
const repeated = [...givenCount].filter(([, k]) => k > 1).sort((a, b) => b[1] - a[1]);
const perRound = baseRounds.map((r) => r.base.names.length);
const flaggedAll = baseAll.filter((n) => n.gate.length);
const flaggedFirst = baseRounds.filter((r) => r.base.names[0]!.gate.length).length;

const facts = [
  `直播台 ${okRounds.length}/${rounds.length} 轮出了名字，一共上屏 ${oursAll.length} 个（首推加备选），${oursDistinct === oursAll.length ? "一个都不重复" : `重复了 ${oursAll.length - oursDistinct} 个`}；其中 ${libCount} 个是名字库里你评过的。首推的提词页稿子有 ${primTalk}/${primaries.length} 个。`,
  `随手问 ${baseRounds.length}/${rounds.length} 轮认出了名字，每次给 ${Math.min(...perRound)}–${Math.max(...perRound)} 个（中位 ${median(perRound)} 个），一共 ${baseAll.length} 个，不同的名 ${givenCount.size} 个。${repeated.length ? `换了姓还重复出现的名：${repeated.slice(0, 8).map(([g, k]) => `${g} ${k} 次`).join("、")}${repeated.length > 8 ? ` 等 ${repeated.length} 个` : ""}。` : "换了姓也没有重复的名。"}`,
  `随手问的 ${baseAll.length} 个名字里，${flaggedAll.length} 个过不了直播台上屏前那道检查（谐音、热门名、你评过不要的……），排第一的有 ${flaggedFirst} 个。下面展开能看每个的原因。`,
  `速度：直播台从请求到出结果中位 ${sec(median(okRounds.map((r) => r.ms ?? 0)))}、最慢 ${sec(Math.max(...okRounds.map((r) => r.ms ?? 0)))}；随手问整段回答写完中位 ${sec(median(baseRounds.map((r) => r.base.ms)))}、最慢 ${sec(Math.max(...baseRounds.map((r) => r.base.ms)))}（App 里是边写边出，第一个名字出来得比这早）。`,
  ...(same ? [`有 ${same} 轮两边排第一的是同一个名字，没放进上面的盲选。`] : []),
];
const flagged = flaggedAll.map((n) => `${n.fullName}：${n.gate.join("；")}`);

const data = { id: "2026-11-01", pairs, facts, flagged };
const tpl = readFileSync(path.join(process.cwd(), "scripts", "blind-naming-template.html"), "utf8");
mkdirSync(DIR, { recursive: true });
writeFileSync(path.join(DIR, "naming-blind.html"), tpl.replace("/*DATA*/null", JSON.stringify(data).replace(/</g, "\\u003c")), "utf8");
copyFileSync(SRC, path.join(DIR, "probe.json"));
console.log(`盲选 ${pairs.length} 对（同名跳过 ${same}）`);
for (const f of facts) console.log(`- ${f}`);
console.log(`拦下的：\n  ${flagged.join("\n  ")}`);
