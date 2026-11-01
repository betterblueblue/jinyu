/**
 * 生成直播精简版的「起手字」表：src/config/seed-chars.json。
 *
 * 起手字是什么：每轮从这张表里随机抽 5 个单字给模型，要求 5 个名字各用其中一个，
 * 另一个字模型按规则自己配。它不是名字池，名字仍由模型每轮现配；
 * 它的作用是让模型每轮从不同的地方起步，不回到自己最熟的那十几个名字（知夏、令仪、予安……）。
 *
 * 这张表 = 下面的候选字 → 按规则机械过滤。候选字是人起的草，规则全是项目里已有的数据：
 *   1 热门字表 l2-chars.json            → 不要
 *   2 忌字表 forbidden-chars.json       → 不要
 *   3 古人字号字（提示词原第 3 条那 15 个）→ 不要
 *   4 太大的字（帝王、天地、神兽）        → 不要
 *   5 近年爆款造词用字（docs/archive/HANDOFF-2026-10-31.md §9：璟泽、昱珩、钧泽……）→ 不要
 *   6 名字里容易念错的多音字             → 不要
 *   7 放进名字像第二个姓、或谐音不讨喜（苏、柳、桑）→ 不要
 *   8 GB2312 一级或二级之外（打不出、认不得）→ 不要
 *   9 笔画超过 16                        → 不要（孩子写名字要写一辈子）
 *  10 性别倾向表 gender-lean.ts 判为「男」的字不进女表，判为「女」的不进男表
 *
 * 用法：pnpm tsx scripts/build-seed-chars.ts   （需要本地字表 data/corpus/chars.json）
 * 改候选字或规则后重跑，输出会打印每条规则拦掉了哪些字，最终表要人过一眼再提交。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getCharTable, gbLevel, strokesOf } from "../src/domain/analysis/chars";
import { leanOf } from "../src/domain/analysis/gender-lean";

/**
 * 第三轮（2026-11-01）：直播起名改回模型以后，按用户在评审页评过的 166 个名字重做（docs/名字标准.md v2–v5）。
 *   拿掉：老气（岚、海、颖、晓、崇、鸿、佳）、太软（柔、婉、姝、娴、静、如、依、宛、恬）、
 *        太刚（骁、骏、峥、铮、锐、驰、峻、拓）、网红和花草堆砌（茉、蕾、娅、妤、婕、芊、苒、晗、昀、屿、楠、煜、烨、芷、薇、雯、霏）、
 *        爱被拿来凑的（禾、然、舟、野、原、牧、洲、砚）、口号味（立、谦、谨）、
 *        不讨喜或易误会的（晚、初、悠、乔、南、宜、迪、希、楚），
 *        季节字（秋、夏、冬：别的季节也会抽到；呼应出生时节交给生日那一句，见 src/fast/birth.ts）
 *   加上：用户给了 80、90 的名字里的字（徽、华、皓、晖、冰、灼、蔚、章、含、微、闻、维、济、桢、行、穆、树、纯、煦、瑾……）
 *   规则也跟着用户的评审改：行、蔚读常用音（行健、文蔚都给了 80），不再按多音字拦；济川 80，济不再算古人字号；
 *   徽音 90，笔画上限放到 17。
 * 评测（scripts/eval-fast.ts，和线上提示词交替跑 30 轮）：耗时和旧表差不多，首推里不要的名字少了一大半。
 * 前两轮拿掉的字记录在 git 历史里（2026-10-31）。
 */
const FEMALE = "棠溪芸悦韵荷笙锦霁映雪妍瑜琳琬槿音诗蕴蕙若月暖竹徽华晖冰灼窈含微";
const MALE = "恒致修承启卓松柏岩岳帆毅诚澈博哲彦衍齐闻维济桢行穆树成";
/** 男女都用的候选字（性别倾向表判出倾向的会自动只进一边） */
const NEUTRAL = "瑾煦纯安宁知言书清舒晴晏昭澄青简允嘉文明星云景心思怀澜润晨瑞望熙皓蔚越章远川光朗衡";

