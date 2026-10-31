/**
 * 生成八字排盘用的出生地经纬度表：src/config/places-cn.json
 *
 * 数据来自 Wikidata（CC0）：P442 行政区划代码 + P625 坐标，省 / 地级 / 县级三层。
 * 真太阳时只用经度（1° = 4 分钟），坐标取到 0.01° 足够。
 *
 * 用法：
 *   node scripts/fortune/build-places.mjs              # 联网查询
 *   WD_RAW=某文件.json node scripts/fortune/build-places.mjs   # 用已下载的查询结果
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "src/config/places-cn.json");

const QUERY = `SELECT ?item ?code ?coord ?hans ?cn ?zh ?end WHERE {
  ?item wdt:P442 ?code .
  FILTER(STRLEN(?code) = 2 || STRLEN(?code) = 5 || STRLEN(?code) = 8)
  OPTIONAL { ?item wdt:P625 ?coord . }
  OPTIONAL { ?item wdt:P576 ?end . }
  OPTIONAL { ?item rdfs:label ?hans . FILTER(LANG(?hans) = "zh-hans") }
  OPTIONAL { ?item rdfs:label ?cn . FILTER(LANG(?cn) = "zh-cn") }
  OPTIONAL { ?item rdfs:label ?zh . FILTER(LANG(?zh) = "zh") }
}`;

async function loadRows() {
  if (process.env.WD_RAW) {
    return JSON.parse(readFileSync(process.env.WD_RAW, "utf8")).results.bindings;
  }
  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(QUERY)}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "jinyu-fortune-places/0.1 (offline build script)",
      Accept: "application/sparql-results+json",
    },
  });
  if (!res.ok) throw new Error(`Wikidata HTTP ${res.status}`);
  return (await res.json()).results.bindings;
}

/** 统计局给开发区、管理区编的县级码（末两位 71–79），不是行政区划，没人「出生在」这里 */
function isStatsOnlyZone(code, name) {
  if (code.length === 6) {
    const tail = Number(code.slice(4));
    if (tail >= 71 && tail <= 79) return true;
  }
  return /(开发区|管理区|园区|示范区|风景名胜区|实验区|高新技术)/.test(name);
}

function parsePoint(value) {
  const m = value?.match(/Point\(([-\d.]+) ([-\d.]+)\)/);
  if (!m) return null;
  const lng = Number(m[1]);
  const lat = Number(m[2]);
  // 中国境内的大致范围，越界的坐标当作没有
  if (!(lng >= 73 && lng <= 136 && lat >= 3 && lat <= 54)) return null;
  return [lng, lat];
}

const round2 = (n) => Math.round(n * 100) / 100;

const rows = await loadRows();

/** code → item → { name, ended, points[] } */
const byCode = new Map();
for (const r of rows) {
  const code = r.code.value.replace(/\s+/g, "");
  if (!/^\d+$/.test(code) || code === "86") continue;
  const name = (r.hans ?? r.cn ?? r.zh)?.value?.trim();
  if (!name) continue;
  if (isStatsOnlyZone(code, name)) continue;
  if (!byCode.has(code)) byCode.set(code, new Map());
  const items = byCode.get(code);
  const id = r.item.value;
  if (!items.has(id)) items.set(id, { name, ended: Boolean(r.end), points: [] });
  const point = parsePoint(r.coord?.value);
  const entry = items.get(id);
  if (point && !entry.points.some((p) => p[0] === point[0] && p[1] === point[1])) {
    entry.points.push(point);
  }
}

const places = new Map();
for (const [code, items] of byCode) {
  // 同一个码挂了多个条目时，优先现行的、带坐标的
  const pick = [...items.values()].sort(
    (a, b) => Number(a.ended) - Number(b.ended) || b.points.length - a.points.length,
  )[0];
  const coord = pick.points.length
    ? [
        pick.points.reduce((s, p) => s + p[0], 0) / pick.points.length,
        pick.points.reduce((s, p) => s + p[1], 0) / pick.points.length,
      ]
    : null;
  places.set(code, { code, name: pick.name, coord, ended: pick.ended });
}

// 省级必须存在，否则下级挂不上去
const orphans = [];
for (const p of places.values()) {
  if (p.code.length > 2 && !places.has(p.code.slice(0, 2))) orphans.push(p);
}
for (const p of orphans) places.delete(p.code);

// 没坐标的用上一级的坐标，标记为近似
let approx = 0;
const sorted = [...places.values()].sort((a, b) => a.code.localeCompare(b.code));
for (const p of sorted) {
  if (p.coord) continue;
  const parent = places.get(p.code.slice(0, 4))?.coord ?? places.get(p.code.slice(0, 2))?.coord;
  if (parent) {
    p.coord = parent;
    p.approx = true;
    approx++;
  }
}

const out = [];
let dropped = 0;
for (const p of sorted) {
  if (!p.coord) {
    dropped++;
    continue;
  }
  const flags = [p.ended ? "old" : "", p.approx ? "approx" : ""].filter(Boolean).join(",");
  const row = [p.code, p.name, round2(p.coord[0]), round2(p.coord[1])];
  if (flags) row.push(flags);
  out.push(row);
}

const doc = {
  source: "Wikidata（CC0）P442 行政区划代码 + P625 坐标；由 scripts/fortune/build-places.mjs 生成",
  builtAt: new Date().toISOString().slice(0, 10),
  fields: ["code", "name", "lng", "lat", "flags(old=已撤并, approx=坐标取上级)"],
  places: out,
};

writeFileSync(OUT, `${JSON.stringify(doc).replace(/\],\[/g, "],\n[")}\n`, "utf8");

const count = (len) => out.filter((r) => r[0].length === len).length;
console.log(
  `places: ${out.length}（省 ${count(2)} / 地 ${count(4)} / 县 ${count(6)}），坐标取上级 ${approx}，无坐标丢弃 ${dropped}，省级缺失丢弃 ${orphans.length}${
    orphans.length ? `：${orphans.map((o) => o.code + o.name).join(" ")}` : ""
  }`,
);
console.log(`→ ${path.relative(ROOT, OUT)}`);
