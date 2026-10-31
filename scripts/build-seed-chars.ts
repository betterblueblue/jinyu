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
 *   5 近年爆款造词用字（HANDOFF §9：璟泽、昱珩、钧泽……）→ 不要
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
 * 偏女宝的候选字。
 * 2026-10-31 第一版跑真实链路 20 轮后拿掉了一批：配出来的名字别扭或少见
 * （婵予、霓朵、汀若、言柚、缇安、梧希、珑月……），或者字义不讨喜（纭＝纷纭、夕＝日暮）：
 * 婵霓缇珑葭汀柚歌朵夕梧桃苑菀茹采珂楹榕纾纭绾苓榆
 * 第二轮再拿掉：年代感重、配出来像上一辈的名（慧敏琴兰惠梦莹瑛蓉洁彩欢盼菲），
 * 以及配出来别扭的（樱时、滢星、涟舟、盈溪、愉安、蔓青、卿月）：
 * 慧敏琴兰惠梦莹瑛蓉洁彩欢盼菲樱滢涟盈愉蔓卿。补进：漪婕竹
 */
const FEMALE =
  "棠禾溪岚芸素杏悦韵婉恬晚荷笙锦霁映茉芷茵菁薇蕊露霜雪雯霏雅静颖妍姝娴婧嫣瑜琳珊瑾璇琬柔曼楚乔桐槿苒菡芙筱希冉晗晓煦昀晞沁潇纯黛绮音诗柳桑蕾芊茗如蕴苏宛璐蕙依若月娅妤蓓悠洛泠暖歆漪婕竹";
/**
 * 偏男宝的候选字（第一轮拿掉：潮＝网络词、洪＝洪水）。
 * 第二轮拿掉：配出来别扭或少见（渊朗、岱青、浦宁、直清、泉朗、廷书、劭程、清铎、树成），
 * 容易配成地名（泰→泰安、晋），年代感重或太普通（宏弘维尚凡定敬石岸江河湖鸣），
 * 少见字（嵩岭杉桓栋洵泓沛湛骐暄绍屹嵘钦）：
 * 渊岱浦直泉廷劭铎树泰晋宏弘维尚凡定敬石岸江河湖鸣嵩岭杉桓栋洵泓沛湛骐暄绍屹嵘钦。
 * 补进：栩弈衍琛璞玮骞，以及原来放中性、但给女宝配出来别扭的叙序齐冬（改成只给男宝）
 */
const MALE =
  "川舟远衡恒砚野原朗致修谨承启越卓牧松柏山岩峻岳立拓帆洲楷柯毅峥骁骏驰鸿铭锐铮崇诚瀚海源澈淳骥博哲迪逸谦彦煜炜烨焕曜旭皓恺扬庭钰彬栩弈衍琛璞玮骞叙序齐冬";
/** 男女都常用的候选字（性别倾向表判出倾向的会自动只进一边）。第二轮去掉「平」（平阔、平萱都别扭），补进熙、楠 */
const NEUTRAL =
  "安宁然初知言书清和舒晴晏昭澄青简允嘉遥时文明星云南秋夏景佳恩心思念意怀慕宜澜润屿语晨光雨瑞枫望熙楠";

const ZIHAO = "德志业功礼政忠孝仁义信道治济猷";
const TOO_BIG = "天帝皇圣神龙霸尊王祖昊乾坤寰宇宙仙虎";
const ERA_HOT = "璟昱珩钧宸";
const POLYPHONE = "行乐长重朝调降藏传转觉校率省便曾着还只少中为与相将当正发都会种数空处单区查盖解仇朴尉蔚茜";
/** 放进名字读起来像第二个姓（沈苏晴）或谐音不讨喜（桑→丧）。实测出过「沈苏晴」「沈桑宁」 */
const SURNAME_LIKE = "苏柳桑";
const MAX_STROKES = 16;

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
    if (wantF && lean !== "male") female.add(ch);
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