const ZIHAO = "德志业功礼政忠孝仁义信道治猷";
const TOO_BIG = "天帝皇圣神龙霸尊王祖昊乾坤寰宇宙仙虎";
const ERA_HOT = "璟昱珩钧宸";
const POLYPHONE = "乐长重朝调降藏传转觉校率省便曾着还只少中为与相将当正发都会种数空处单区查盖解仇朴尉茜";
/** 放进名字读起来像第二个姓（沈苏晴）或谐音不讨喜（桑→丧）。实测出过「沈苏晴」「沈桑宁」 */
const SURNAME_LIKE = "苏柳桑";
const MAX_STROKES = 17;
/** 性别倾向表判成偏男、但用户给女孩名评过高分的字：晴光 90、皓月 90、晴晖 90、含章 80、心远 80 */
const GIRL_OK = "光晖皓章远";

function loadJsonChars(file: string): Set<string> {
  const list = JSON.parse(readFileSync(join(process.cwd(), "src", "config", file), "utf8")) as string[];
  return new Set(list.join(""));
}

function main() {
  const table = getCharTable();
  if (Object.keys(table.strokes).length === 0) {
    throw new Error("没有字表 data/corpus/chars.json，笔画和 GB2312 两条规则没法查。先跑 pnpm corpus:chars");
  }
  const hot = loadJsonChars("l2-chars.json");
  const forbidden = loadJsonChars("forbidden-chars.json");
  const rules: [string, (ch: string) => boolean][] = [
    ["热门字", (ch) => hot.has(ch)],
    ["忌字", (ch) => forbidden.has(ch)],
    ["古人字号", (ch) => ZIHAO.includes(ch)],
    ["太大", (ch) => TOO_BIG.includes(ch)],
    ["近年爆款用字", (ch) => ERA_HOT.includes(ch)],
    ["易念错的多音字", (ch) => POLYPHONE.includes(ch)],
    ["像姓或谐音不讨喜", (ch) => SURNAME_LIKE.includes(ch)],
    ["GB2312 一二级之外", (ch) => { const lv = gbLevel(ch); return lv !== 1 && lv !== 2; }],
    [`笔画超过 ${MAX_STROKES}`, (ch) => (strokesOf(ch) ?? 99) > MAX_STROKES],
  ];

  const removed = new Map<string, string[]>();
  const keep = (ch: string): boolean => {
    for (const [why, hit] of rules) {
      if (hit(ch)) {
        removed.set(why, [...(removed.get(why) ?? []), ch]);
        return false;
      }
    }
    return true;
  };

  const uniq = (s: string) => [...new Set([...s])];
  const female = new Set<string>();
  const male = new Set<string>();
  const leanMoved: string[] = [];
  for (const ch of uniq(FEMALE + NEUTRAL + MALE)) {
    if (!keep(ch)) continue;
    const lean = leanOf(ch);
    const wantF = FEMALE.includes(ch) || NEUTRAL.includes(ch);
    const wantM = MALE.includes(ch) || NEUTRAL.includes(ch);
    if (wantF && (lean !== "male" || GIRL_OK.includes(ch))) female.add(ch);
    else if (wantF) leanMoved.push(`${ch}(倾向男，不进女表)`);
    if (wantM && lean !== "female") male.add(ch);
    else if (wantM) leanMoved.push(`${ch}(倾向女，不进男表)`);
  }

  const out = {
    note: "直播精简版起手字表。由 scripts/build-seed-chars.ts 生成：候选字按规则过滤，改了重跑，别手改。",
    rules: rules.map(([why]) => why).concat("性别倾向表判出倾向的只进一边"),
    female: [...female],
    male: [...male],
  };
  writeFileSync(join(process.cwd(), "src", "config", "seed-chars.json"), `${JSON.stringify(out, null, 2)}\n`, "utf8");

  for (const [why, chars] of removed) console.log(`拦掉（${why}）${chars.length}：${chars.join("")}`);
  if (leanMoved.length) console.log(`按性别倾向只进一边：${leanMoved.join(" ")}`);
  console.log(`\n女宝起手字 ${female.size}：${[...female].join("")}`);
  console.log(`男宝起手字 ${male.size}：${[...male].join("")}`);
}

main();
