import { polyphonic } from "pinyin-pro";
import { gbLevel, strokesOf, toSimplified } from "@/domain/analysis/chars";
import { leanFacts } from "@/domain/analysis/gender-lean";
import { splitFullName } from "@/domain/analysis/split-name";
import type { AnalysisGender, NameSplit } from "@/domain/analysis/types";
import { fullNamePinyin, nameSyllables } from "@/domain/pinyin-name";
import {
  BAD_WORDS,
  BIG_SURNAMES,
  ERA_CHARS,
  ERA_NAMES,
  ERA_PAIR,
  FOLK,
  FORBIDDEN,
  FORBIDDEN_MILD,
  HOT_CHARS,
  SANDHI_SURNAME,
  SURNAME_TRAP,
  TEMPLATE_NAMES,
} from "./lexicon";
import type { Deduction, FolkNote, NameScore, ScoreBand, ScoreRuleId } from "./types";

/**
 * 直播打分：100 分减规则扣分。
 *
 * 不调模型。同一个名字永远同一个分，每一分都能指到一条规则，主播被问「为什么扣」时念得出来。
 * 规则的来源和取舍见 docs/直播打分-民俗字表草稿.md；
 * 分值改这里，主播念的话改 src/config/folk-chars.json。
 *
 * 字相关的规则只看名不看姓：「皇甫」的皇不扣。查表一律用简体，展示保留观众原来写的字。
 */

/** 谐音扣多少看坏词表里每个词自己的分值（骂人 30、开玩笑 15）；年代感的分值在 era-names.json */
export const POINTS = {
  forbiddenSevere: 30,
  forbiddenMild: 15,
  template: 20,
  /**
   * 名里每个字都偏另一个性别（双名两个字都偏、单名那一个字偏），一听就是另一个性别的名字。
   * 11-01 由 15 / 8 改成 25（用户：文海军给女孩 75 分「可以用」不合理）：和整名年代感一样是整个名字的毛病，单这一条就落到「建议改」
   */
  genderWhole: 25,
  /** 偏另一个性别的字和中性字搭着用 */
  genderOne: 8,
  genderMixed: 5,
  misread: 12,
  trap: 10,
  rare: 10,
  hot: 8,
  singleName: 10,
  sameSound: 8,
  flatTone: 5,
  sandhi: 3,
  strokes: 5,
} as const;

/**
 * 听出来的毛病：谐音、和姓同音、和姓连读成词、年代感、撞名、热门字、同调、三声连读。
 * 名字多半是被念出来、被听到的（点名、自我介绍），这类毛病换个同音的写法还在：
 * 文红艳换成文红雁，念出来还是「红艳」（2026-11-01 用户指出）。其余的（字义、字太大、生僻、
 * 容易念错、男女用字、笔画）是看出来的，保留读音换个写法就能解决。
 * 改字时告诉模型这一条，核验时也按它挡掉读音没变的改法（fix.ts）。
 */
const HEARD_RULES: ReadonlySet<ScoreRuleId> = new Set([
  "homophone",
  "sameSound",
  "trap",
  "era",
  "eraName",
  "template",
  "hot",
  "singleName",
  "flatTone",
  "sandhi",
]);

export function heardIssue(d: Deduction): boolean {
  return d.soundBound === true || HEARD_RULES.has(d.rule);
}

/** 全名里最多和最少的两个字笔画差到这么多，算一边轻一边重 */
const STROKE_GAP = 9;

const TONE_NAME = ["", "一声", "二声", "三声", "四声"];
const CN_NUM = ["", "一", "两", "三", "四", "五"];

/**
 * 90 分以上非常优秀，80–89 可以用，80 以下建议改。
 * 11-01 「可以用」从 75 起改成 80 起（用户：75 分可以用，标准低了）：整个名字的毛病（整名年代感、整名偏另一个性别，
 * 都扣 25）单这一条就落到「建议改」；只撞了烂大街名（扣 20）还算可以用，再带一点别的毛病就是建议改。
 */
