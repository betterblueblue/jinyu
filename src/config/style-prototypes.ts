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
    subtitle: "有典故出处，取《诗经》《楚辞》",
    softPrompt:
      "古典雅致：必须取《诗经》《楚辞》、唐诗宋词里有具体出处的典雅字（如望舒、令仪、杜若、纫兰）。不要只挑泛泛的「清/砚/书/墨」等无出处的文雅字，也不要生僻字与堆砌典故。",
    keywords: ["典故", "诗经", "楚辞", "出处", "雅"],
  },
  {
    id: "warm_clear",
    name: "温润清朗",
    subtitle: "音色清亮柔和，好念好记",
    softPrompt:
      "温润清朗：优先音色明亮、朗朗上口、读起来舒服的字（如清、朗、和、明、景）。不要冷峻晦涩、阴沉沉重的字，不要生僻多音字，意象明亮不甜腻。",
    keywords: ["清朗", "温润", "明亮", "音色", "和"],
  },
  {
    id: "modern_clean",
    name: "现代简洁",
    subtitle: "日常简单字，字形好写好认",
    softPrompt:
      "现代简洁：用日常常见、字形简单、好写好认的字（如简、宁、知、遥、朗、序）。不要「清/砚/书/墨/修」等文房或古文意象字，不要《诗经》《楚辞》典故意象，也不要野/痞/狂/戾等江湖气或随性不羁的字，更不要生僻晦涩字。",
    keywords: ["简洁", "简单", "现代", "日常", "好写"],
  },
  {
    id: "default_dignified",
    name: "端庄耐看",
    subtitle: "默认方向：稳、耐看、少网红感",
    softPrompt:
      "默认端庄耐看：好念好写、少空话、避开烂大街模板；字义正面稳妥，不剑走偏锋。",
    keywords: ["端庄", "耐看"],
  },
];

export function getStylePrototype(id: StylePrototypeId): StylePrototype {
  return STYLE_PROTOTYPES.find((p) => p.id === id) ?? STYLE_PROTOTYPES[STYLE_PROTOTYPES.length - 1]!;
}
