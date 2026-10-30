import type { NameSplit } from "./types";

/**
 * 姓名拆分。
 *
 * 三字姓名的歧义没法自动消除：「王欧阳」可能是「王 + 欧阳」，也可能是「王欧 + 阳」。
 * 所以这里只给最合理的一种，并把另一种放进 alternatives，让界面能一键切换。
 */

const COMPOUND_SURNAMES = new Set([
  "欧阳", "太史", "端木", "上官", "司马", "东方", "独孤", "南宫", "万俟", "闻人",
  "夏侯", "诸葛", "尉迟", "公羊", "赫连", "澹台", "皇甫", "宗政", "濮阳", "公冶",
  "太叔", "申屠", "公孙", "慕容", "仲孙", "钟离", "长孙", "宇文", "司徒", "鲜于",
  "司空", "闾丘", "子车", "亓官", "司寇", "巫马", "公西", "颛孙", "壤驷", "公良",
  "漆雕", "乐正", "宰父", "谷梁", "拓跋", "夹谷", "轩辕", "令狐", "段干", "百里",
  "呼延", "东郭", "南门", "羊舌", "微生", "梁丘", "左丘", "西门", "第五", "公乘",
  "南荣", "东里", "东宫", "仲长", "即墨", "达奚", "褚师", "闻人", "澹台",
]);

export function isCompoundSurname(twoChars: string): boolean {
  return COMPOUND_SURNAMES.has(twoChars);
}

export interface SplitOutcome {
  ok: boolean;
  message?: string;
  split?: NameSplit;
}

export function splitFullName(fullName: string): SplitOutcome {
  const name = fullName.replace(/\s/g, "");
  if (name.length < 2) return { ok: false, message: "姓名至少两个字" };
  if (name.length > 4) return { ok: false, message: "姓名最多四个字" };

  const head2 = name.slice(0, 2);
  const compound = name.length >= 3 && isCompoundSurname(head2);

  if (compound) {
    const split: NameSplit = {
      surname: head2,
      givenName: name.slice(2),
      alternatives: [{ surname: name.slice(0, 1), givenName: name.slice(1) }],
    };
    return { ok: true, split };
  }

  const surname = name.slice(0, 1);
  const givenName = name.slice(1);
  const alternatives: { surname: string; givenName: string }[] = [];
  // 三字名才可能被读成复姓；把另一种拆法摆出来让人自己判断
  if (name.length === 3 && isCompoundSurname(head2)) {
    alternatives.push({ surname: head2, givenName: name.slice(2) });
  }
  return { ok: true, split: { surname, givenName, alternatives } };
}