export function bandOf(score: number): { band: ScoreBand; label: string } {
  if (score >= 90) return { band: "great", label: "非常优秀" };
  if (score >= 80) return { band: "ok", label: "可以用" };
  return { band: "change", label: "建议改" };
}

/** 一个字的不同读音（带声调，按去声调后去重），如 仡 → yì、gē */
export function readingsOf(ch: string): string[] {
  const raw = polyphonic(ch, { type: "array", toneType: "symbol" }) as unknown as string[][];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw[0] ?? []) {
    const key = r.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/** 拆姓名；界面上手动切过拆法时用那一种 */
export function resolveSplit(fullName: string, surnameOverride?: string): NameSplit | null {
  const base = splitFullName(fullName);
  if (!base.ok || !base.split) return null;
  if (!surnameOverride || !fullName.startsWith(surnameOverride) || fullName.length <= surnameOverride.length) {
    return base.split;
  }
  return {
    surname: surnameOverride,
    givenName: fullName.slice(surnameOverride.length),
    alternatives: [base.split, ...base.split.alternatives]
      .map((a) => ({ surname: a.surname, givenName: a.givenName }))
      .filter((a, i, all) => a.surname !== surnameOverride && all.findIndex((x) => x.surname === a.surname) === i),
  };
}

export function scoreName(split: NameSplit, gender: AnalysisGender): NameScore {
  const { surname, givenName } = split;
  const fullName = `${surname}${givenName}`;
  const surOrig = [...surname];
  const givOrig = [...givenName];
  const sur = toSimplified(surname);
  const givStr = toSimplified(givenName);
  const giv = [...givStr];
  const deductions: Deduction[] = [];
  const add = (d: Omit<Deduction, "chars">) =>
    deductions.push({ ...d, chars: d.positions.map((i) => givOrig[i] ?? giv[i] ?? "") });
  const each = (fn: (c: string, i: number) => void) => giv.forEach(fn);
  const q = (i: number) => `「${givOrig[i] ?? giv[i]}」`;

  /* ---- 读音：谐音、同音、同调 ---- */
  const syllables = nameSyllables(`${sur}${givStr}`).map((s, i) => ({ ...s, ch: [...surOrig, ...givOrig][i] ?? s.ch }));
  const flat = syllables.map((s) => s.py.toLowerCase());
  const surLen = surOrig.length;

  const headHit = giv.length > 0 ? BAD_WORDS.get(flat.slice(0, surLen + 1).join("")) : undefined;
  const fullHit = headHit ? undefined : BAD_WORDS.get(flat.join(""));
  const bad = headHit ?? fullHit;
  if (bad) {
    const span = headHit ? `${surname}${givOrig[0]}` : fullName;
    add({
      rule: "homophone",
      positions: headHit ? [0] : giv.map((_, i) => i),
      points: bad.points,
      line: `「${span}」连起来念像${bad.say}，上学容易被起外号。`,
      soundBound: true,
    });
  }

  /* ---- 字义：不宜字、换字档 ---- */
  each((c, i) => {
    if (!FORBIDDEN.has(c)) return;
    const mild = FORBIDDEN_MILD.has(c);
    add({
      rule: "forbidden",
      positions: [i],
      points: mild ? POINTS.forbiddenMild : POINTS.forbiddenSevere,
      line: mild ? `${q(i)}的意思偏消极，放进名字里不太讨喜。` : `${q(i)}的意思不吉利，名字里一般不用。`,
    });
  });
  each((c, i) => {
    const f = FOLK.get(c);
    if (f?.tier === "swap") {
      add({
        rule: "swap",
        positions: [i],
        points: f.points,
        line: f.line,
        ...(f.soundBound ? { soundBound: true as const } : {}),
      });
    }
  });

  /* ---- 重名：烂大街名、热门字 ---- */
  const isTemplate = TEMPLATE_NAMES.has(givStr);
  if (isTemplate) {
    add({
      rule: "template",
      positions: giv.map((_, i) => i),
      points: POINTS.template,
      line: `「${givenName}」是这些年最常见的名字之一，一个学校可能撞好几个。`,
    });
  }

  /* ---- 性别：只在填了性别时判 ---- */
  if (gender !== "unknown") {
    const lean = leanFacts(givStr);
    const other = gender === "male" ? "female" : "male";
    const opp = lean.facts.map((f, i) => (f.lean === other ? i : -1)).filter((i) => i >= 0);
    const same = lean.facts.filter((f) => f.lean === gender).length;
    const self = gender === "male" ? "男孩" : "女孩";
    const otherLabel = other === "male" ? "男孩" : "女孩";
    if (opp.length > 0 && same === 0) {
      const whole = opp.length === giv.length;
      add({
        rule: "gender",
        positions: opp,
        points: whole ? POINTS.genderWhole : POINTS.genderOne,
        line: whole
          ? `${opp.map(q).join("")}在人名里${opp.length > 1 ? "都" : ""}更多用在${otherLabel}身上，整个名字一听就是${otherLabel}名，${self}用容易被认错。`
          : `${opp.map(q).join("")}在人名里更多用在${otherLabel}身上，${self}用容易被认错。`,
      });
    } else if (opp.length > 0) {
      add({
        rule: "gender",
        positions: opp,
        points: POINTS.genderMixed,
        line: `名字里${self}常用的字和${otherLabel}常用的字混着用，一时猜不准是男孩还是女孩。`,
      });
    }
  }

  /* ---- 字形与常用度 ---- */
  each((c, i) => {
    if (gbLevel(c) !== 2) return;
    const readings = readingsOf(c);
    if (readings.length < 2) return;
    const shown = readings.slice(0, 3).join("、");
    add({
      rule: "misread",
      positions: [i],
      points: POINTS.misread,
      line: `${q(i)}有 ${shown} ${CN_NUM[Math.min(readings.length, 5)] ?? readings.length}个读音，又不常见，第一次见的人多半念错。`,
    });
  });

  const trap = SURNAME_TRAP[sur];
  if (trap && giv[0] && trap.chars.has(giv[0])) {
    add({ rule: "trap", positions: [0], points: POINTS.trap, line: `「${surname}${givOrig[0]}」念出来像「${trap.as}${givOrig[0]}」。` });
  }

  each((c, i) => {
    if (gbLevel(c) === 0) {
      add({
        rule: "rare",
        positions: [i],
        points: POINTS.rare,
        line: `${q(i)}不在常用字表里，有些老系统打不出来，办证订票可能要多跑一趟。`,
      });
    }
  });

  if (!isTemplate && !ERA_NAMES.has(givStr)) {
    each((c, i) => {
      if (HOT_CHARS.has(c)) {
        add({ rule: "hot", positions: [i], points: POINTS.hot, line: `${q(i)}是这几年起名用得最多的字之一，重名的概率高。` });
      }
    });
  }

  // 全国重名最多的张伟、王伟、李娜都是大姓配单名。换同音字还是单名，所以不算进可换的字
  if (giv.length === 1 && BIG_SURNAMES.has(sur)) {
    add({
      rule: "singleName",
      positions: [],
      points: POINTS.singleName,
      line: `姓${surname}是大姓，又是单名，最容易重名：全国重名最多的张伟、王伟、李娜都是大姓配单名。`,
    });
  }

  if (giv.length > 0 && flat[surLen - 1] && flat[surLen - 1] === flat[surLen]) {
    add({
      rule: "sameSound",
      positions: [0],
      points: POINTS.sameSound,
      line: `「${surOrig[surLen - 1]}」和${q(0)}都念 ${flat[surLen]}，连着念有点绕。`,
      soundBound: true,
    });
  }

  /* ---- 年代感 ----
   * 从重到轻只取一种：整名就是老一辈的常见名（秀英）→ 双名两个字都是年代字（红梅）
   * → 单名就是年代字（文娟）→ 名里有一个年代字（静姝）。分值和说法在 era-names.json。 */
  const eraName = ERA_NAMES.get(givStr);
  const eraHits = giv.map((c) => ERA_CHARS.get(c));
  const [e0, e1] = eraHits;
  if (eraName) {
    add({ rule: "eraName", positions: giv.map((_, i) => i), points: eraName.points, line: eraName.line });
  } else if (giv.length === 2 && e0 && e1) {
    const pair = ERA_PAIR[e0.era === e1.era ? e0.era : "mixed"];
    add({ rule: "eraName", positions: [0, 1], points: pair.points, line: pair.line.replaceAll("{n}", givenName) });
  } else if (giv.length === 1 && e0) {
    add({ rule: "era", positions: [0], points: e0.single.points, line: e0.single.line });
  } else {
    eraHits.forEach((e, i) => {
      if (e) add({ rule: "era", positions: [i], points: e.points, line: e.line });
    });
  }

  each((c, i) => {
    const f = FOLK.get(c);
    if (f?.tier === "remind") add({ rule: "remind", positions: [i], points: f.points, line: f.line });
  });

  const tones = syllables.map((s) => s.tone);
  const flatTone = tones.length >= 3 && tones[0]! > 0 && tones.every((t) => t === tones[0]);
  if (flatTone) {
    add({
      rule: "flatTone",
      positions: [],
      points: POINTS.flatTone,
      line: `${CN_NUM[tones.length] ?? tones.length}个字都是${TONE_NAME[tones[0]!]}，念起来一个调，没有起伏。`,
      soundBound: true,
    });
  } else {
    // 三声姓接三声字，姓变成二声，正好听成另一个常见姓（许小明 → 徐小明）。
    // 别的两个三声挨着不扣：变调是普通话的常规读法，不拗口。
    // 姓和名首字已经算成谐音（武永 = 无用）的，不再重复说。
    const as = SANDHI_SURNAME[sur];
    if (as && !headHit && tones[surLen - 1] === 3 && tones[surLen] === 3) {
      add({
        rule: "sandhi",
        positions: [0],
        points: POINTS.sandhi,
        line: `「${fullName}」连着念，${surname}要变成二声，听着像「${as}${givenName}」。`,
        soundBound: true,
      });
    }
  }

  const strokes = [...sur, ...giv]
    .map((c, i) => ({ c: [...surOrig, ...givOrig][i] ?? c, n: strokesOf(c) }))
    .filter((x): x is { c: string; n: number } => x.n !== null)
    .sort((a, b) => a.n - b.n);
  if (strokes.length >= 2) {
    const low = strokes[0]!;
    const high = strokes[strokes.length - 1]!;
    if (high.n - low.n >= STROKE_GAP) {
      add({
        rule: "strokes",
        positions: [],
        points: POINTS.strokes,
        line: `「${low.c}」${low.n} 画，「${high.c}」${high.n} 画，写在一起一边轻一边重。`,
      });
    }
  }

  each((c, i) => {
    const f = FOLK.get(c);
    if (f?.tier === "style") add({ rule: "style", positions: [i], points: f.points, line: f.line });
  });

  /* ---- 只念不扣 ---- */
  const folk: FolkNote[] = [];
  each((c, i) => {
    const f = FOLK.get(c);
    const char = givOrig[i] ?? c;
    if (f?.tier === "note" && !folk.some((n) => n.char === char)) folk.push({ char, line: f.line });
  });

  /* ---- 合计 ---- */
  deductions.sort((a, b) => b.points - a.points);
  const total = deductions.reduce((s, d) => s + d.points, 0);
  const score = Math.max(0, 100 - total);
  const { band, label } = bandOf(score);

  return {
    fullName,
    surname,
    givenName,
    alternatives: split.alternatives,
    gender,
    score,
    band,
    bandLabel: label,
    syllables,
    pinyin: fullNamePinyin(sur, givStr).text,
    deductions,
    folk,
  };
}
