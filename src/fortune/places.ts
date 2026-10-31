import data from "@/config/places-cn.json";
import type { Place } from "./types";

/**
 * 出生地：省 → 地级 → 县级三层，数据见 scripts/fortune/build-places.mjs。
 *
 * 直辖市、省直辖县级市（济源、仙桃、石河子……）没有地级这一层，
 * 统一按「上级地级码不存在就直接挂到省下」处理。
 * 服务端只认码，经纬度一律在这里查，不信任前端传来的数字。
 */

type Row = [string, string, number, number, string?];

interface Entry {
  code: string;
  name: string;
  lng: number;
  lat: number;
  old: boolean;
  approx: boolean;
}

export interface PlaceOption {
  code: string;
  name: string;
  hasChildren: boolean;
}

const entries = new Map<string, Entry>();
for (const row of (data as unknown as { places: Row[] }).places) {
  const [code, name, lng, lat, flags = ""] = row;
  entries.set(code, { code, name, lng, lat, old: flags.includes("old"), approx: flags.includes("approx") });
}

function parentCode(code: string): string | null {
  if (code.length === 6) return entries.has(code.slice(0, 4)) ? code.slice(0, 4) : code.slice(0, 2);
  if (code.length === 4) return code.slice(0, 2);
  return null;
}

const childrenOf = new Map<string, string[]>();
for (const code of [...entries.keys()].sort()) {
  const parent = parentCode(code);
  if (!parent || !entries.has(parent)) continue;
  const list = childrenOf.get(parent) ?? [];
  list.push(code);
  childrenOf.set(parent, list);
}

function toOption(code: string): PlaceOption {
  const e = entries.get(code)!;
  return {
    code,
    name: e.old ? `${e.name}（已撤并）` : e.name,
    hasChildren: (childrenOf.get(code)?.length ?? 0) > 0,
  };
}

export function listProvinces(): PlaceOption[] {
  return [...entries.keys()].filter((c) => c.length === 2).sort().map(toOption);
}

export function listChildren(code: string): PlaceOption[] {
  return (childrenOf.get(code) ?? []).map(toOption);
}

export function findPlace(code: string): Place | null {
  const e = entries.get(code);
  if (!e) return null;
  const path: string[] = [];
  for (let c: string | null = code; c; c = parentCode(c)) {
    const node = entries.get(c);
    if (node) path.unshift(node.name);
  }
  return { code, path, lng: e.lng, lat: e.lat, old: e.old, approx: e.approx };
}

/** 选到省就停的只有港澳台这类没有下级的；其余至少要到地级，否则经度可能差出好几度 */
export function isPreciseEnough(code: string): boolean {
  return entries.has(code) && (code.length > 2 || !childrenOf.get(code)?.length);
}
