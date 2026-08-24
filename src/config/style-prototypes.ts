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
    subtitle: "《诗经》《楚辞》典故意象",
    softPrompt:
      "古典雅致：用《诗经》《楚辞》、唐诗宋词里有具体出处的典雅字（如望舒、令仪、杜若、纫兰、静姝）。不要只挑泛泛的文雅字（清/砚/书/墨），不要生僻字，也不要堆砌典故。",
    keywords: ["诗经", "楚辞", "唐诗", "出处", "典籍"],
  },
  {
    id: "natural_clear",
    name: "自然清灵",
    subtitle: "山水风物意象，清新脱俗",
    softPrompt:
      "自然清灵：取自然山水、风物意象的字（如雪、月、云、竹、溪、莲、岚、澄）。不要堆砌古典典故字，不要生僻字，也不要过于冷峻幽暗（如冥/煞/寒）或甜腻的字。",
    keywords: ["自然", "山水", "清", "溪", "月", "云", "竹", "莲"],
  },
  {
    id: "grand_dignified",
    name: "大气端庄",
    subtitle: "有格局力量，稳重开阔",
    softPrompt:
      "大气端庄：取有格局、有力量、稳重开阔的字（如宇、轩、博、锦、屹、川、峻、朗）。不要阴柔甜腻的字，不要过于文弱书卷气，也不要野/痞/狂/戾等江湖气。",
    keywords: ["大气", "稳重", "格局", "开阔", "宇", "轩", "博", "川", "屹"],
  },
  {
    id: "modern_clean",
    name: "现代简洁",
    subtitle: "日常简单字，好写好认",
    softPrompt:
      "现代简洁：用日常常见、字形简单、好写好认的字（如简、宁、知、遥、朗、序、恒）。不要文房古文意象字（清/砚/书/墨/修），不要典故意象，不要野/痞/狂/戾等江湖气或随性不羁的字，也不要生僻晦涩字。",
    keywords: ["简洁", "简单", "现代", "日常", "好写", "朗", "宁", "恒", "序"],
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
  return (
    STYLE_PROTOTYPES.find((p) => p.id === id) ??
    STYLE_PROTOTYPES.find((p) => p.id === "default_dignified")! // 不依赖数组顺序
  );
}
