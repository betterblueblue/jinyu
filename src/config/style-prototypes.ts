import type { StylePrototypeId } from "@/domain/types";

export interface StylePrototype {
  id: StylePrototypeId;
  name: string;
  subtitle: string;
  softPrompt: string;
  keywords: string[];
}

export const STYLE_PROTOTYPES: StylePrototype[] = [
  {
    id: "classical_elegant",
    name: "古典雅致",
    subtitle: "典籍意象，端庄有出处感",
    softPrompt: "偏向古典雅致，可取《诗经》《楚辞》、唐诗宋词与礼乐意象，避免强网感流行字。",
    keywords: ["古典", "雅致", "诗书", "礼乐"],
  },
  {
    id: "warm_clear",
    name: "温润清朗",
    subtitle: "清润好念，如晨光温水",
    softPrompt: "偏向温润清朗，音色柔和清晰，意象明亮不甜腻。",
    keywords: ["温润", "清朗", "和婉"],
  },
  {
    id: "scholarly_restrained",
    name: "书卷自持",
    subtitle: "文气克制，耐读耐品",
    softPrompt: "偏向书卷气与自持，文雅内敛，忌夸张与口号感。",
    keywords: ["书卷", "自持", "文气"],
  },
  {
    id: "modern_clean",
    name: "现代简洁",
    subtitle: "干净利落，少装饰感用字",
    softPrompt: "偏向现代简洁，字形干净、好写好认，避免堆砌古典辞藻。",
    keywords: ["简洁", "现代", "干净"],
  },
  {
    id: "neutral_restrained",
    name: "中性克制",
    subtitle: "稳重不甜腻，男女皆宜向",
    softPrompt: "偏向中性克制，稳重含蓄，避免过度阴柔或阳刚模板。",
    keywords: ["中性", "克制", "稳重"],
  },
  {
    id: "default_dignified",
    name: "端庄耐看",
    subtitle: "默认方向：稳、耐看、少网红感",
    softPrompt: "默认端庄耐看：好念好写、少空话、避开烂大街模板。",
    keywords: ["端庄", "耐看"],
  },
];

export function getStylePrototype(id: StylePrototypeId): StylePrototype {
  return STYLE_PROTOTYPES.find((p) => p.id === id) ?? STYLE_PROTOTYPES[STYLE_PROTOTYPES.length - 1]!;
}
